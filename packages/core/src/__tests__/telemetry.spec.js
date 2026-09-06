const express = require('express');
const supertest = require('supertest');

const api = require('@opentelemetry/api');

const { BOUNDARIES: SCHEMA_BOUNDARIES } = require('../base/config-schema');
const { isCode } = require('../base/errors');
const { requestId } = require('../base/request-id');
const {
  BOUNDARIES,
  MAX_FAILURES,
  Telemetry,
  attributeValue,
  attributesOf,
  createTelemetry,
  methodOf,
  telemetryConfig,
} = require('../base/telemetry');

/**
 * A tracer that keeps its spans, which is the whole exporter this suite
 * needs.
 *
 * The point of testing telemetry against a fake rather than a collector:
 * what matters is what a span *carries*, and the answer to that is in the
 * object before anything is serialized. A collector would only tell us that
 * the SDK works.
 *
 * @returns {object} `{ provider, spans, reset }`
 */
const recorder = () => {
  const spans = [];

  /**
   * One recorded span
   *
   * @param {string} name the span name
   * @param {object} options what `startSpan` was given
   * @param {*} parent the context it was started in
   * @returns {object} the span
   */
  const make = (name, options = {}, parent = undefined) => {
    const span = {
      attributes: { ...(options.attributes || {}) },

      /**
       * End the span
       *
       * @param {number} [at] when it ended
       * @returns {void}
       */
      end: (at) => {
        span.ended = true;
        span.endTime = typeof at === 'undefined' ? null : at;
      },

      endTime: null,
      ended: false,
      events: [],
      exceptions: [],

      /**
       * Is anything recording it?
       *
       * @returns {boolean} always, here
       */
      isRecording: () => true,

      kind: options.kind,
      name,
      parent: parent || null,

      /**
       * Record an exception
       *
       * @param {Error} error the error
       * @returns {void}
       */
      recordException: (error) => span.exceptions.push(error),

      /**
       * Set one attribute
       *
       * @param {string} key the name
       * @param {*} value the value
       * @returns {object} the span
       */
      setAttribute: (key, value) => {
        span.attributes[key] = value;

        return span;
      },

      /**
       * Set the status
       *
       * @param {object} status the status
       * @returns {object} the span
       */
      setStatus: (status) => {
        span.status = status;

        return span;
      },

      startTime: options.startTime || null,
      status: null,

      /**
       * Rename it, which is what the route pattern does
       *
       * @param {string} value the new name
       * @returns {object} the span
       */
      updateName: (value) => {
        span.name = value;

        return span;
      },
    };

    spans.push(span);

    return span;
  };

  return {
    /**
     * The tracer provider, as `trace.setGlobalTracerProvider` wants it
     *
     * @returns {object} the tracer
     */
    getTracer: () => ({ startSpan: make }),
    /**
     * Forget what was recorded
     *
     * @returns {void}
     */
    reset: () => spans.splice(0, spans.length),
    spans,
  };
};

/** The counters and instruments a meter would have made */
const meter = () => {
  const recorded = [];
  const observed = [];
  const callbacks = [];

  return {
    callbacks,
    /**
     * A histogram
     *
     * @param {string} name the instrument name
     * @param {object} options its options
     * @returns {object} the instrument
     */
    createHistogram: (name, options) => ({
      name,
      options,
      /**
       * Record one measurement
       *
       * @param {number} value the value
       * @param {object} attributes its dimensions
       * @returns {void}
       */
      record: (value, attributes) => recorded.push({ attributes, name, value }),
    }),
    /**
     * An observable counter or gauge
     *
     * @param {string} name the instrument name
     * @param {object} options its options
     * @returns {object} the instrument
     */
    createObservableCounter: (name, options) => ({
      /**
       * Register the callback
       *
       * @param {function} fn the callback
       * @returns {void}
       */
      addCallback: (fn) =>
        callbacks.push(() =>
          fn({
            /**
             * Record one observation
             *
             * @param {number} value the value
             * @param {object} attributes its dimensions
             * @returns {void}
             */
            observe: (value, attributes) =>
              observed.push({ attributes, name, value }),
          })
        ),
      name,
      options,
    }),
    observed,
    recorded,
  };
};

