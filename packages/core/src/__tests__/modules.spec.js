const Module = require('../modules');
const BaseModule = require('../base/module');
const Pen = require('../pen');

let modules = null;

describe('modules', () => {
  beforeEach(() => {
    modules = new Module({
      pen: new Pen(),
      prefix: '.',
      cwd: process.cwd(),
      runlevel: 6,
      _loaders: [],
      _unloaders: [],
    });
    modules.henri.pen.fatal = console.log;
  });
  test('should match snapshot', () => {
    const mod = new Module({});
    expect(mod).toMatchSnapshot();
  });

  describe('general', () => {
    test('should have 7 run levels (0...6)', async () => {
      expect(modules.store).toHaveLength(7);
    });

    test('should not allow duplicate', () => {
      modules.henri.pen.fatal = jest.fn();

      modules.add(new Runlevel0());
      expect(modules.store[0]).toHaveLength(1);

      modules.add(new Runlevel0());

      expect(modules.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        'you have a module trying to load over another...',
        'check your modules? see: https://usehenri.io/e/dup_mods'
      );
      expect(modules.store[0]).toHaveLength(1);
    });

    test('should init properly', () => {
      const init = jest.fn();
      const reload = jest.fn();

      modules.add(
        new WeirdModule({
          name: 'd',
          runlevel: 2,
          init: init,
          reloadable: true,
          reload,
        })
      );

      expect(modules.init()).toBeTruthy();
      expect(init).toHaveBeenCalledTimes(1);

      expect(modules.reload()).toBeTruthy();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    test('should try to chdir on init', () => {
      process.chdir = jest.fn();
      modules.init('./config');
      expect(process.chdir).toHaveBeenCalledTimes(1);
    });

    test('should try to chdir on init and fail', () => {
      modules.henri.pen.fatal = jest.fn();
      process.chdir = () => {
        throw new Error();
      };
      modules.init('./config');
      expect(modules.henri.pen.fatal).toHaveBeenCalledTimes(1);
    });

    test('should warn on lower runlevels', () => {
      modules.henri.pen.warn = jest.fn();
      modules.init('.', 5);
      expect(modules.henri.pen.warn).toHaveBeenLastCalledWith(
        'modules',
        'running at limited level',
        5
      );
    });
    test('should not hit init() if not a function', () => {
      modules.add(
        new WeirdModule({
          name: 'd',
          runlevel: 2,
          init: () => 'abc',
        })
      );
      modules.add(new Runlevel1());
      modules.store[2][0].init = 'abc';
      modules.init();
      modules.reload();
    });
  });

  describe('validations', () => {
    test('should only allow modules extending BaseModule', () => {
      modules.henri.pen.fatal = jest.fn();
      modules.add(new BadModule());
      expect(modules.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('is not extending BaseModule')
      );
    });

    test('should only allow modules with correct runlevel', () => {
      modules.henri.pen.fatal = jest.fn();
      modules.add(new WeirdModule({ runlevel: 'two' }));

      expect(modules.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('runlevel is not defined')
      );
    });

    test('should only allow modules with correct names', () => {
      modules.henri.pen.fatal = jest.fn();
      modules.add(new WeirdModule({ name: -1, runlevel: 2 }));

      expect(modules.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('name is not a string')
      );
      expect(modules.henri.pen.fatal).toHaveBeenCalledTimes(1);
    });

    test('should only allow modules with correct runlevel range', () => {
      modules.henri.pen.fatal = jest.fn();
      modules.add(new WeirdModule({ name: 'a', runlevel: -1 }));

      expect(modules.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('a runlevel is out of range')
      );

      modules.add(new WeirdModule({ name: 'b', runlevel: 7 }));

      expect(modules.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('b runlevel is out of range')
      );
      expect(modules.henri.pen.fatal).toHaveBeenCalledTimes(2);
    });

    test('should only allow modules with init function', () => {
      modules.henri.pen.fatal = jest.fn();
      modules.add(new WeirdModule({ name: 'c', runlevel: 2, init: 'func' }));

      expect(modules.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining('c init is not a function')
      );
      expect(modules.henri.pen.fatal).toHaveBeenCalledTimes(1);
    });

    test('should only allow modules with reload pairs', () => {
      modules.henri.pen.fatal = jest.fn();
      const init = jest.fn();
      modules.add(
        new WeirdModule({
          name: 'd',
          runlevel: 2,
          init: init,
          reloadable: true,
          reload: 'func',
        })
      );

      modules.add(
        new WeirdModule({
          name: 'd',
          runlevel: 2,
          init: init,
        })
      );

      expect(modules.henri.pen.fatal).toHaveBeenCalledWith(
        'modules',
        expect.stringContaining(
          'd has no valid reload function. Is it reloadable?'
        )
      );
      expect(modules.henri.pen.fatal).toHaveBeenCalledTimes(1);
    });
  });
  describe('legacy', () => {
    test('should support loader()', () => {
      expect(modules._loaders).toHaveLength(0);
      modules.loader(() => 'abc');
      expect(modules._loaders).toHaveLength(1);
      modules.loader('def');
      expect(modules._loaders).toHaveLength(1);
    });

    test('should support unloader()', () => {
      modules.henri.pen.error = jest.fn();
      expect(modules._unloaders).toHaveLength(0);
      modules.unloader(() => 'abc');
      expect(modules._unloaders).toHaveLength(1);
      modules.unloader('def');
      expect(modules._unloaders).toHaveLength(1);
      expect(modules.henri.pen.error).toHaveBeenCalledTimes(1);
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

class Runlevel2 extends BaseModule {
  constructor() {
    super();
    this.name = 'test_run2';
    this.runlevel = 2;
  }
}

class Runlevel3 extends BaseModule {
  constructor() {
    super();
    this.name = 'test_run3';
    this.runlevel = 3;
  }
}

class Runlevel4 extends BaseModule {
  constructor() {
    super();
    this.name = 'test_run4';
    this.runlevel = 4;
  }
}

class Runlevel5 extends BaseModule {
  constructor() {
    super();
    this.name = 'test_run5';
    this.runlevel = 5;
  }
}

class Runlevel6 extends BaseModule {
  constructor() {
    super();
    this.name = 'test_run6';
    this.runlevel = 6;
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
