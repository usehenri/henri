const BaseModule = require('../base/module');

let base = new BaseModule();

describe('base module', () => {
  test('should have default value', () => {
    expect(base.name).toBe('unnamed');
    expect(base.runlevel).toBe(6);
    expect(base.key).toBeNull();
    expect(base.reloadable).toBeFalsy();
  });

  test('should have default methods', () => {
    expect(base.init).toBeDefined();
    expect(base.info).toBeDefined();
    expect(base.reload).toBeUndefined();
    expect(base.setup).toBeDefined();
    expect(base.start).toBeDefined();
    expect(base.stop).toBeUndefined();
  });

  test('should return console', () => {
    // eslint-disable-next-line no-console
    console.log = jest.fn();
    BaseModule._out();
    // eslint-disable-next-line no-console
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  test('should have default messages', () => {
    BaseModule._out = jest.fn();

    base.init();
    base.info();
    base.setup();
    base.start();

    expect(BaseModule._out).toHaveBeenCalledTimes(4);
  });
});
