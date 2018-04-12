const utils = require('../utils');

describe('utils', () => {
  test('should have yarnExists', () => {
    expect(utils.yarnExists).toBeDefined();
  });

  test('should have checkPackages', () => {
    expect(() => utils.checkPackages(['bounce'])).toBeTruthy();
    expect(() => utils.checkPackages(['bounce', 'cross-spawn'])).toBeTruthy();
    expect(() => utils.checkPackages(['fsssss'])).toThrow(
      /Unable to load fsssss from the current project./
    );
    expect(() => utils.checkPackages(['aabbcc', 'ddeeff'])).toThrow(
      /Unable to load/
    );
    expect(utils.checkPackages()).toBeTruthy();
  });

  test('should getColor', () => {
    expect(utils.getColor()).toEqual('red');
    expect(utils.getColor('filly')).toEqual('red');

    expect(utils.getColor('error')).toEqual('red');
    expect(utils.getColor('warn')).toEqual('yellow');
    expect(utils.getColor('info')).toEqual('green');
    expect(utils.getColor('verbose')).toEqual('white');
    expect(utils.getColor('debug')).toEqual('blue');
    expect(utils.getColor('silly')).toEqual('magenta');
  });

  test('should clearConsole?', () => {
    expect(utils.clearConsole()).toBeTruthy();
    process.stdout.isTTY = false;
    expect(utils.clearConsole()).toBeTruthy();
    process.stdout.isTTY = true;
  });

  test('should check syntax', async () => {
    expect(await utils.syntax('./packages/core/src/utils.djs')).toEqual(
      expect.stringContaining('unable to check the syntax')
    );
    expect(await utils.syntax('./packages/core/src/utils.js')).toBeTruthy();
  });
});
