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
    expect(base.reload).toBeUndefined();
    expect(base.stop).toBeUndefined();
  });

  test('should not carry the old lifecycle stubs', () => {
    expect(base.setup).toBeUndefined();
    expect(base.start).toBeUndefined();
    expect(base.info).toBeUndefined();
  });

  test('should return console', () => {
     
    const log = console.log;
    let calls = 0;

     
    console.log = () => calls++;
    try {
      BaseModule._out();
    } finally {
       
      console.log = log;
    }

    expect(calls).toBe(1);
  });

  test('should have default messages', () => {
    const out = BaseModule._out;
    const calls = [];

    BaseModule._out = (...args) => calls.push(args);
    try {
      base.init();
    } finally {
      BaseModule._out = out;
    }

    expect(calls).toEqual([['unnamed', 'init method is not implemented']]);
  });
});
