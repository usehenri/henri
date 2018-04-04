const Henri = require('../henri');
const Modules = require('../0.modules');
const BaseModule = require('../base/module');

describe('henri', () => {
  beforeEach(() => {
    this.henri = new Henri({ runlevel: 1 });
    this.henri.pen.fatal = jest.fn();
  });

  test('should match snapshot', () => {
    const mod = new Modules({});
    expect(mod).toMatchSnapshot();
  });

  describe('general', () => {
    test('should have 7 run levels (0...6)', async () => {
      expect(this.henri.modules.store).toHaveLength(7);
    });

    test('should not allow duplicate', () => {
      this.henri.modules.add(new Runlevel0());
      expect(this.henri.modules.store[0]).toHaveLength(1);

      this.henri.modules.add(new Runlevel0());

      expect(this.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        'you have a module trying to load over another...',
        'check your modules? see: https://usehenri.io/e/dup_mods'
      );
      expect(this.henri.modules.store[0]).toHaveLength(1);
    });

    test('should init properly', async () => {
      const init = jest.fn();
      const reload = jest.fn();
      this.henri.modules.add(
        new WeirdModule({
          name: 'd',
          runlevel: 1,
          init,
          reloadable: true,
          reload,
        })
      );

      expect(await this.henri.modules.init()).toEqual(true);
      expect(init).toHaveBeenCalledTimes(1);

      expect(this.henri.modules.reload()).toBeTruthy();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    test('should not hit init() if not a function', () => {
      this.henri.pen.fatal = jest.fn();
      this.henri.modules.add(
        new WeirdModule({
          name: 'd',
          runlevel: 1,
          init: () => 'abc',
        })
      );
      this.henri.modules.add(new Runlevel1());
      this.henri.modules.store[1][0].init = 'abc';
      this.henri.modules.init();
      this.henri.modules.reload();
    });

    test('should not hit reload() if not a function', () => {
      this.henri.pen.fatal = jest.fn();
      this.henri.modules.add(
        new WeirdModule({
          name: 'd',
          runlevel: 1,
          init: () => 'abc',
          reloadable: false,
          reload: 'abcdef',
        })
      );
      this.henri.modules.init();
      this.henri.modules.store[1][0].reloadable = true;
      this.henri.modules.reload();
    });

    test('should throw if no module', () => {
      this.henri.pen.fatal = jest.fn();
      this.henri.modules.init();
      expect(this.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        'init',
        'no modules loaded before init'
      );
    });
  });

  describe('validations', () => {
    test('should only allow modules extending BaseModule', () => {
      this.henri.pen.fatal = jest.fn();
      this.henri.modules.add(new BadModule());
      expect(this.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('is not extending BaseModule')
      );
    });

    test('should only allow modules with correct runlevel', () => {
      this.henri.pen.fatal = jest.fn();
      this.henri.modules.add(new WeirdModule({ runlevel: 'two' }));

      expect(this.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('runlevel is not defined')
      );
    });

    test('should only allow modules with correct names', () => {
      this.henri.pen.fatal = jest.fn();
      this.henri.modules.add(new WeirdModule({ name: -1, runlevel: 2 }));

      expect(this.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('name is not a string')
      );
      expect(this.henri.pen.fatal).toHaveBeenCalledTimes(1);
    });

    test('should only allow modules with correct runlevel range', () => {
      this.henri.pen.fatal = jest.fn();
      this.henri.modules.add(new WeirdModule({ name: 'a', runlevel: -1 }));

      expect(this.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('a runlevel is out of range')
      );

      this.henri.modules.add(new WeirdModule({ name: 'b', runlevel: 7 }));

      expect(this.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('b runlevel is out of range')
      );
      expect(this.henri.pen.fatal).toHaveBeenCalledTimes(2);
    });

    test('should only allow modules with init function', () => {
      this.henri.pen.fatal = jest.fn();
      this.henri.modules.add(
        new WeirdModule({ name: 'c', runlevel: 2, init: 'func' })
      );

      expect(this.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('c init is not a function')
      );
      expect(this.henri.pen.fatal).toHaveBeenCalledTimes(1);
    });

    test('should only allow modules with reload pairs', () => {
      this.henri.pen.fatal = jest.fn();
      const init = jest.fn();
      this.henri.modules.add(
        new WeirdModule({
          name: 'd',
          runlevel: 2,
          init: init,
          reloadable: true,
          reload: 'func',
        })
      );

      this.henri.modules.add(
        new WeirdModule({
          name: 'd',
          runlevel: 2,
          init: init,
        })
      );

      expect(this.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining(
          'd has no valid reload function. Is it reloadable?'
        )
      );
      expect(this.henri.pen.fatal).toHaveBeenCalledTimes(1);
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