/** A henri look-alike: a pen that keeps what it was told, and the masking */
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
    isProduction: false,
    isTest: true,
    lines,
    pen: {
      error: (...args) => lines.push(['error', ...args]),
      info: (...args) => lines.push(['info', ...args]),
      warn: (...args) => lines.push(['warn', ...args]),
    },
    privacy: { keys: new Set(personal) },
  };
};

/** A Telemetry wired to a recorder and, optionally, a meter */
const wired = (options = {}) => {
  const tracer = recorder();
  const metrics = meter();
  const settings = {
    enabled: true,
    metrics: true,
    propagate: true,
    required: false,
    spans: [...BOUNDARIES],
    ...(options.settings || {}),
  };
  const telemetry = new Telemetry({
    api: {
      SpanStatusCode: api.SpanStatusCode,
      context: api.context,
      metrics: { getMeter: () => metrics },
      propagation: api.propagation,
      trace: { ...api.trace, getTracer: tracer.getTracer },
      ...(options.api || {}),
    },
    henri: options.henri || fakeHenri(),
    settings,
  });

  return { metrics, telemetry, tracer };
};

describe('what telemetry is when nobody is listening', () => {
  test('no api means no tracer, no meter, and nothing installed', () => {
    const telemetry = new Telemetry({
      henri: fakeHenri(),
      settings: telemetryConfig({
        get: () => undefined,
        has: () => false,
      }),
    });

    expect(telemetry.enabled).toBe(false);
    expect(telemetry.spans).toEqual([]);
    expect(telemetry.on('http')).toBe(false);
    expect(telemetry.describe()).toBe('nothing instrumented');
  });

  test('span() runs the function and allocates no span', () => {
    const telemetry = new Telemetry({ henri: fakeHenri() });

    expect(telemetry.span('anything', () => 42)).toBe(42);
    expect(telemetry.span('anything', { attributes: { a: 1 } }, () => 7)).toBe(
      7
    );
  });

  test('histogram() still answers a recorder, so no call site branches', () => {
    const telemetry = new Telemetry({ henri: fakeHenri() });

    expect(() => telemetry.histogram('x').record(1, { a: 'b' })).not.toThrow();
    expect(telemetry.observe('x', {}, () => {})).toBe(false);
  });

  test('inject() writes nothing into the carrier', () => {
    const telemetry = new Telemetry({ henri: fakeHenri() });
    const headers = {};

    expect(telemetry.inject(headers)).toBe(headers);
    expect(Object.keys(headers)).toEqual([]);
  });

  test('config.telemetry false is off, and never looks for the package', () => {
    const settings = telemetryConfig({
      get: () => false,
      has: (key) => key === 'telemetry',
    });

    expect(settings.enabled).toBe(false);
    expect(settings.spans).toEqual([]);

    // Even handed an api, it is off: the configuration said so
    const telemetry = new Telemetry({ api, henri: fakeHenri(), settings });

    expect(telemetry.enabled).toBe(false);
  });
});

