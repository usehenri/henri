const BaseModule = require('../base/module');
const Henri = require('../henri');
const Pen = require('../0.pen');

describe('pen', () => {
  describe('standalone', () => {
    beforeEach(() => (this.pen = new Pen(false)));

    test('should have private properties', () => {
      expect(this.pen).toHaveProperty('notTest');
      expect(this.pen).toHaveProperty('longest');
      expect(this.pen).toHaveProperty('buffer');
      expect(this.pen).toHaveProperty('_time');
      expect(this.pen).toHaveProperty('_timeSkipped');
      expect(this.pen).toHaveProperty('inTesting');
      expect(this.pen).toHaveProperty('initialized');
    });

    test('should have level related methods', () => {
      expect(this.pen).toHaveProperty('error');
      expect(this.pen).toHaveProperty('warn');
      expect(this.pen).toHaveProperty('info');
      expect(this.pen).toHaveProperty('verbose');
      expect(this.pen).toHaveProperty('debug');
      expect(this.pen).toHaveProperty('silly');
      expect(this.pen).toHaveProperty('fatal');
    });

    test('should helper methods', () => {
      expect(this.pen).toHaveProperty('time');
      expect(this.pen).toHaveProperty('line');
      expect(this.pen).toHaveProperty('output');
      expect(this.pen).toHaveProperty('shout');
      expect(this.pen).toHaveProperty('notify');
    });

    test('should initialise', () => {
      expect(this.pen.initialized).toBeFalsy();
      this.pen.info('test', 'first message');
      expect(this.pen.initialized).toBeTruthy();
    });

    test('should resize padding', () => {
      const size = this.pen.longest;
      this.pen.info('some_long_module_spec', 'msg');
      expect(this.pen.longest).toBeGreaterThan(size);
    });

    test('should shout on info', () => {
      this.pen.shout = jest.fn();
      this.pen.info('test', 'msg');
      expect(this.pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on error', () => {
      this.pen.shout = jest.fn();
      this.pen.error('test', 'msg');
      expect(this.pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on warn', () => {
      this.pen.shout = jest.fn();
      this.pen.warn('test', 'msg');
      expect(this.pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on verbose', () => {
      this.pen.shout = jest.fn();
      this.pen.verbose('test', 'msg');
      expect(this.pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on debug', () => {
      this.pen.shout = jest.fn();
      this.pen.debug('test', 'msg');
      expect(this.pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on silly', () => {
      this.pen.shout = jest.fn();
      this.pen.silly('test', 'msg');
      expect(this.pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on fatal', () => {
      this.pen.shout = jest.fn();
      this.pen.fatal('test', 'msg');
      expect(this.pen.shout).toHaveBeenCalled();
    });
    describe('fatal', () => {
      test('should parse error on fatal', () => {
        this.pen.error = jest.fn();
        this.pen.line = jest.fn();
        this.pen.fatal('test', new Error(), `some big error...`);
        expect(this.pen.error).toBeCalled();
        expect(this.pen.line).toHaveBeenCalledTimes(4);
      });

      test('should show object', () => {
        this.pen.error = jest.fn();
        this.pen.line = jest.fn();
        this.pen.fatal('test', 'error', `some big error...`, { inspect: 'me' });
        expect(this.pen.error).toBeCalled();
        expect(this.pen.line).toHaveBeenCalledTimes(6);
      });

      /* eslint-disable no-console */
      test('should handle testing?', () => {
        process.exit = jest.fn();
        this.pen.inTesting = true;
        this.pen.notTest = true;
        this.pen.fatal('test', 'info');
        expect(process.exit).toHaveBeenCalledTimes(1);
      });

      test('should have default value in fatal', () => {
        this.pen.error = jest.fn();
        this.pen.fatal();
        expect(this.pen.error).toBeCalledWith('fatal', 'unknown error');
      });

      test('should handle long message in full desc', () => {
        this.pen.error = jest.fn();
        const long = `
        this
        is
        a
        long
        dessc
        `;
        this.pen.fatal('test', 'short desc', long);
        expect(this.pen.error).toHaveBeenCalled();
      });
    });

    test('should keep time', async () => {
      const time = this.pen._time;
      const skipped = this.pen._timeSkipped;
      expect(this.pen.time()).toEqual('');
      expect(this.pen._timeSkipped).toBeGreaterThanOrEqual(skipped);
      expect(parseInt(this.pen._time)).toBeGreaterThanOrEqual(parseInt(time));
      this.pen._timeSkipped = 10;
      expect(this.pen.time()).not.toEqual('');
    });

    xtest('should handle long messages', () => {
      const boo = this.pen.shout('test', 'info', 'a'.repeat(1000));
      console.log(boo);
      expect(boo).toEqual(10);
    });

    /* eslint-disable no-console *

    /* eslint-disable no-console */
    test('should print have line-feed (default)', () => {
      console.log = jest.fn();
      this.pen.notTest = true;
      this.pen.line();
      expect(console.log).toHaveBeenCalledTimes(1);
    });

    /* eslint-disable no-console */
    test('should print have line-feed (x times)', () => {
      console.log = jest.fn(() => true);
      this.pen.notTest = true;
      this.pen.line(3);
      expect(console.log).toHaveBeenCalledTimes(3);
    });
  });
  describe('bootstrapped', () => {
    beforeEach(() => {
      this.henri = new Henri({ runlevel: 0 });
      this.henri.init();
    });

    test('should be defined', () => {
      expect(this.henri.pen).toBeDefined();
    });

    test('should extend BaseModule', () => {
      expect(this.henri.pen).toBeInstanceOf(BaseModule);
    });
  });
});
