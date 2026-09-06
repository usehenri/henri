const fs = require('fs');
const os = require('os');
const path = require('path');

const credentials = require('../base/credentials');
const { applyCredentials } = require('../0.config');

const SECRET = 'sk-live-do-not-print-me';

describe('credentials', () => {
  let dir;
  let key;

  const write = (env, values = { mail: { auth: { pass: SECRET } } }) =>
    credentials.write(dir, env, values, key);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-credentials-'));
    key = Buffer.from(credentials.generateKey(), 'hex');
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  describe('the envelope', () => {
    test('round trips', () => {
      const values = { list: [1, 2], mail: { auth: { pass: SECRET } } };
      const content = credentials.encrypt(values, key, 'production');

      expect(content).toMatch(/^henri:v1:[^:]+:[^:]+:[^:]+\n$/);
      expect(content).not.toContain(SECRET);
      expect(credentials.decrypt(content, key, 'production')).toEqual(values);
    });

    test('a wrong key opens nothing, and says nothing', () => {
      const content = credentials.encrypt({ pass: SECRET }, key, 'production');
      const other = Buffer.from(credentials.generateKey(), 'hex');

      expect(() => credentials.decrypt(content, other, 'production')).toThrow(
        /could not be decrypted: wrong key, or the file was modified/
      );
    });

    test('a tampered file fails instead of decrypting to nonsense', () => {
      const content = credentials.encrypt({ pass: SECRET }, key, 'production');
      const parts = content.trim().split(':');
      const body = Buffer.from(parts[4], 'base64');

      body[body.length - 1] ^= 0xff;
      parts[4] = body.toString('base64');

      expect(() =>
        credentials.decrypt(parts.join(':'), key, 'production')
      ).toThrow(/could not be decrypted/);
    });

    test('the environment is authenticated with the content', () => {
      const content = credentials.encrypt({ pass: SECRET }, key, 'production');

      expect(() => credentials.decrypt(content, key, 'staging')).toThrow(
        /could not be decrypted/
      );
    });

    test('anything else is not a credentials file', () => {
      expect(() => credentials.decrypt('hello', key, 'dev')).toThrow(
        /is not a henri credentials file/
      );
      expect(() => credentials.decrypt('henri:v2:a:b:c', key, 'dev')).toThrow(
        /is not a henri credentials file/
      );
    });
  });

  describe('the key', () => {
    test('is 64 hexadecimal characters', () => {
      expect(credentials.generateKey()).toMatch(/^[0-9a-f]{64}$/);
      expect(() => credentials.parseKey('short', 'the file')).toThrow(
        /The credentials key in the file is not 64 hexadecimal characters/
      );
      expect(() => credentials.parseKey(undefined, 'HENRI_X')).toThrow(
        /HENRI_X/
      );
    });

    test('comes from the variable first, then the file', () => {
      const file = credentials.keyFileFor(dir, 'dev');
      const other = credentials.generateKey();

      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${key.toString('hex')}\n`);

      expect(credentials.readKey(dir, 'dev', {})).toEqual({
        key,
        source: path.join('config', 'credentials', 'dev.key'),
      });
      expect(
        credentials.readKey(dir, 'dev', { HENRI_CREDENTIALS_KEY: other })
      ).toEqual({
        key: Buffer.from(other, 'hex'),
        source: 'HENRI_CREDENTIALS_KEY',
      });
    });

    test('missing, it is a failure naming the file and the variable', () => {
      write('production');

      expect(() => credentials.read(dir, 'production', {})).toThrow(
        /production.json.enc needs a key: set HENRI_CREDENTIALS_KEY, or put it back in .*production.key/
      );
    });
  });

  describe('reading them', () => {
    test('an application without a file has none', () => {
      expect(credentials.read(dir, 'production', {})).toBeNull();
    });

    test('every leaf is a configuration key', () => {
      write('production', {
        list: ['a'],
        mail: { auth: { pass: SECRET } },
        secret: 'x',
      });

      const found = credentials.read(dir, 'production', {
        HENRI_CREDENTIALS_KEY: key.toString('hex'),
      });

      expect(found.entries.map((entry) => entry.key)).toEqual([
        'list',
        'mail.auth.pass',
        'secret',
      ]);
      expect(found.source).toBe('HENRI_CREDENTIALS_KEY');
    });
  });

  describe('over the configuration', () => {
    const environment = () => ({ HENRI_CREDENTIALS_KEY: key.toString('hex') });

    test('a leaf replaces its key and leaves the rest of the file alone', () => {
      write('production', { mail: { auth: { pass: SECRET } }, secret: 'from' });

      const file = {
        mail: { auth: { user: 'postmaster' }, host: 'smtp.example.com' },
        port: 3000,
      };
      const { applied, config } = applyCredentials(
        file,
        dir,
        'production',
        environment()
      );

      expect(applied).toEqual(['mail.auth.pass', 'secret']);
      expect(config.mail).toEqual({
        auth: { pass: SECRET, user: 'postmaster' },
        host: 'smtp.example.com',
      });
      expect(config.port).toBe(3000);
      expect(config.secret).toBe('from');
      // The parsed configuration file is never modified
      expect(file.mail.auth).toEqual({ user: 'postmaster' });
    });

    test('an application without credentials is left alone', () => {
      const file = { port: 3000 };

      expect(applyCredentials(file, dir, 'production', {})).toEqual({
        applied: [],
        config: file,
        file: null,
        source: null,
      });
    });

    test('a wrong value fails the boot naming the file, never the value', async () => {
      const Config = require('../0.config');

      fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'config', 'production.json'),
        JSON.stringify({ stores: { default: { adapter: 'disk' } } })
      );
      credentials.write(
        dir,
        'production',
        { stores: { default: { adapter: SECRET } } },
        key
      );

      const config = new Config();

      config.henri = {
        cwd: () => dir,
        env: 'production',
        pen: { error: () => {}, info: () => {}, warn: () => {} },
      };

      process.env.HENRI_CREDENTIALS_KEY = key.toString('hex');

      let thrown = null;

      try {
        await config.init();
      } catch (error) {
        thrown = error;
      } finally {
        delete process.env.HENRI_CREDENTIALS_KEY;
      }

      expect(thrown.code).toBe('CONFIG_INVALID');
      expect(thrown.message).toContain('"stores.default.adapter"');
      expect(thrown.message).toContain(
        'from the credentials (config/credentials/production.json.enc)'
      );
      // Every value of that file is a secret: only its type is printed
      expect(thrown.message).toContain('it is a string');
      expect(thrown.message).not.toContain(SECRET);
    });

    test('the config module reads them, under the environment', async () => {
      const Config = require('../0.config');
      const lines = [];
      const record = (name, ...args) => lines.push(args.join(' => '));

      fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'config', 'production.json'),
        JSON.stringify({ port: 3000, secret: 'from-the-file' })
      );
      credentials.write(
        dir,
        'production',
        { mail: { auth: { pass: SECRET } }, secret: 'from-the-credentials' },
        key
      );

      const config = new Config();

      config.henri = {
        cwd: () => dir,
        env: 'production',
        pen: { error: record, info: record, warn: record },
      };

      process.env.HENRI_CREDENTIALS_KEY = key.toString('hex');
      process.env.HENRI_CONFIG__port = '8080';

      try {
        await config.init();

        expect(config.get('mail.auth.pass')).toBe(SECRET);
        expect(config.get('port')).toBe(8080);
        // The environment wins over the credentials, which win over the file
        expect(config.get('secret')).toBe('from-the-credentials');
        expect(config.fromCredentials).toEqual(['mail.auth.pass', 'secret']);

        process.env.HENRI_SECRET = 'from-the-environment';
        await config.reload();

        expect(config.get('secret')).toBe('from-the-environment');
      } finally {
        delete process.env.HENRI_CREDENTIALS_KEY;
        delete process.env.HENRI_CONFIG__port;
        delete process.env.HENRI_SECRET;
      }

      const printed = lines.join('\n');

      expect(printed).toContain(
        'from the credentials => mail.auth.pass, secret'
      );
      expect(printed).not.toContain(SECRET);
    });
  });

  test('no error ever holds a decrypted value', () => {
    write('production', { secret: SECRET });

    const content = fs.readFileSync(
      credentials.fileFor(dir, 'production'),
      'utf8'
    );
    const messages = [];
    const collect = (run) => {
      try {
        run();
      } catch (error) {
        messages.push(error.message);
      }
    };

    collect(() => credentials.read(dir, 'production', {}));
    collect(() =>
      credentials.decrypt(
        content,
        Buffer.from(credentials.generateKey(), 'hex'),
        'production'
      )
    );
    collect(() =>
      credentials.decrypt(
        credentials.encrypt('not an object', key, 'dev'),
        key,
        'dev'
      )
    );

    expect(messages).toHaveLength(3);
    expect(messages.join('\n')).not.toContain(SECRET);
    expect(messages.join('\n')).not.toContain(key.toString('hex'));
  });
});
