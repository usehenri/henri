const fs = require('fs');
const os = require('os');
const path = require('path');

const Henri = require('../henri');
const Mailer = require('../1.mailer');

/**
 * A minimal henri for the mailer
 *
 * @param {object} options { mail, isTest, forceMail, cwd }
 * @returns {object} a henri look-alike
 */
const fakeHenri = ({
  mail,
  isTest = false,
  forceMail = undefined,
  cwd = process.cwd(),
} = {}) => ({
  config: {
    get: (key, safe) => {
      if (key === 'mail' && typeof mail !== 'undefined') {
        return mail;
      }
      if (safe) {
        return false;
      }
      throw new Error(`Config key ${key} does not exist`);
    },
    has: (key) => key === 'mail' && typeof mail !== 'undefined',
  },
  cwd: () => cwd,
  forceMail,
  isTest,
  pen: {
    error: () => {},
    info: () => {},
    warn: () => {},
  },
});

/**
 * A nodemailer look-alike recording what it receives
 *
 * @param {object} [options={}] { verifyError }
 * @returns {{nodemailer: object, calls: object}} the stub and its records
 */
const fakeNodemailer = ({ verifyError = null } = {}) => {
  const calls = { configs: [], sent: [], verified: 0 };
  const nodemailer = {
    createTransport: (config) => {
      calls.configs.push(config);

      return {
        close: () => {},
        sendMail: async (opts) => {
          calls.sent.push(opts);

          return { messageId: '<stub@henri>' };
        },
        verify: async () => {
          calls.verified++;
          if (verifyError) {
            throw verifyError;
          }

          return true;
        },
      };
    },
    getTestMessageUrl: () => 'https://ethereal.email/message/stub',
  };

  return { calls, nodemailer };
};

describe('mailer', () => {
  test('an object configuration creates and verifies the transport', async () => {
    const config = {
      auth: { pass: 'secret', user: 'apikey' },
      host: 'smtp.example.com',
      port: 587,
      secure: false,
    };
    const mailer = new Mailer();
    const { calls, nodemailer } = fakeNodemailer();

    mailer.henri = fakeHenri({ mail: config });
    mailer.nodemailer = nodemailer;

    await expect(mailer.init()).resolves.toBe('mail');

    expect(calls.configs).toEqual([config]);
    expect(calls.verified).toBe(1);
    expect(mailer.transporter).toBeDefined();

    const info = await mailer.send({ subject: 'hi', to: 'a@b.c' });

    expect(info.messageId).toBe('<stub@henri>');
    expect(calls.sent).toEqual([{ subject: 'hi', to: 'a@b.c' }]);
  });

  test('a transport that does not verify fails init', async () => {
    const mailer = new Mailer();
    const { nodemailer } = fakeNodemailer({
      verifyError: new Error('Invalid login'),
    });

    mailer.henri = fakeHenri({ mail: { host: 'smtp.example.com' } });
    mailer.nodemailer = nodemailer;

    await expect(mailer.init()).rejects.toThrow('Invalid login');
  });

  test('a configuration that is neither an object nor "test" is refused', async () => {
    const mailer = new Mailer();

    mailer.henri = fakeHenri({ mail: 42 });

    await expect(mailer.init()).rejects.toThrow(/transport object or "test"/);
  });

  test('without configuration the module loads without a transport', async () => {
    const mailer = new Mailer();

    mailer.henri = fakeHenri();

    await expect(mailer.init()).resolves.toBe('mail');
    expect(mailer.transporter).toBeUndefined();
  });

  test('send rejects without a transport', async () => {
    const mailer = new Mailer();

    mailer.henri = fakeHenri();

    await expect(mailer.send({ to: 'a@b.c' })).rejects.toThrow(
      /without proper transport/
    );
  });

  describe('in test mode', () => {
    let cwd;

    beforeEach(() => {
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-mail-'));
    });

    afterEach(() => {
      fs.rmSync(cwd, { force: true, recursive: true });
    });

    test('uses the json transport: no network, no .mailerTestCreds', async () => {
      const mailer = new Mailer();

      mailer.henri = fakeHenri({ cwd, isTest: true, mail: 'test' });
      mailer.nodemailer = Object.assign({}, mailer.nodemailer, {
        createTestAccount: async () => {
          throw new Error('network access is not allowed in tests');
        },
      });

      await expect(mailer.init()).resolves.toBe('mail');

      expect(mailer.config).toEqual({ jsonTransport: true });
      expect(mailer.transporter).toBeDefined();
      expect(fs.existsSync(path.join(cwd, '.mailerTestCreds'))).toBe(false);

      const info = await mailer.send({
        from: 'a@b.c',
        subject: 'hello',
        text: 'world',
        to: 'd@e.f',
      });

      expect(info.messageId).toMatch(/@/);
      expect(JSON.parse(info.message).subject).toBe('hello');
    });

    test('forceMail keeps the configured transport', async () => {
      const config = { host: 'smtp.example.com', port: 25 };
      const mailer = new Mailer();
      const { calls, nodemailer } = fakeNodemailer();

      mailer.henri = fakeHenri({
        cwd,
        forceMail: true,
        isTest: true,
        mail: config,
      });
      mailer.nodemailer = nodemailer;

      await expect(mailer.init()).resolves.toBe('mail');

      expect(calls.configs).toEqual([config]);
      expect(calls.verified).toBe(1);
    });
  });

  describe('through henri', () => {
    test('henri.mail is ready with the json transport under NODE_ENV=test', async () => {
      const henri = new Henri({ runlevel: 1 });

      await henri.init();

      try {
        expect(henri.mail.transporter).toBeDefined();
        expect(henri.mail.config).toEqual({ jsonTransport: true });

        const info = await henri.mail.send({
          from: 'a@b.c',
          subject: 'through henri',
          text: 'ok',
          to: 'd@e.f',
        });

        expect(info.messageId).toMatch(/@/);
      } finally {
        await henri.stop();
      }
    });
  });
});
