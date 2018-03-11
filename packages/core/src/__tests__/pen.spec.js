const init = require('../index');
const BaseModule = require('../base/module');
const Pen = require('../pen');

let henri = null;
let pen = null;

describe('pen', () => {
  describe('standalone', () => {
    beforeEach(() => (pen = new Pen(false)));

    test('should have private properties', () => {
      expect(pen).toHaveProperty('notTest');
      expect(pen).toHaveProperty('longest');
      expect(pen).toHaveProperty('buffer');
      expect(pen).toHaveProperty('_time');
      expect(pen).toHaveProperty('_timeSkipped');
      expect(pen).toHaveProperty('inTesting');
      expect(pen).toHaveProperty('initialized');
    });

    test('should have level related methods', () => {
      expect(pen).toHaveProperty('error');
      expect(pen).toHaveProperty('warn');
      expect(pen).toHaveProperty('info');
      expect(pen).toHaveProperty('verbose');
      expect(pen).toHaveProperty('debug');
      expect(pen).toHaveProperty('silly');
      expect(pen).toHaveProperty('fatal');
    });

    test('should helper methods', () => {
      expect(pen).toHaveProperty('time');
      expect(pen).toHaveProperty('line');
      expect(pen).toHaveProperty('output');
      expect(pen).toHaveProperty('shout');
      expect(pen).toHaveProperty('notify');
      expect(pen).toHaveProperty('queue');
      expect(pen).toHaveProperty('dequeue');
    });

    test('should initialise', () => {
      expect(pen.initialized).toBeFalsy();
      pen.info('test', 'first message');
      expect(pen.initialized).toBeTruthy();
    });

    test('should resize padding', () => {
      const size = pen.longest;
      pen.info('some_long_module_spec', 'msg');
      expect(pen.longest).toBeGreaterThan(size);
    });

    test('should shout on info', () => {
      pen.shout = jest.fn();
      pen.info('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on error', () => {
      pen.shout = jest.fn();
      pen.error('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on warn', () => {
      pen.shout = jest.fn();
      pen.warn('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on verbose', () => {
      pen.shout = jest.fn();
      pen.verbose('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on debug', () => {
      pen.shout = jest.fn();
      pen.debug('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on silly', () => {
      pen.shout = jest.fn();
      pen.silly('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on fatal', () => {
      pen.shout = jest.fn();
      pen.fatal('test', 'msg');
      expect(pen.shout).toHaveBeenCalled();
    });
    describe('fatal', () => {
      test('should parse error on fatal', () => {
        pen.error = jest.fn();
        pen.line = jest.fn();
        pen.fatal('test', new Error(), `some big error...`);
        expect(pen.error).toBeCalled();
        expect(pen.line).toHaveBeenCalledTimes(4);
      });

      test('should show object', () => {
        pen.error = jest.fn();
        pen.line = jest.fn();
        pen.fatal('test', 'error', `some big error...`, { inspect: 'me' });
        expect(pen.error).toBeCalled();
        expect(pen.line).toHaveBeenCalledTimes(6);
      });

      /* eslint-disable no-console */
      test('should handle testing?', () => {
        process.exit = jest.fn();
        pen.inTesting = true;
        pen.notTest = true;
        pen.fatal('test', 'info');
        expect(process.exit).toHaveBeenCalledTimes(1);
      });

      test('should have default value in fatal', () => {
        pen.error = jest.fn();
        pen.fatal();
        expect(pen.error).toBeCalledWith('fatal', 'unknown error');
      });

      test('should handle long message in full desc', () => {
        pen.error = jest.fn();
        const long = `
        this
        is
        a
        long
        dessc
        `;
        pen.fatal('test', 'short desc', long);
        expect(pen.error).toHaveBeenCalledTimes(15);
      });
    });

    test('should keep time', async () => {
      const time = pen._time;
      const skipped = pen._timeSkipped;
      expect(pen.time()).toEqual('');
      expect(pen._timeSkipped).toBeGreaterThanOrEqual(skipped);
      expect(pen._time).toBeGreaterThanOrEqual(time);
      pen._timeSkipped = 10;
      expect(pen.time()).not.toEqual('');
    });

    test('should handle long messages', () => {
      const { space } = pen.shout('test', 'info', 'a'.repeat(1000));
      expect(space).toEqual(10);
    });

    /* eslint-disable no-console */
    test('should have a working queue', () => {
      // eslint-disable-next-line no-console
      console.log = jest.fn();
      pen.queue('a');
      pen.queue('b');
      pen.queue('c');
      pen.dequeue();
      pen.dequeue();
      expect(console.log).toHaveBeenCalledTimes(3);
    });

    /* eslint-disable no-console */
    test('should print have line-feed (default)', () => {
      console.log = jest.fn();
      pen.notTest = true;
      pen.line();
      expect(console.log).toHaveBeenCalledTimes(1);
    });

    /* eslint-disable no-console */
    test('should print have line-feed (x times)', () => {
      console.log = jest.fn(() => true);
      pen.notTest = true;
      pen.line(3);
      expect(console.log).toHaveBeenCalledTimes(3);
    });
  });
  describe('bootstrapped', () => {
    beforeAll(async () => (henri = await init('.', 1)));

    test('should be defined', () => {
      expect(henri.pen).toBeDefined();
    });

    test('should extend BaseModule', () => {
      expect(henri.pen).toBeInstanceOf(BaseModule);
    });

    test('should notify', () => {
      expect(henri.pen.notify('title', 'hello')).toBeFalsy();

      henri.isDev = true;
      expect(henri.pen.notify('title', 'hello')).toBeTruthy();

      expect(pen.notify()).toBeFalsy();
    });

    test('should initialize in production', () => {
      henri.isProduction = true;
      expect(pen.initialized).toBeFalsy();
      pen.info('test', 'first message');
      expect(pen.initialized).toBeTruthy();
    });
  });
});
