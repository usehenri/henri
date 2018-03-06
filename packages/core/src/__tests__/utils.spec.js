const henri = require('../henri');
const utils = require('../utils');

describe('utils', () => {
  beforeEach(() => {
    require('../index');
  });
  test('import fresh', () => {
    expect(utils.importFresh).toBeTruthy();
  });
  test('yarn exists?', () => {
    expect(utils.yarnExists).toBeDefined();
  });
  test('check packages', () => {
    henri.log.fatalError = jest.fn();
    utils.checkPackages(['config']);
    expect(henri.log.fatalError).toHaveBeenCalledTimes(1);
  });
});
