const BaseModule = require('../base/module');
const Henri = require('../henri');
const Config = require('../0.config');

let henri;

describe('config', () => {
  describe('in test', () => {
    beforeAll(async () => {
      henri = new Henri({ runlevel: 1 });
      await henri.init();
    });

    afterAll(async () => {
      await henri.stop();
    });

    test('should be defined', () => {
      expect(henri.config).toBeDefined();
    });

    test('should extend BaseModule', () => {
      expect(henri.config).toBeInstanceOf(BaseModule);
    });

    test('should match snapshot', () => {
      const config = new Config();

      expect(config).toMatchSnapshot();
    });

    test('should a stop function', () => {
      expect(Config.stop).toBeDefined();
    });

    test('should not throw if in safe mode', () => {
      expect(henri.config.get('boo', true)).toBeFalsy();
    });

    test('should throw if key does not exist', () => {
      expect(() => henri.config.get('boo')).toThrow(
        /Config key boo does not exist/
      );
    });

    test('should tell if key is present', () => {
      expect(henri.config.has('moo')).toBeFalsy();
    });

    test('should have the env key', () => {
      expect(henri.config.has('env')).toBeTruthy();
      expect(henri.config.get('env')).toEqual('test');
    });

    test('should not be able to modify the config', () => {
      expect(Object.isFrozen(henri.config.config)).toBeTruthy();
    });

    test('should reload', () => {
      expect(henri.config.reload()).toBeTruthy();
    });
  });
});

describe('config environment', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { loadDotEnv, withEnv } = require('../0.config');

  let dir;

  const clean = () => {
    delete process.env.HENRI_SECRET;
    delete process.env.HENRI_TEST_DOTENV;
    delete process.env.HENRI_TEST_QUOTED;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-env-'));
    clean();
  });

  afterEach(() => {
    clean();
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('loads .env without overriding the environment', () => {
    process.env.HENRI_TEST_DOTENV = 'from-env';
    fs.writeFileSync(
      path.join(dir, '.env'),
      [
        '# a comment',
        'HENRI_TEST_DOTENV=from-file',
        'export HENRI_TEST_QUOTED="quoted value"',
        'HENRI_SECRET=abc123',
        'not a line',
      ].join('\n')
    );

    expect(loadDotEnv(dir)).toBe(2);
    expect(process.env.HENRI_TEST_DOTENV).toBe('from-env');
    expect(process.env.HENRI_TEST_QUOTED).toBe('quoted value');
    expect(process.env.HENRI_SECRET).toBe('abc123');
    expect(loadDotEnv(path.join(dir, 'missing'))).toBe(0);
  });

  test('HENRI_SECRET provides or replaces the secret', () => {
    expect(withEnv({ secret: 'file' })).toEqual({ secret: 'file' });

    process.env.HENRI_SECRET = 'env';

    expect(withEnv({ port: 3000 })).toEqual({ port: 3000, secret: 'env' });
    expect(withEnv({ secret: 'file' })).toEqual({ secret: 'env' });
  });

  test('a booted henri reads the secret from the environment', async () => {
    process.env.HENRI_SECRET = 'from-the-environment';
    const henri = new Henri({ runlevel: 0 });

    await henri.init();

    try {
      expect(henri.config.get('secret')).toBe('from-the-environment');
      expect(Object.isFrozen(henri.config.config)).toBe(true);
    } finally {
      await henri.stop();
    }
  });
});