describe('what the configuration says', () => {
  const reader = (value) => ({
    get: () => value,
    has: (key) => key === 'telemetry',
  });

  test('the key absent is every boundary, the metrics and the propagation', () => {
    const settings = telemetryConfig({
      get: () => undefined,
      has: () => false,
    });

    expect(settings).toMatchObject({
      enabled: true,
      metrics: true,
      propagate: true,
      required: false,
    });
    expect(settings.spans).toEqual([...BOUNDARIES]);
  });

  test('enabled: true is the application requiring it', () => {
    expect(telemetryConfig(reader({ enabled: true })).required).toBe(true);
    expect(telemetryConfig(reader({})).required).toBe(false);
    expect(telemetryConfig(reader({ enabled: false })).enabled).toBe(false);
  });

  test('spans takes all, false, or a list of the boundaries', () => {
    expect(telemetryConfig(reader({ spans: 'all' })).spans).toEqual([
      ...BOUNDARIES,
    ]);
    expect(telemetryConfig(reader({ spans: false })).spans).toEqual([]);
    expect(
      telemetryConfig(reader({ spans: ['http', 'nonsense', 'jobs'] })).spans
    ).toEqual(['http', 'jobs']);
  });

  test('the schema mirrors the boundaries, since it cannot require them', () => {
    expect(SCHEMA_BOUNDARIES).toEqual([...BOUNDARIES]);
  });
});

describe('a span carries what henri knows, and nothing else', () => {
  /** Everything the client sent, in one request */
  const noisy = (app) =>
    supertest(app)
      .get('/artworks/ada@example.com?token=hunter2&page=2')
      .set('cookie', 'session=abc')
      .set('authorization', 'Bearer nope')
      .set('user-agent', 'a browser')
      .set('x-request-id', 'from-the-proxy');

  /** An application with the middleware and one route with a pattern */
  const application = (telemetry) => {
    const app = express();

    app.use(requestId());
    app.use(telemetry.middleware());
    app.get('/artworks/:id', (req, res) => res.json({ ok: true }));

    return app;
  };

  test('the method, the route pattern, the status, the request id', async () => {
    const { telemetry, tracer } = wired();

    await noisy(application(telemetry));

    expect(tracer.spans).toHaveLength(1);

    const [span] = tracer.spans;

    expect(span.name).toBe('GET /artworks/:id');
    expect(span.ended).toBe(true);
    expect(span.attributes).toEqual({
      'henri.request_id': 'from-the-proxy',
      'http.request.method': 'GET',
      'http.response.status_code': 200,
      'http.route': '/artworks/:id',
    });
  });

  // The rule of base/reporting.js, and it gets its own test the way the
  // reporter's does: everything the client sent, and none of it in a span
  test('and never anything that came from the client', async () => {
    const { telemetry, tracer } = wired();

    await noisy(application(telemetry));

    const written = JSON.stringify(tracer.spans[0]);

    for (const leak of [
      'ada@example.com',
      'hunter2',
      'session=abc',
      'Bearer',
      'a browser',
      'page=2',
      '/artworks/ada',
      'cookie',
      'authorization',
      'user-agent',
    ]) {
      expect(written).not.toContain(leak);
    }

    // ... and the attribute names are the four henri chose, exactly
    expect(Object.keys(tracer.spans[0].attributes).sort()).toEqual([
      'henri.request_id',
      'http.request.method',
      'http.response.status_code',
      'http.route',
    ]);
  });

  test('a route that never matched is the method alone, never the url', async () => {
    const { telemetry, tracer } = wired();
    const app = express();

    app.use(requestId());
    app.use(telemetry.middleware());

    await supertest(app).get('/nothing/here?secret=1');

    expect(tracer.spans[0].name).toBe('GET');
    expect(tracer.spans[0].attributes['http.route']).toBeUndefined();
    expect(JSON.stringify(tracer.spans[0])).not.toContain('nothing');
  });

  test('a method nobody has heard of is _OTHER, not a new dimension', () => {
    expect(methodOf('get')).toBe('GET');
    expect(methodOf('PROPFIND')).toBe('_OTHER');
    expect(methodOf(null)).toBe('_OTHER');
  });

  test('a 5xx is an error on the span, a 4xx is an answer', async () => {
    const { telemetry, tracer } = wired();
    const app = express();

    app.use(requestId());
    app.use(telemetry.middleware());
    app.get('/gone', (req, res) => res.status(404).end());
    app.get('/broken', (req, res) => res.status(500).end());

    await supertest(app).get('/gone');
    await supertest(app).get('/broken');

    expect(tracer.spans[0].status).toBeNull();
    expect(tracer.spans[1].status).toEqual({
      code: api.SpanStatusCode.ERROR,
    });
    expect(tracer.spans[1].attributes['error.type']).toBe('500');
  });

  test('an application span is masked the way a log line is', () => {
    const { telemetry, tracer } = wired({
      henri: fakeHenri({ personal: ['email'] }),
    });

    telemetry.span(
      'app.import',
      {
        attributes: {
          count: 12,
          email: 'ada@example.com',
          nested: { deep: true },
          password: 'hunter2',
        },
      },
      () => true
    );

    expect(tracer.spans[0].attributes).toEqual({
      count: 12,
      email: '[FILTERED]',
      password: '[FILTERED]',
    });
  });

  test('a value a span cannot carry is dropped, never stringified', () => {
    expect(attributeValue('a')).toBe('a');
    expect(attributeValue(1)).toBe(1);
    expect(attributeValue(NaN)).toBeUndefined();
    expect(attributeValue({ a: 1 })).toBeUndefined();
    expect(attributeValue([1, 2])).toEqual([1, 2]);
    expect(attributeValue([1, {}])).toBeUndefined();
    expect(attributesOf({ a: {}, b: 1 })).toEqual({ b: 1 });
    expect(attributesOf({ a: {} })).toBeNull();
    expect(attributesOf(null)).toBeNull();
  });
});

