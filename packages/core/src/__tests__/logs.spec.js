const Pen = require('../0.pen');
const {
  KEYS,
  entry,
  errorOf,
  formatOf,
  serialize,
  strip,
} = require('../base/logs');
const { context } = require('../base/request-id');
const { redactor } = require('../base/redact');

/**
 * A henri look-alike: a configuration, an environment and the personal
 * field names the privacy module would have collected
 *
 * @param {object} [config={}] the configuration
 * @param {object} [options={}] `isProduction` and `personal`
 * @returns {object} the instance
 */
const fakeHenri = (
  config = {},
  { isProduction = false, personal = [] } = {}
) => ({
  config: {
    get: (key) =>
      key.split('.').reduce((found, part) => found && found[part], config),
    has: (key) =>
      key
        .split('.')
        .reduce(
          (found, part) =>
            found && Object.prototype.hasOwnProperty.call(found, part)
              ? found[part]
              : undefined,
          config
        ) !== undefined,
  },
  isProduction,
  privacy: { keys: new Set(personal) },
  release: '0.42.0',
});

/**
 * A pen writing json, and the lines it wrote
 *
 * @param {object} henri the instance
 * @returns {{lines: Array<object>, pen: Pen}} the pen and what it wrote
 */
const jsonPen = (henri) => {
  const pen = new Pen(false, henri);
  const lines = [];

  pen.initialized = true;
  pen.shout = ((original) =>
    function shout(...args) {
      const answer = original.apply(this, args);

      answer && lines.push(JSON.parse(answer.data));

      return answer;
    })(Pen.prototype.shout);

  return { lines, pen };
};

describe('the log format', () => {
  test('auto is json in production and pretty everywhere else', () => {
    expect(formatOf(fakeHenri())).toBe('pretty');
    expect(formatOf(fakeHenri({}, { isProduction: true }))).toBe('json');
    expect(formatOf(null)).toBe('pretty');
  });

  test('the configuration says it outright, whatever the environment', () => {
    expect(formatOf(fakeHenri({ logs: { format: 'json' } }))).toBe('json');
    expect(
      formatOf(
        fakeHenri({ logs: { format: 'pretty' } }, { isProduction: true })
      )
    ).toBe('pretty');
    expect(formatOf(fakeHenri({ logs: { format: 'auto' } }))).toBe('pretty');
  });

  test('a line carries the fields the pretty format spends on alignment', () => {
    const line = entry({
      args: ['GET /artworks', 200],
      level: 'info',
      name: 'router',
      time: new Date('2026-09-06T12:00:00.000Z'),
    });

    expect(line).toEqual({
      level: 'info',
      module: 'router',
      msg: 'GET /artworks 200',
      time: '2026-09-06T12:00:00.000Z',
    });
  });

  test('no field nobody declared can appear in a line', () => {
    const line = entry({
      args: ['boom', new Error('nope'), { page: 2 }],
      level: 'error',
      name: 'server',
    });

    expect(Object.keys(line).every((key) => KEYS.includes(key))).toBe(true);
  });

  test('the request id of the request being handled is a field', async () => {
    const line = await context.run({ id: 'req-42' }, async () =>
      entry({ args: ['done'], name: 'router' })
    );

    expect(line.requestId).toBe('req-42');
    expect(entry({ args: ['done'], name: 'router' }).requestId).toBeUndefined();
  });

  test('an error becomes fields, with its code and its cause chain', () => {
    const cause = new Error('no store');

    cause.code = 'HENRI_MODEL_NO_STORE';

    const failure = new Error('boot failed', { cause });

    failure.code = 'HENRI_BOOT_FAILED';

    const found = errorOf(failure);

    expect(found.code).toBe('HENRI_BOOT_FAILED');
    expect(found.message).toBe('boot failed');
    expect(found.stack).toContain('boot failed');
    expect(found.cause.code).toBe('HENRI_MODEL_NO_STORE');
  });

  test('objects are a list, whatever their number, and errors are not', () => {
    const line = entry({ args: [{ a: 1 }, { b: 2 }, new Error('x')] });

    expect(line.data).toEqual([{ a: 1 }, { b: 2 }]);
    expect(line.err.message).toBe('x');
  });

  test('the colours of the pretty format never reach a line', () => {
    const esc = String.fromCharCode(27);
    const coloured = `${esc}[1mHENRI_BOOT_FAILED${esc}[22m`;

    expect(strip(coloured)).toBe('HENRI_BOOT_FAILED');
    expect(entry({ args: [coloured] }).msg).toBe('HENRI_BOOT_FAILED');
  });

  test('a line that cannot be serialized is still a line', () => {
    const circular = { level: 'info', module: 'x', msg: '', time: 'now' };

    circular.self = circular;

    expect(JSON.parse(serialize(circular)).msg).toBe(
      '[unserializable log line]'
    );
  });
});

