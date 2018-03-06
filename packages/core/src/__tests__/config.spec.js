const henri = require('../henri');
const Config = require('../config');
const BaseModule = require('../base/module');

describe('config', () => {
  beforeEach(() => {
    require('../index');
  });

  test('should be accessible from henri', () => {
    expect(henri.config).toBeDefined();
    expect(henri.config.name).toBe('config');
  });

  test('loads data', () => {
    const data = henri.config.get('abc');
    expect(data).toEqual('c');
  });

  test('should suppress warnings', () => {
    expect(process.env.SUPPRESS_NO_CONFIG_WARNING).toBeTruthy();
  });

  test('inherits from BaseModule', () => {
    const newConfig = new Config();
    expect(newConfig).toBeInstanceOf(Config);
    expect(newConfig).toBeInstanceOf(BaseModule);
    expect(henri.config.reload).toBeDefined();
    expect(henri.config.init).toBeDefined();
    expect(henri.config.setup).toBeDefined();
    expect(henri.config.start).toBeDefined();
    expect(henri.config.stop).toBeDefined();
  });

  test('it reloads', () => {
    expect(henri.config.reloadable).toBeTruthy();
    henri.config.reload();
  });

  test('has a safe mode', () => {
    expect(() => henri.config.get('unknown key')).toThrow();
    expect(() => henri.config.get('unknown key', true)).not.toThrow();
    expect(henri.config.get('unknown key', true)).toBeFalsy();
  });
});
