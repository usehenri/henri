const BaseModule = require('../base/module');
const Henri = require('../henri');
const User = require('../4.user');

const fetch = require('isomorphic-fetch');

const email = 'testing@usehenri.io';
const password = 'delectorskaya';

describe('user', () => {
  describe('basic', () => {
    beforeAll(async () => {
      this.henri = new Henri({ runlevel: 4 });
      await this.henri.init();
    });

    afterAll(async () => {
      await this.henri.stop();
    });

    test('should be defined', () => {
      expect(this.henri.user).toBeDefined();
    });

    test('should extend BaseModule', () => {
      expect(this.henri.user).toBeInstanceOf(BaseModule);
    });

    test('should match snapshot', () => {
      const controllers = new User();

      expect(controllers).toMatchSnapshot();
    });

    test('encryption', async () => {
      const { encrypt } = this.henri.user;
      let hash = await encrypt(password);

      expect(hash).not.toBe(password);
      await expect(encrypt()).rejects.toBeDefined();
      await expect(encrypt('lydia')).rejects.toBeDefined();
      await expect(encrypt(password)).resolves.toBeDefined();
    });

    test('compare', async () => {
      const { encrypt, compare } = this.henri.user;
      let hash = await encrypt(password);

      expect(hash).not.toBe(password);
      await expect(compare(password, hash)).resolves.toBe(true);
      await expect(compare('lydia', hash)).rejects.toBeDefined();
    });
  });

  xdescribe('with user object', () => {
    beforeAll(async () => {
      this.henri = new Henri();
      await this.henri.init();
    });

    afterAll(async () => {
      await this.henri._user.destroy({});
      await this.henri.stop();
    });

    test('should have login', async () => {
      expect(this.henri.passport).toBeDefined();

      let res = await fetch(`${this.henri.server.url}login`, {
        method: 'POST',
      }).then(res => res);

      expect(res.status).toEqual(400);
    });

    xtest('should login', async () => {
      await this.henri._user.destroy({ email });

      let res = await fetch(`${this.henri.server.url}register`, {
        body: JSON.stringify({ email, password }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }).then(res => res.json());

      expect(res).toEqual({ status: 'ok' });
    });
  });
}, 16000);
