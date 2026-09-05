const BaseModule = require('../base/module');
const Henri = require('../henri');
const Config = require('../0.config');

describe('config', () => {
  describe('in test', () => {
    beforeAll(async () => {
      this.henri = new Henri({ runlevel: 1 });
      await this.henri.init();
    });

    afterAll(async () => {
      await this.henri.stop();
    });

    test('should be defined', () => {
      expect(this.henri.config).toBeDefined();
    });

    test('should extend BaseModule', () => {
      expect(this.henri.config).toBeInstanceOf(BaseModule);
    });

    test('should match snapshot', () => {
      const config = new Config();

      expect(config).toMatchSnapshot();
    });

    test('should a stop function', () => {
      expect(Config.stop).toBeDefined();
    });

    test('should not throw if in safe mode', () => {
      expect(this.henri.config.get('boo', true)).toBeFalsy();
    });

    test('should throw if key does not exist', () => {
      expect(() => this.henri.config.get('boo')).toThrow(
        /Config key boo does not exist/
      );
    });

    test('should tell if key is present', () => {
      expect(this.henri.config.has('moo')).toBeFalsy();
    });

    test('should have the env key', () => {
      expect(this.henri.config.has('env')).toBeTruthy();
      expect(this.henri.config.get('env')).toEqual('test');
    });

    test('should not be able to modify the config', () => {
      expect(Object.isFrozen(this.henri.config.config)).toBeTruthy();
    });

    test('should reload', () => {
      expect(this.henri.config.reload()).toBeTruthy();
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