describe('config from the environment', () => {
  const {
    ENV_JSON_PREFIX,
    ENV_PREFIX,
    applyEnv,
    withEnv,
  } = require('../0.config');

  const file = () => ({
    baseRole: 'guest',
    filterParameters: ['password', 'token', 'secret', 'authorization'],
    inertia: { ssr: false },
    port: 3000,
    secret: 'from-the-file',
    stores: { default: { adapter: 'drizzle', url: 'postgres://file/db' } },
    trustProxy: true,
  });

  test('a missing variable changes nothing', () => {
    const { applied, config } = applyEnv(file(), {});

    expect(applied).toEqual([]);
    expect(config).toEqual(file());
    expect(config.secret).toBe('from-the-file');
    expect(Object.keys(config)).not.toContain('host');
  });

  test('the environment wins over the file, the generic form over an alias', () => {
    const { config } = applyEnv(file(), {
      DATABASE_URL: 'postgres://alias/db',
      HENRI_SECRET: 'from-the-alias',
      [`${ENV_PREFIX}secret`]: 'from-the-key',
    });

    expect(config.secret).toBe('from-the-key');
    expect(config.stores.default.url).toBe('postgres://alias/db');
    expect(config.stores.default.adapter).toBe('drizzle');
  });

  test('DATABASE_URL reaches the default store, HENRI_CONFIG__ a named one', () => {
    const { config } = applyEnv(file(), {
      DATABASE_URL: 'postgres://env/db',
      [`${ENV_PREFIX}stores__reporting__adapter`]: 'drizzle',
      [`${ENV_PREFIX}stores__reporting__url`]: 'postgres://env/reporting',
    });

    expect(config.stores.default.url).toBe('postgres://env/db');
    expect(config.stores.reporting).toEqual({
      adapter: 'drizzle',
      url: 'postgres://env/reporting',
    });
  });

  test('DATABASE_URL without a default store is reported, not applied', () => {
    const { applied, config } = applyEnv(
      { port: 3000 },
      { DATABASE_URL: 'postgres://env/db' }
    );

    expect(config.stores).toBeUndefined();
    expect(applied[0].ignored).toMatch(/no "stores.default"/);
  });

  test('the file gives the type: a number, a boolean, an object', () => {
    const { config } = applyEnv(file(), {
      [`${ENV_JSON_PREFIX}inertia`]: '{"ssr":true,"id":"app"}',
      [`${ENV_PREFIX}port`]: '8080',
      [`${ENV_PREFIX}trustProxy`]: 'false',
    });

    expect(config.port).toBe(8080);
    expect(config.trustProxy).toBe(false);
    expect(config.inertia).toEqual({ id: 'app', ssr: true });
  });

  test('a value the file types as a string stays one', () => {
    const { config } = applyEnv(file(), {
      [`${ENV_PREFIX}stores__default__url`]: '5432',
    });

    expect(config.stores.default.url).toBe('5432');
  });

  test('a key the file does not have is a string, unless it is JSON', () => {
    const { config } = applyEnv(file(), {
      [`${ENV_JSON_PREFIX}rateLimit`]: '{"max":10}',
      [`${ENV_PREFIX}mail__host`]: 'smtp.example.com',
    });

    expect(config.mail).toEqual({ host: 'smtp.example.com' });
    expect(config.rateLimit).toEqual({ max: 10 });
  });

  test('a value that does not fit its key fails the boot', () => {
    expect(() => applyEnv(file(), { [`${ENV_PREFIX}port`]: 'nope' })).toThrow(
      /HENRI_CONFIG__port is not a number/
    );
    expect(() =>
      applyEnv(file(), { [`${ENV_PREFIX}trustProxy`]: 'yes' })
    ).toThrow(/is not true or false/);
    expect(() => applyEnv(file(), { [`${ENV_PREFIX}inertia`]: 'ssr' })).toThrow(
      /is not a JSON object/
    );
  });

  test('invalid JSON fails without quoting the value', () => {
    let thrown = null;

    try {
      applyEnv(file(), { [`${ENV_JSON_PREFIX}secret`]: 'hunter2' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown.message).toBe('HENRI_CONFIG_JSON__secret is not valid JSON');
    expect(thrown.message).not.toContain('hunter2');
  });

  test('an empty variable is never a silent empty string', () => {
    expect(() => applyEnv(file(), { [`${ENV_PREFIX}baseRole`]: '' })).toThrow(
      /is set but empty/
    );

    // The shorthands keep their truthiness: an empty one is unset, not empty
    const { applied, config } = applyEnv(file(), {
      DATABASE_URL: '',
      HENRI_SECRET: '',
    });

    expect(applied).toEqual([]);
    expect(config.secret).toBe('from-the-file');
  });

  test('a variable naming no key is refused', () => {
    expect(() => applyEnv(file(), { [ENV_PREFIX]: 'x' })).toThrow(
      /names no configuration key/
    );
  });

  test('the configuration file object is never modified', () => {
    const original = file();

    applyEnv(original, {
      [`${ENV_PREFIX}stores__default__url`]: 'postgres://env/db',
    });

    expect(original.stores.default.url).toBe('postgres://file/db');
  });

  test('withEnv keeps its signature', () => {
    expect(withEnv({ secret: 'file' }, {})).toEqual({ secret: 'file' });
    expect(withEnv({ port: 3000 }, { HENRI_SECRET: 'env' })).toEqual({
      port: 3000,
      secret: 'env',
    });
  });

  describe('the boot report', () => {
    const report = (config, applied) => {
      const lines = [];
      const write = (name, ...args) => lines.push(args.join(' => '));
      const instance = new Config();

      instance.henri = { pen: { info: write, warn: write } };
      instance.config = config;
      instance.report(applied);

      return lines;
    };

    test('prints the key and the variable, masking the secrets', () => {
      const { applied, config } = applyEnv(file(), {
        DATABASE_URL: 'postgres://henri:hunter2@db.internal:5432/app',
        HENRI_SECRET: 'super-secret-value',
        [`${ENV_PREFIX}port`]: '8080',
      });
      const lines = report(config, applied);

      expect(lines).toEqual([
        'from the environment => secret = [FILTERED] => HENRI_SECRET',
        'from the environment => stores.default.url = postgres://henri:[FILTERED]@db.internal:5432/app => DATABASE_URL',
        'from the environment => port = 8080 => HENRI_CONFIG__port',
      ]);
      expect(lines.join('\n')).not.toContain('super-secret-value');
      expect(lines.join('\n')).not.toContain('hunter2');
    });

    test('masks what config.filterParameters names, and nothing else', () => {
      const { applied, config } = applyEnv(
        { filterParameters: ['apiKey'] },
        {
          [`${ENV_JSON_PREFIX}mail`]: '{"host":"smtp","auth":{"pass":"pw"}}',
          [`${ENV_PREFIX}apiKey`]: 'ak-1',
          [`${ENV_PREFIX}baseRole`]: 'guest',
        }
      );
      const lines = report(config, applied).join('\n');

      expect(lines).toContain('apiKey = [FILTERED]');
      expect(lines).toContain('baseRole = guest');
      expect(lines).not.toContain('ak-1');
      // `pass` is not one of the names this configuration filters
      expect(lines).toContain('{"host":"smtp","auth":{"pass":"pw"}}');
    });

    test('says when a variable was ignored', () => {
      const { applied, config } = applyEnv(
        { port: 3000 },
        { DATABASE_URL: 'postgres://env/db' }
      );

      expect(report(config, applied)).toEqual([
        'DATABASE_URL => ignored: the configuration has no "stores.default"',
      ]);
    });
  });

  describe('the schema gate', () => {
    const { provenance } = require('../0.config');

    test('names where a value came from, the longest path winning', () => {
      const source = provenance(
        'config/test.json',
        {
          applied: ['secret', 'mail.auth.pass'],
          file: 'config/credentials/test.json.enc',
        },
        [
          { key: 'rateLimit', variable: `${ENV_JSON_PREFIX}rateLimit` },
          {
            ignored: 'the configuration has no "stores.default"',
            key: 'stores.default.url',
            variable: 'DATABASE_URL',
          },
        ]
      );

      expect(source('rateLimit.auth.max')).toBe(`${ENV_JSON_PREFIX}rateLimit`);
      expect(source('mail.auth.pass')).toBe(
        'the credentials (config/credentials/test.json.enc)'
      );
      expect(source('mail.host')).toBe('config/test.json');
      // A shorthand that was ignored never claims its key
      expect(source('stores.default.url')).toBe('config/test.json');
      expect(source('')).toBe('config/test.json');
    });

    test('a wrong value from the environment fails the boot by name', async () => {
      process.env[`${ENV_PREFIX}port`] = 'nope';

      const henri = new Henri({ runlevel: 0 });
      let thrown = null;

      try {
        await henri.init();
      } catch (error) {
        thrown = error;
      } finally {
        delete process.env[`${ENV_PREFIX}port`];
        await henri.stop();
      }

      expect(thrown).not.toBeNull();
      expect(thrown.cause.code).toBe('HENRI_CONFIG_INVALID');
      expect(thrown.cause.problems).toHaveLength(1);
      expect(thrown.cause.message).toBe(
        'invalid configuration (1 problem): port'
      );
      expect(thrown.cause.problems[0]).toMatchObject({
        key: 'port',
        message:
          '"port" must be a port number between 1 and 65535, but it is the string "nope"',
        source: `${ENV_PREFIX}port`,
      });
    });

    test('an unknown key is a warning, and the boot goes on', async () => {
      const henri = new Henri({ runlevel: 0 });

      await henri.init();

      try {
        // The demo application carries an `env` key of its own
        expect(henri.config.get('env')).toBe('test');
        expect(
          henri.config
            .check(() => 'config/test.json')
            .map((problem) => problem.key)
        ).toEqual(['env']);
      } finally {
        await henri.stop();
      }
    });
  });

  test('a booted henri reads a key from the environment', async () => {
    process.env[`${ENV_PREFIX}baseRole`] = 'from-the-environment';

    const henri = new Henri({ runlevel: 0 });

    await henri.init();

    try {
      expect(henri.config.get('baseRole')).toBe('from-the-environment');
      expect(henri.config.fromEnv).toEqual([
        { key: 'baseRole', variable: `${ENV_PREFIX}baseRole` },
      ]);
    } finally {
      delete process.env[`${ENV_PREFIX}baseRole`];
      await henri.stop();
    }
  });
});
