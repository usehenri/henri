const utils = require('../utils');
const Henri = require('../henri');

describe('utils', () => {
  test('should have yarnExists', () => {
    expect(utils.yarnExists).toBeDefined();
  });

  test('should have checkPackages', () => {
    expect(() => utils.checkPackages(['bounce'])).toBeTruthy();
    expect(() => utils.checkPackages(['bounce', 'cross-spawn'])).toBeTruthy();
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
    const inst = new Henri({ runlevel: 0 });

    await inst.init();

    expect(
      await utils.syntax('./packages/core/src/utils.djs', null, inst)
    ).toEqual(expect.stringContaining('unable to check the syntax'));
    expect(
      await utils.syntax('./packages/core/src/utils.js', null, inst)
    ).toBeTruthy();

    await inst.stop();
  });
});
