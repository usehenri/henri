const utils = require('../utils');

describe('utils', () => {
  test('should have yarnExists', () => {
    expect(utils.yarnExists).toBeDefined();
  });

  test('should have checkPackages', () => {
    expect(utils.checkPackages(['jest'])).toBeTruthy();
    expect(utils.checkPackages(['jest', 'cross-spawn'])).toBeTruthy();
    expect(utils.checkPackages(['fsssss'])).toContain('Unable');
    expect(utils.checkPackages(['aabbcc', 'ddeeff'])).toContain('Unable');
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
    let rows = Object.assign(process.stdout.rows);
    process.stdout.rows = null;
    expect(utils.clearConsole()).toBeTruthy();
    process.stdout.rows = rows;
  });

  xtest('should check syntax', () => {
    // console.log(utils.syntax('./packages/core/src/utils.js'));
    expect(utils.syntax('./packages/core/src/utils.js')).resolves();
  });
});
