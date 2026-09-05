const BaseModule = require('../base/module');
const Henri = require('../henri');
const Pen = require('../0.pen');

let pen;
let henri;

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
      pen.shout = vi.fn();
      pen.info('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on error', () => {
      pen.shout = vi.fn();
      pen.error('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on warn', () => {
      pen.shout = vi.fn();
      pen.warn('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on verbose', () => {
      pen.shout = vi.fn();
      pen.verbose('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on debug', () => {
      pen.shout = vi.fn();
      pen.debug('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on silly', () => {
      pen.shout = vi.fn();
      pen.silly('test', 'msg');
      expect(pen.shout).toHaveBeenCalledTimes(1);
    });

    test('should shout on fatal', () => {
      pen.shout = vi.fn();
      pen.fatal('test', 'msg');
      expect(pen.shout).toHaveBeenCalled();
    });
    describe('fatal', () => {
      test('should parse error on fatal', () => {
        pen.error = vi.fn();
        pen.line = vi.fn();
        pen.fatal('test', new Error(), `some big error...`);
        expect(pen.error).toHaveBeenCalled();
        expect(pen.line).toHaveBeenCalledTimes(4);
      });

      test('should show object', () => {
        console.log = vi.fn();
        pen.error = vi.fn();
        pen.line = vi.fn();
        pen.fatal('test', 'error', `some big error...`, { inspect: 'me' });
        expect(pen.error).toHaveBeenCalled();
        expect(pen.line).toHaveBeenCalledTimes(6);
        expect(console.log).toHaveBeenCalledTimes(1);
      });

      test('should have default value in fatal', () => {
        pen.error = vi.fn();
        pen.fatal();
        expect(pen.error).toHaveBeenCalledWith('fatal', 'unknown error');
      });

      test('should handle long message in full desc', () => {
        pen.error = vi.fn();
        const long = `
        this
        is
        a
        long
        dessc
        `;

        pen.fatal('test', 'short desc', long);
        expect(pen.error).toHaveBeenCalled();
      });
    });

    test('should keep time', async () => {
      const time = pen._time;
      const skipped = pen._timeSkipped;

      expect(pen.time()).toEqual('');
      expect(pen._timeSkipped).toBeGreaterThanOrEqual(skipped);
      expect(parseInt(pen._time)).toBeGreaterThanOrEqual(parseInt(time));
      pen._timeSkipped = 10;
      expect(pen.time()).not.toEqual('');
    });

    test('should print have line-feed (default)', () => {
      console.log = vi.fn();
      pen.notTest = true;
      pen.line();
      expect(console.log).toHaveBeenCalledTimes(1);
    });

    test('should print have line-feed (x times)', () => {
      console.log = vi.fn(() => true);
      pen.notTest = true;
      pen.line(3);
      expect(console.log).toHaveBeenCalledTimes(3);
    });
  });
  describe('bootstrapped', () => {
    beforeEach(async () => {
      henri = new Henri({ runlevel: 0 });
      await henri.init();
    });

    afterEach(async () => {
      await henri.stop();
    });

    test('should be defined', () => {
      expect(henri.pen).toBeDefined();
    });

    test('should extend BaseModule', () => {
      expect(henri.pen).toBeInstanceOf(BaseModule);
    });
  });
});
