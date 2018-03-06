const BaseModule = require('../base/module');

const path = require('path');
const fs = require('fs');

describe('log', () => {
  beforeAll(() => {
    require('../index');
  });

  test('inherits from BaseModule', () => {
    expect(henri.log).toBeInstanceOf(BaseModule);
    expect(henri.config.reload).toBeDefined();
    expect(henri.config.init).toBeDefined();
    expect(henri.config.setup).toBeDefined();
    expect(henri.config.start).toBeDefined();
    expect(henri.config.stop).toBeDefined();
  });

  test('initialize', () => {
    expect(henri.log).toBeDefined();
  });

  test('log to console', () => {
    expect(henri.log.winston.transports.console).toBeDefined();
  });

  test('should log to a file', done => {
    const filename = path.resolve(
      process.cwd(),
      'logs',
      `${henri.config.get('log')}`
    );
    expect(henri.log.winston.transports.file).toBeDefined();
    setTimeout(() => {
      if (fs.existsSync(filename)) {
        done();
      }
    }, 500);
  });

  test('notify', () => {
    expect(henri.log.notify).toBeDefined();
    expect(() =>
      henri.log.notify('henri framework', 'seems like notification works')
    ).not.toThrow();
  });

  test('fatalError', () => {
    // eslint-disable-next-line no-console
    console.log = jest.fn();
    henri.log.error = jest.fn();
    expect(() => henri.log.fatalError('ohh no..')).toThrow();
    // eslint-disable-next-line no-console
    expect(console.log).toHaveBeenCalledTimes(2);
    expect(henri.log.error).toHaveBeenCalledTimes(1);
    expect(() => henri.log.fatalError('o')).toThrow();
    expect(henri.log.error).toHaveBeenCalledTimes(1);
  });

  test('getColor', () => {
    const { log: { getColor } } = henri;
    expect(getColor).toBeDefined();
    expect(getColor('ERROR')).toBe('red');
    expect(getColor('wArN')).toBe('yellow');
    expect(getColor('info')).toBe('green');
    expect(getColor('verbose')).toBe('white');
    expect(getColor('debug')).toBe('blue');
    expect(getColor('sillY')).toBe('magenta');
    expect(getColor('paint me red')).toBe('red');
  });

  test('log levels', () => {
    const { log } = henri;

    log.winston.info = jest.fn();
    log.winston.debug = jest.fn();
    log.winston.verbose = jest.fn();
    log.winston.warn = jest.fn();
    log.winston.silly = jest.fn();

    log.info('info');
    log.debug('debug');
    log.verbose('verbose');
    log.warn('warn');
    log.silly('silly');

    expect(log.winston.info).toHaveBeenCalledTimes(1);
    expect(log.winston.debug).toHaveBeenCalledTimes(1);
    expect(log.winston.verbose).toHaveBeenCalledTimes(1);
    expect(log.winston.warn).toHaveBeenCalledTimes(1);
    expect(log.winston.silly).toHaveBeenCalledTimes(1);
  });
});
