const express = require('express');
const supertest = require('supertest');

const Henri = require('../henri');
const { GRACE, Reporter, requestOf } = require('../base/reporting');
const { errorHandler } = require('../base/http');
const { requestId } = require('../base/request-id');

/**
 * A henri look-alike: a pen that keeps what it was told and the personal
 * field names the privacy module would have collected
 *
 * @param {object} [options={}] `personal` and `filterParameters`
 * @returns {object} the instance, with `lines`
 */
const fakeHenri = ({ filterParameters, personal = [] } = {}) => {
  const config = {};

  if (filterParameters !== undefined) {
    config.filterParameters = filterParameters;
  }

  const lines = [];

  return {
    config: {
      get: (key) => config[key],
      has: (key) => Object.prototype.hasOwnProperty.call(config, key),
    },
    isDev: false,
    isProduction: false,
    isTest: true,
    lines,
    pen: {
      error: (...args) => lines.push(['error', ...args]),
      info: () => {},
      line: () => {},
      warn: (...args) => lines.push(['warn', ...args]),
    },
    privacy: { keys: new Set(personal) },
  };
};

/** A promise that never settles */
const forever = () => new Promise(() => {});

describe('the error reporting seam', () => {
  test('nothing is registered by default, and reporting costs nothing', async () => {
    const reporter = new Reporter(fakeHenri());

    expect(reporter.enabled).toBe(false);
    await expect(reporter.report(new Error('boom'))).resolves.toBe(false);
  });

  test('onError takes a function or null, like onDeliverLater', () => {
    const henri = fakeHenri();
    const reporter = new Reporter(henri);

    expect(reporter.onError(() => true)).toBe(true);
    expect(reporter.enabled).toBe(true);
    expect(reporter.onError('nope')).toBe(false);
    expect(reporter.onError(null)).toBe(true);
    expect(reporter.enabled).toBe(false);
    expect(henri.lines[0]).toContain('the error handler must be a function');
  });

  test('one handler: registering another replaces it', async () => {
    const reporter = new Reporter(fakeHenri());
    const seen = [];

    reporter.onError(() => seen.push('first'));
    reporter.onError(() => seen.push('second'));
    await reporter.report(new Error('boom'));

    expect(seen).toEqual(['second']);
  });

  test('the report carries the error, its code and where it was caught', async () => {
    const reporter = new Reporter(fakeHenri());
    const error = new Error('no store');
    let report = null;

    error.code = 'HENRI_MODEL_NO_STORE';
    reporter.onError((found) => (report = found));

    await reporter.report(error, { source: 'boot' });

    expect(report.error).toBe(error);
    expect(report.code).toBe('HENRI_MODEL_NO_STORE');
    expect(report.source).toBe('boot');
    expect(report.at).toBeInstanceOf(Date);
    expect(report.request).toBeNull();
    expect(report.requestId).toBeNull();
  });

  test('the code is the first one of the cause chain', async () => {
    const reporter = new Reporter(fakeHenri());
    const cause = new Error('no store');
    let report = null;

    cause.code = 'HENRI_MODEL_NO_STORE';
    reporter.onError((found) => (report = found));

    await reporter.report(new Error('boot failed', { cause }));

    expect(report.code).toBe('HENRI_MODEL_NO_STORE');
  });

  test('a source nobody declared is the application reporting its own', async () => {
    const reporter = new Reporter(fakeHenri());
    let report = null;

    reporter.onError((found) => (report = found));
    await reporter.report(new Error('boom'), { source: 'whatever' });

    expect(report.source).toBe('application');
  });

  test('anything can be reported, and reaches the handler as an Error', async () => {
    const reporter = new Reporter(fakeHenri());
    let report = null;

    reporter.onError((found) => (report = found));
    await reporter.report('a string rejection');

    expect(report.error).toBeInstanceOf(Error);
    expect(report.error.message).toBe('a string rejection');
  });

  test('the same error is reported once, however many paths saw it', async () => {
    const reporter = new Reporter(fakeHenri());
    const error = new Error('boom');
    const seen = [];

    reporter.onError((found) => seen.push(found));

    await reporter.report(error, { source: 'request' });
    await reporter.report(error, { source: 'boot' });

    expect(seen).toHaveLength(1);
  });
});

