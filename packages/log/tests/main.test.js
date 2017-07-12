const path = require('path');
const fs = require('fs');

describe('log', () => {
  beforeAll(async () => {
    process.env.ALLOW_CONFIG_MUTATIONS = true;
    const logsDirecory = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logsDirecory)) {
      fs.mkdirSync(logsDirecory);
    }
    require('../../config/index.js');
    require('../index.js');
  });
  test('initialize', () => {
    expect(henri.log).toBeDefined();
  });
  test('log to console', () => {
    expect(henri.log.transports.console).toBeDefined();
  });
  test('should log to a file', done => {
    const filename = path.resolve(
      process.cwd(),
      'logs',
      `${henri.config.get('log')}`
    );
    expect(henri.log.transports.file).toBeDefined();
    setTimeout(() => {
      if (fs.existsSync(filename)) {
        done();
      }
    }, 500);
  });
  test('notify', () => {
    expect(henri.notify).toBeDefined();
    expect(() =>
      henri.notify('henri framework', 'seems like notification works')
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
});
