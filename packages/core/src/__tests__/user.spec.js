const BaseModule = require('../base/module');
const Henri = require('../henri');
const User = require('../4.user');

let henri;

const email = 'testing@usehenri.io';
const password = 'delectorskaya';

describe('user', () => {
  describe('basic', () => {
    beforeAll(async () => {
      henri = new Henri({ runlevel: 4 });
      await henri.init();
    }, 60000);

    afterAll(async () => {
      await henri.stop();
    }, 60000);

    test('should be defined', () => {
      expect(henri.user).toBeDefined();
    }, 15000);

    test('should extend BaseModule', () => {
      expect(henri.user).toBeInstanceOf(BaseModule);
    }, 15000);

    test('should match snapshot', () => {
      const controllers = new User();

      expect(controllers).toMatchSnapshot();
    }, 15000);

    test('encryption', async () => {
      const { encrypt } = henri.user;
      let hash = await encrypt(password);

      expect(hash).not.toBe(password);
      await expect(encrypt()).rejects.toBeDefined();
      await expect(encrypt('lydia')).rejects.toBeDefined();
      await expect(encrypt(password)).resolves.toBeDefined();
    }, 15000);

    test('a password below the policy is a validation failure', async () => {
      const error = await henri.user.encrypt('lydia').catch((thrown) => thrown);

      // The shape every adapter rejects an invalid write with, so a
      // controller answers 422 next to the field instead of 500
      expect(error.name).toBe('ValidationError');
      expect(error.codes).toEqual(['too_short']);
      expect(henri.model.errors(error)).toEqual({
        password: expect.stringContaining('at least'),
      });

      const missing = await henri.user.encrypt().catch((thrown) => thrown);

      expect(missing.codes).toEqual(['missing']);
      expect(henri.model.errors(missing)).toEqual({
        password: 'a password is required',
      });
    }, 15000);

    test('compare', async () => {
      const { encrypt, compare } = henri.user;
      let hash = await encrypt(password);

      expect(hash).not.toBe(password);
      await expect(compare(password, hash)).resolves.toBe(true);
      await expect(compare('lydia', hash)).rejects.toBeDefined();
    });
  }, 30000);

  describe.skip('with user object', () => {
    beforeAll(async () => {
      henri = new Henri();
      await henri.init();
    });

    afterAll(async () => {
      await henri._user.destroy({});
      await henri.stop();
    });

    test('should have login', async () => {
      expect(henri.passport).toBeDefined();

      let res = await fetch(`${henri.server.url}login`, {
        method: 'POST',
      }).then((res) => res);

      expect(res.status).toEqual(400);
    });

    test.skip('should login', async () => {
      await henri._user.destroy({ email });

      let res = await fetch(`${henri.server.url}register`, {
        body: JSON.stringify({ email, password }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }).then((res) => res.json());

      expect(res).toEqual({ status: 'ok' });
    });
  });
}, 16000);
