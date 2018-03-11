const BaseModule = require('../base/module');

let base = new BaseModule();

describe('base module', () => {
  test('should have default value', () => {
    expect(base.name).toBe('unnamed');
    expect(base.runlevel).toBe(5);
    expect(base.key).toBeNull();
    expect(base.reloadable).toBeFalsy();
  });

  test('should have default methods', () => {
    expect(base.init).toBeDefined();
    expect(base.info).toBeDefined();
    expect(base.reload).toBeDefined();
    expect(base.setup).toBeDefined();
    expect(base.start).toBeDefined();
    expect(base.stop).toBeDefined();
  });

  test('should return console', () => {
    // eslint-disable-next-line no-console
    console.log = jest.fn();
    base._out();
    // eslint-disable-next-line no-console
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  test('should have default messages', () => {
    base._out = jest.fn();

    base.init();
    base.info();
    base.reload();
    base.setup();
    base.start();
    base.stop();

    expect(base._out).toHaveBeenCalledTimes(6);
  });
});
