const utils = require('../scripts/utils.js');

describe('cli utilities', () => {
  test('cwd returns correct directory', () => {
    expect(utils.cwd).toBe(process.cwd());
  });
  test('check returns is working fine', () => {
    expect(utils.check('./package.json')).toBeTruthy();
  });
});