describe('what a json line never carries', () => {
  test('a filtered parameter, at every depth', () => {
    const { lines, pen } = jsonPen(fakeHenri({ logs: { format: 'json' } }));

    pen.info('signup', 'received', {
      deep: [{ user: { apiToken: 'sk-live-1', password: 'hunter2' } }],
      email: 'ada@example.com',
    });

    const [line] = lines;

    expect(JSON.stringify(line)).not.toContain('hunter2');
    expect(JSON.stringify(line)).not.toContain('sk-live-1');
    expect(line.data[0].deep[0].user).toEqual({
      apiToken: '[FILTERED]',
      password: '[FILTERED]',
    });
    // Nothing named it, so it is not masked: filterParameters is a list
    expect(line.data[0].email).toBe('ada@example.com');
  });

  test('the names a model marked personal, even with filterParameters off', () => {
    const { lines, pen } = jsonPen(
      fakeHenri(
        { filterParameters: false, logs: { format: 'json' } },
        { personal: ['email', 'name'] }
      )
    );

    pen.info('privacy', { password: 'hunter2', user: { email: 'ada@x.io' } });

    const [line] = lines;

    expect(line.data[0].user.email).toBe('[FILTERED]');
    // Turned off, filterParameters masks nothing by name, as it always has
    expect(line.data[0].password).toBe('hunter2');
  });

  test('the key that opens the encrypted columns, whatever the filters say', () => {
    const key = 'deadbeef'.repeat(8);

    for (const filterParameters of [
      undefined,
      false,
      ['ssn'],
      ['password', 'token', 'secret', 'authorization'],
    ]) {
      const { lines, pen } = jsonPen(
        fakeHenri({ filterParameters, logs: { format: 'json' } })
      );

      // What an application logs when it prints its own configuration
      pen.info('boot', 'configuration', {
        encryption: { keys: [key], readPlaintext: false },
        port: 3000,
      });

      const [line] = lines;

      expect(JSON.stringify(line)).not.toContain(key);
      expect(line.data[0]).toEqual({ encryption: '[FILTERED]', port: 3000 });
    }
  });

  test('the masking is the one pen has always applied, from one place', () => {
    const henri = fakeHenri({}, { personal: ['nickname'] });
    const value = { nickname: 'ada', secret: 'x' };

    expect(redactor(henri)(value)).toEqual({
      nickname: '[FILTERED]',
      secret: '[FILTERED]',
    });
    expect(new Pen(false, henri).redact(value)).toEqual(redactor(henri)(value));
  });
});

describe('pen in json', () => {
  test('every level writes one object per line, on stdout', () => {
    const { lines, pen } = jsonPen(fakeHenri({ logs: { format: 'json' } }));

    pen.warn('server', 'busy');
    pen.error('server', 'down');

    expect(lines.map((line) => [line.level, line.module, line.msg])).toEqual([
      ['warn', 'server', 'busy'],
      ['error', 'server', 'down'],
    ]);
  });

  test('fatal is one record with the error, its code and its stack', () => {
    const { lines, pen } = jsonPen(fakeHenri({ logs: { format: 'json' } }));
    const error = pen.fatal(
      'view',
      'unknown renderer',
      'the renderer is not one henri knows',
      { renderer: 'preact' },
      'HENRI_VIEW_UNKNOWN_RENDERER'
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('HENRI_VIEW_UNKNOWN_RENDERER');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      err: { code: 'HENRI_VIEW_UNKNOWN_RENDERER' },
      level: 'error',
      module: 'view',
    });
    expect(lines[0].err.message).toContain('unknown renderer');
    expect(lines[0].data).toEqual([{ renderer: 'preact' }]);
  });

  test('fatal of an Error is the error, and not what sat beside it', () => {
    const { lines, pen } = jsonPen(fakeHenri({ logs: { format: 'json' } }));
    const thrown = new Error('rejected');

    // What base/henri.js hands an unhandled rejection: the promise holds
    // nothing worth a field, and the pretty format does not print it either
    expect(pen.fatal('promise', thrown, null, Promise.resolve())).toBe(thrown);
    expect(lines[0].data).toBeUndefined();
    expect(lines[0].err.message).toBe('rejected');
  });

  test('blank lines are spacing for a person, so json has none', () => {
    const pen = new Pen(false, fakeHenri({ logs: { format: 'json' } }));
    const printed = console.log;
    const spy = vi.fn();

    console.log = spy;
    pen.notTest = true;
    pen.line(3);
    console.log = printed;

    expect(spy).not.toHaveBeenCalled();
  });

  test('the pretty format is what it was', () => {
    const pen = new Pen(false, fakeHenri());

    pen.initialized = true;
    pen.customWidth = 120;

    const { data } = pen.shout('router', 'info', 'GET /artworks');

    expect(data).toContain('✏');
    expect(data).toContain('GET /artworks');
    expect(() => JSON.parse(data)).toThrow();
  });
});
