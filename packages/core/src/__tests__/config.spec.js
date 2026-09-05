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