describe('the boundaries, and turning them off one at a time', () => {
  test('a boundary the configuration left out is not spanned', () => {
    const { telemetry, tracer } = wired({ settings: { spans: ['http'] } });

    expect(telemetry.on('http')).toBe(true);
    expect(telemetry.on('views')).toBe(false);

    telemetry.span('henri.view.render', { boundary: 'views' }, () => true);

    expect(tracer.spans).toHaveLength(0);

    // An application's own span names no boundary and follows the tracer
    telemetry.span('app.thing', () => true);

    expect(tracer.spans).toHaveLength(1);
  });

  test('a span ends whether the function answers or throws', async () => {
    const { telemetry, tracer } = wired();
    const boom = new Error('no');

    boom.code = 'HENRI_MODEL_UNKNOWN_STORE';

    expect(() =>
      telemetry.span('sync', () => {
        throw boom;
      })
    ).toThrow(boom);

    await expect(
      telemetry.span('async', () => Promise.reject(boom))
    ).rejects.toBe(boom);

    expect(tracer.spans.map((span) => span.ended)).toEqual([true, true]);
    expect(tracer.spans[0].exceptions).toEqual([boom]);
    expect(tracer.spans[0].attributes['error.type']).toBe(
      'HENRI_MODEL_UNKNOWN_STORE'
    );
    expect(tracer.spans[0].status.code).toBe(api.SpanStatusCode.ERROR);
  });

  test('the boot is written afterwards, out of what analyze() measured', () => {
    const { telemetry, tracer } = wired();
    const startedAt = '2026-09-06T12:00:00.000Z';
    const at = Date.parse(startedAt);

    expect(
      telemetry.boot({
        ceiling: 6,
        duration: 120,
        modules: [
          {
            duration: 5,
            error: null,
            name: 'config',
            runlevel: 0,
            startedAt: 0,
            state: 'done',
          },
          {
            duration: 40,
            error: 'no store',
            name: 'model',
            runlevel: 3,
            startedAt: 10,
            state: 'failed',
          },
          {
            duration: null,
            error: null,
            name: 'router',
            runlevel: 5,
            startedAt: null,
            state: 'waiting',
          },
        ],
        ok: false,
        startedAt,
      })
    ).toBe(true);

    // The root, and one child per module that actually started
    expect(tracer.spans.map((span) => span.name)).toEqual([
      'henri.boot',
      'henri.module config',
      'henri.module model',
    ]);
    expect(tracer.spans[0].startTime).toBe(at);
    expect(tracer.spans[0].endTime).toBe(at + 120);
    expect(tracer.spans[1].startTime).toBe(at);
    expect(tracer.spans[1].endTime).toBe(at + 5);
    expect(tracer.spans[2].startTime).toBe(at + 10);
    expect(tracer.spans[2].status.message).toBe('no store');
  });

  test('no analysis, or the boundary off, and nothing is emitted', () => {
    const { telemetry } = wired({ settings: { spans: ['http'] } });

    expect(telemetry.boot({ modules: [], startedAt: 'x' })).toBe(false);
    expect(wired().telemetry.boot(null)).toBe(false);
  });
});

