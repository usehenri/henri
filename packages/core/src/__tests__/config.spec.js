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
