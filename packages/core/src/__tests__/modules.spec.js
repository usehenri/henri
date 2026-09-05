const Henri = require('../henri');
const Modules = require('../0.modules');
const BaseModule = require('../base/module');

let henri;

describe('henri', () => {
  beforeEach(() => {
    henri = new Henri({ runlevel: 1 });
    henri.pen.fatal = vi.fn();
  });

  test('should match snapshot', () => {
    const mod = new Modules({});

    expect(mod).toMatchSnapshot();
  });

  describe('general', () => {
    test('should have 8 run levels (0...7)', async () => {
      expect(henri.modules.store).toHaveLength(8);
    });

    test('should not allow duplicate', () => {
      henri.modules.add(new Runlevel0());

      expect(henri.modules.store[0]).toHaveLength(1);

      henri.modules.add(new Runlevel0());

      expect(henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        'you have a module trying to load over another...',
        'check your modules? see: https://usehenri.io/e/dup_mods'
      );

      expect(henri.modules.store[0]).toHaveLength(1);
    });

    test('should init properly', async () => {
      const init = vi.fn();
      const reload = vi.fn();
      const stop = vi.fn();

      henri.modules.add(
        new WeirdModule({
          init,
          name: 'd',
          reload,
          reloadable: true,
          runlevel: 1,
          stop,
        })
      );

      expect(await henri.modules.init()).toEqual(true);
      expect(init).toHaveBeenCalledTimes(1);

      expect(henri.modules.reload()).toBeTruthy();
      expect(reload).toHaveBeenCalledTimes(1);

      expect(henri.modules.stop()).toBeTruthy();
      expect(stop).toHaveBeenCalledTimes(1);
    });

    test('should not hit init() if not a function', () => {
      console.log = vi.fn();
      henri.pen.fatal = vi.fn();
      henri.modules.add(
        new WeirdModule({
          init: () => 'abc',
          name: 'd',
          runlevel: 1,
        })
      );
      henri.modules.add(new Runlevel1());
      henri.modules.store[1][0].init = 'abc';
      henri.modules.init();
      henri.modules.reload();
      expect(console.log).toHaveBeenCalledTimes(1);
    });

    test('should be falsy if init/reload throws...', async () => {
      henri.modules.add(
        new WeirdModule({
          init: () => {
            throw new Error();
          },
          name: 'd',
          reload: () => {
            throw new Error();
          },
          runlevel: 1,
        })
      );
      await expect(henri.modules.init()).rejects.toThrow();
      await expect(henri.modules.reload()).resolves.toBeFalsy();
    });

    test('should not hit reload() if not a function', () => {
      henri.pen.fatal = vi.fn();
      henri.modules.add(
        new WeirdModule({
          init: () => 'abc',
          name: 'd',
          reload: 'abcdef',
          reloadable: false,
          runlevel: 1,
        })
      );
      henri.modules.init();
      henri.modules.store[1][0].reloadable = true;
      henri.modules.reload();
    });

    test('should throw if no module', () => {
      henri.pen.fatal = vi.fn();
      henri.modules.init();
      expect(henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        'init',
        'no modules loaded before init'
      );
    });
  });

  describe('validations', () => {
    test('should only allow modules extending BaseModule', () => {
      expect(() => henri.modules.add(new BadModule())).toThrow(
        /is not extending BaseModule/
      );
    });

    test('should only allow modules with correct runlevel', () => {
      expect(() =>
        henri.modules.add(new WeirdModule({ runlevel: 'two' }))
      ).toThrow(/runlevel is not defined/);
    });

    test('should not add consoleonly modules', () => {
      henri.consoleOnly = true;

      expect(
        henri.modules.add(new WeirdModule({ consoleOnly: true }))
      ).toBeFalsy();
    });

    test('should only allow modules with correct names', () => {
      expect(() =>
        henri.modules.add(new WeirdModule({ name: -1, runlevel: 2 }))
      ).toThrow(/name is not a string/);
    });

    test('should only allow modules with correct runlevel range', () => {
      expect(() =>
        henri.modules.add(new WeirdModule({ name: 'a', runlevel: -1 }))
      ).toThrow(/a runlevel is out of range/);

      expect(() =>
        henri.modules.add(new WeirdModule({ name: 'b', runlevel: 8 }))
      ).toThrow(/b runlevel is out of range/);
    });

    test('should only allow modules with init function', () => {
      expect(() =>
        henri.modules.add(
          new WeirdModule({ init: 'func', name: 'c', runlevel: 2 })
        )
      ).toThrow(/c init is not a function/);
    });

    test('should only allow modules with reload pairs', () => {
      const init = vi.fn();

      expect(() =>
        henri.modules.add(
          new WeirdModule({
            init: init,
            name: 'd',
            reload: 'func',
            reloadable: true,
            runlevel: 2,
          })
        )
      ).toThrow(/has no valid reload function. Is it reloadable/);

      expect(() =>
        henri.modules.add(
          new WeirdModule({
            init: init,
            name: 'd',
            runlevel: 2,
          })
        )
      ).not.toThrow();
    });
  });
});

class Runlevel0 extends BaseModule {
  constructor() {
    super();
    this.name = 'test_run0';
    this.runlevel = 0;
    this.reloadable = true;
  }

  reload() {
    return true;
  }
}

class Runlevel1 extends BaseModule {
  constructor() {
    super();
    this.name = 'test_run1';
    this.runlevel = 1;
  }
}

class BadModule {}

class WeirdModule extends BaseModule {
  constructor(opts) {
    super();
    for (let key of Object.keys(opts)) {
      this[key] = opts[key];
    }
  }
}