describe('propagation, and which identifier wins', () => {
  const PARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const KEY = api.createContextKey('traceparent of the suite');

  /**
   * The propagator an SDK would have registered, small enough to read.
   *
   * The point is that henri asks `propagation.extract()` and
   * `propagation.inject()` rather than parsing `traceparent` itself: the
   * wire format belongs to whoever implements the api.
   */
  const propagator = {
    /**
     * The `traceparent` reader
     *
     * @param {*} context the active context
     * @param {object} carrier the headers
     * @param {object} getter how to read one
     * @returns {*} the context, with what was found
     */
    extract: (context, carrier, getter) => {
      const found = getter.get(carrier, 'traceparent');

      return found ? context.setValue(KEY, found) : context;
    },
    /**
     * The header names it writes
     *
     * @returns {Array<string>} the names
     */
    fields: () => ['traceparent'],
    /**
     * ... and the writer
     *
     * @param {*} context the active context
     * @param {object} carrier the headers
     * @returns {void}
     */
    inject: (context, carrier) => {
      const found = context.getValue(KEY);

      if (found) {
        carrier.traceparent = found;
      }
    },
  };

  /**
   * The context manager an SDK would have registered, in its simplest
   * form: `@opentelemetry/api` ships none, and without one `context.with()`
   * runs the function without making anything active.
   */
  let current = api.ROOT_CONTEXT;
  const manager = {
    /**
     * What is active right now
     *
     * @returns {*} the context
     */
    active: () => current,
    /**
     * Bind a target to a context (nothing to do here)
     *
     * @param {*} context the context
     * @param {*} target what to bind
     * @returns {*} the target
     */
    bind: (context, target) => target,
    /**
     * Stop
     *
     * @returns {object} this manager
     */
    disable: () => manager,
    /**
     * Start
     *
     * @returns {object} this manager
     */
    enable: () => manager,
    /**
     * Run a function with a context active
     *
     * @param {*} context the context
     * @param {function} fn what to run
     * @returns {*} whatever it answered
     */
    with: (context, fn) => {
      const previous = current;

      current = context;

      try {
        return fn();
      } finally {
        current = previous;
      }
    },
  };

  beforeEach(() => {
    api.propagation.disable();
    api.propagation.setGlobalPropagator(propagator);
    api.context.disable();
    api.context.setGlobalContextManager(manager);
  });

  afterEach(() => {
    api.propagation.disable();
    api.context.disable();
    current = api.ROOT_CONTEXT;
  });

  test('an incoming traceparent is what the span is started in', async () => {
    const { telemetry, tracer } = wired();
    const app = express();

    app.use(requestId());
    app.use(telemetry.middleware());
    app.get('/x', (req, res) => res.end());

    await supertest(app).get('/x').set('traceparent', PARENT);

    expect(tracer.spans[0].parent.getValue(KEY)).toBe(PARENT);
  });

  test('the request id is the X-Request-Id, never the trace', async () => {
    const { telemetry, tracer } = wired();
    const app = express();

    app.use(requestId());
    app.use(telemetry.middleware());
    app.get('/x', (req, res) => res.end());

    await supertest(app)
      .get('/x')
      .set('traceparent', PARENT)
      .set('x-request-id', 'from-the-proxy');

    expect(tracer.spans[0].attributes['henri.request_id']).toBe(
      'from-the-proxy'
    );

    // ... and with no header at all it is a uuid of henri's, not the trace
    tracer.reset();
    await supertest(app).get('/x').set('traceparent', PARENT);

    expect(tracer.spans[0].attributes['henri.request_id']).toMatch(
      /^[0-9a-f-]{36}$/u
    );
    expect(tracer.spans[0].attributes['henri.request_id']).not.toContain(
      '4bf92f3577b34da6a3ce929d0e0e4736'
    );
  });

  test('inject writes the active context out, and propagate false does not', () => {
    const { telemetry } = wired();
    const carrier = {};

    api.context.with(api.context.active().setValue(KEY, PARENT), () =>
      telemetry.inject(carrier)
    );

    expect(carrier.traceparent).toBe(PARENT);

    const quiet = wired({ settings: { propagate: false } }).telemetry;
    const nothing = {};

    api.context.with(api.context.active().setValue(KEY, PARENT), () =>
      quiet.inject(nothing)
    );

    expect(nothing).toEqual({});
  });
});