describe('what a report never carries', () => {
  test('of a request: the method, the route pattern and the status, and that is all', () => {
    const req = {
      baseUrl: '/api',
      body: { password: 'hunter2' },
      cookies: { 'henri.sid': 'abc' },
      headers: { authorization: 'Bearer sk-live-1' },
      method: 'POST',
      originalUrl: '/api/artworks/9f3c?token=secret',
      params: { id: '9f3c' },
      query: { token: 'secret' },
      route: { path: '/artworks/:id' },
      user: { email: 'ada@example.com' },
    };
    const found = requestOf(req, 500);

    expect(found).toEqual({
      method: 'POST',
      route: '/api/artworks/:id',
      status: 500,
    });
    expect(JSON.stringify(found)).not.toContain('hunter2');
    expect(JSON.stringify(found)).not.toContain('ada@example.com');
    expect(JSON.stringify(found)).not.toContain('secret');
  });

  test('a request henri did not route names no path at all', () => {
    expect(requestOf({ method: 'GET' }, 500).route).toBeNull();
    expect(requestOf(null, null)).toBeNull();
  });

  test("the application's own meta is masked, like a log line", async () => {
    const reporter = new Reporter(fakeHenri({ personal: ['nickname'] }));
    let report = null;

    reporter.onError((found) => (report = found));
    await reporter.report(new Error('boom'), {
      meta: {
        deep: { apiToken: 'sk-live-1' },
        nickname: 'ada',
        order: 'ord_42',
      },
    });

    expect(report.meta).toEqual({
      deep: { apiToken: '[FILTERED]' },
      nickname: '[FILTERED]',
      order: 'ord_42',
    });
  });
});

describe('a handler is not trusted', () => {
  test('one that throws does not take the caller with it', async () => {
    const henri = fakeHenri();
    const reporter = new Reporter(henri);

    reporter.onError(() => {
      throw new Error('sentry is down');
    });

    await expect(reporter.report(new Error('boom'))).resolves.toBe(true);
    expect(henri.lines[0]).toContain('the error handler threw');
  });

  test('one that rejects does not either', async () => {
    const henri = fakeHenri();
    const reporter = new Reporter(henri);

    reporter.onError(() => Promise.reject(new Error('timeout')));

    await expect(reporter.report(new Error('boom'))).resolves.toBe(true);
    expect(henri.lines[0]).toContain('the error handler threw');
  });

  test('one that hangs is given up on, and says so', async () => {
    vi.useFakeTimers();

    const henri = fakeHenri();
    const reporter = new Reporter(henri);

    reporter.onError(forever);

    const reported = reporter.report(new Error('boom'));

    await vi.advanceTimersByTimeAsync(GRACE + 1);
    await expect(reported).resolves.toBe(true);
    expect(henri.lines[0][2]).toContain('still running');

    vi.useRealTimers();
  });
});

describe('where a report comes from', () => {
  test('the boot: henri.init() rejected, and the handler heard about it', async () => {
    const henri = new Henri({ runlevel: 0 });
    const boom = new Error('bad config');
    const seen = [];

    henri.modules.init = async () => {
      throw boom;
    };
    henri.reporter.onError((report) => seen.push(report));

    await expect(henri.init()).rejects.toThrow(/bad config/u);

    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe('boot');
    expect(seen[0].code).toBe('HENRI_BOOT_FAILED');
    expect(seen[0].error.cause).toBe(boom);
  });

  test('a boot handler that hangs does not hang the boot', async () => {
    const henri = new Henri({ runlevel: 0 });

    henri.modules.init = async () => {
      throw new Error('bad config');
    };
    henri.reporter.onError(forever);

    vi.useFakeTimers();

    const booting = henri.init().then(
      () => 'the boot resolved',
      (error) => error.message
    );

    await vi.advanceTimersByTimeAsync(GRACE + 1);

    expect(await booting).toContain('bad config');

    vi.useRealTimers();
  });

  test('a request: every 5xx, once, and no 4xx', async () => {
    const henri = fakeHenri();
    const seen = [];

    henri.reporter = new Reporter(henri);
    henri.reporter.onError((report) => seen.push(report));

    const app = express();

    app.use(requestId());
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    app.get('/nope', (req, res, next) => {
      const error = new Error('no such thing');

      error.status = 404;

      return next(error);
    });
    app.use(errorHandler(henri));

    await supertest(app).get('/nope').expect(404);
    expect(seen).toHaveLength(0);

    const answer = await supertest(app).get('/boom').expect(500);

    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe('request');
    expect(seen[0].error.message).toBe('kaboom');
    expect(seen[0].request).toEqual({
      method: 'GET',
      route: '/boom',
      status: 500,
    });
    // The line the client was answered with carries the same id
    expect(seen[0].requestId).toBe(answer.headers['x-request-id']);
  });

  test('a request is never held for a handler', async () => {
    const henri = fakeHenri();

    henri.reporter = new Reporter(henri);
    henri.reporter.onError(forever);

    const app = express();

    app.get('/boom', () => {
      throw new Error('kaboom');
    });
    app.use(errorHandler(henri));

    const answer = await supertest(app).get('/boom');

    expect(answer.status).toBe(500);
  });
});
