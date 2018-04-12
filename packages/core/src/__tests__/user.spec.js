const BaseModule = require('../base/module');
const Henri = require('../henri');
const User = require('../4.user');

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

  describe('with user object', () => {
    beforeAll(async () => {
      this.henri = new Henri({ runlevel: 4 });
      await this.henri.init();
      this.henri._user = {
        find: () => ['someUser'],
        id: 'userId',
      };
      await this.henri.user.init();
    });

    afterAll(async () => {
      await this.henri.stop();
    });

    test('should have login', async () => {
      expect(this.henri.passport).toBeDefined();
    });
  });
});