describe('the metrics', () => {
  test('the request duration is a histogram by method, route and status', async () => {
    const { metrics, telemetry } = wired();
    const app = express();

    app.use(requestId());
    app.use(telemetry.middleware());
    app.get('/artworks/:id', (req, res) => res.status(201).end());

    await supertest(app).get('/artworks/1?secret=x');

    expect(metrics.recorded).toHaveLength(1);
    expect(metrics.recorded[0].name).toBe('http.server.request.duration');
    expect(metrics.recorded[0].value).toBeGreaterThan(0);
    expect(metrics.recorded[0].attributes).toEqual({
      'http.request.method': 'GET',
      'http.response.status_code': 201,
      'http.route': '/artworks/:id',
    });
  });

  test('an observable is asked for its value, never told one', () => {
    const { metrics, telemetry } = wired();
    let asked = 0;

    expect(
      telemetry.observe(
        'henri.cache.operations',
        { kind: 'counter' },
        (observe) => {
          asked += 1;
          observe(3, { 'henri.cache.outcome': 'hits' });
        }
      )
    ).toBe(true);

    expect(asked).toBe(0);

    metrics.callbacks.forEach((run) => run());

    expect(asked).toBe(1);
    expect(metrics.observed).toEqual([
      {
        attributes: { 'henri.cache.outcome': 'hits' },
        name: 'henri.cache.operations',
        value: 3,
      },
    ]);
  });

  test('one instrument per name, however many times it is asked for', () => {
    const { telemetry } = wired();

    expect(telemetry.histogram('a')).toBe(telemetry.histogram('a'));
  });

  test('metrics off and the middleware still spans, without measuring', async () => {
    const { metrics, telemetry, tracer } = wired({
      settings: { metrics: false },
    });
    const app = express();

    app.use(requestId());
    app.use(telemetry.middleware());
    app.get('/x', (req, res) => res.end());

    await supertest(app).get('/x');

    expect(tracer.spans).toHaveLength(1);
    expect(metrics.recorded).toEqual([]);
  });
});

describe('when the api misbehaves', () => {
  /** An api whose every call throws */
  const hostile = () => ({
    context: api.context,
    metrics: { getMeter: () => ({}) },
    propagation: api.propagation,
    trace: {
      ...api.trace,
      getTracer: () => ({
        /**
         * A tracer that refuses to trace
         *
         * @throws always
         * @returns {void}
         */
        startSpan: () => {
          throw new Error('the collector is on fire');
        },
      }),
    },
  });

  test('a tracer that throws never reaches the caller', () => {
    const henri = fakeHenri();
    const telemetry = new Telemetry({
      api: hostile(),
      henri,
      settings: {
        enabled: true,
        metrics: false,
        propagate: true,
        required: false,
        spans: [...BOUNDARIES],
      },
    });

    expect(telemetry.span('x', () => 'answered')).toBe('answered');
    expect(henri.lines[0][0]).toBe('warn');
  });

  test('and after enough of them telemetry turns itself off, once', () => {
    const henri = fakeHenri();
    const telemetry = new Telemetry({
      api: hostile(),
      henri,
      settings: {
        enabled: true,
        metrics: false,
        propagate: true,
        required: false,
        spans: [...BOUNDARIES],
      },
    });

    for (let index = 0; index < MAX_FAILURES + 3; index++) {
      expect(telemetry.span('x', () => index)).toBe(index);
    }

    expect(telemetry.enabled).toBe(false);
    expect(telemetry.failures).toBe(MAX_FAILURES);
    expect(henri.lines.filter(([level]) => level === 'error')).toHaveLength(1);
    expect(henri.lines[henri.lines.length - 1].join(' ')).toContain(
      'telemetry is off for this process'
    );
  });

  test('an observable callback that throws is counted, not propagated', () => {
    const metrics = meter();
    const henri = fakeHenri();
    const telemetry = new Telemetry({
      api: { context: api.context, metrics: { getMeter: () => metrics } },
      henri,
      settings: {
        enabled: true,
        metrics: true,
        propagate: false,
        required: false,
        spans: [],
      },
    });

    telemetry.observe('x', { kind: 'counter' }, () => {
      throw new Error('nope');
    });

    expect(() => metrics.callbacks.forEach((run) => run())).not.toThrow();
    expect(telemetry.failures).toBe(1);
  });
});

describe('the boot, on a real application', () => {
  test('telemetry.enabled true without the package fails the boot', () => {
    const henri = fakeHenri();
    const settings = telemetryConfig({
      get: () => ({ enabled: true }),
      has: (key) => key === 'telemetry',
    });

    expect(settings.required).toBe(true);

    let error = null;

    try {
      createTelemetry({ api: null, henri, settings });
    } catch (thrown) {
      error = thrown;
    }

    expect(error).not.toBeNull();
    expect(error.code).toBe('HENRI_TELEMETRY_UNAVAILABLE');
    expect(isCode(error.code)).toBe(true);
    expect(error.hint).toContain('@opentelemetry/api');

    // ... and the same settings with the package are simply on
    expect(createTelemetry({ api, henri, settings }).enabled).toBe(true);
  });

  test('asking for it without requiring it is silent when it is missing', () => {
    const henri = fakeHenri();
    const telemetry = createTelemetry({
      api: null,
      henri,
      settings: telemetryConfig({ get: () => undefined, has: () => false }),
    });

    expect(telemetry.enabled).toBe(false);
    expect(henri.lines).toEqual([]);
  });

  test('a booted application traces its own request end to end', async () => {
    const Henri = require('../henri');
    const tracer = recorder();

    api.trace.disable();
    api.trace.setGlobalTracerProvider(tracer);

    process.env.SKIP_WORKERS = '1';

    const henri = new Henri();

    await henri.init();

    try {
      expect(henri.telemetry.enabled).toBe(true);
      expect(henri.telemetry.spans).toContain('http');

      // The boot, out of henri.analyze()
      expect(tracer.spans.some((span) => span.name === 'henri.boot')).toBe(
        true
      );
      expect(
        tracer.spans.some((span) => span.name.startsWith('henri.module '))
      ).toBe(true);

      tracer.reset();

      await supertest(henri.server.app).get('/livez');

      const request = tracer.spans.find((span) => span.name.startsWith('GET'));

      expect(request).toBeDefined();
      expect(request.attributes['http.response.status_code']).toBe(200);
      expect(request.attributes['henri.request_id']).toMatch(
        /^[0-9a-f-]{36}$/u
      );
    } finally {
      await henri.stop();
      api.trace.disable();
      delete global.henri;
    }
  }, 60000);
});
