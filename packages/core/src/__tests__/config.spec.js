const init = require('../index');
const BaseModule = require('../base/module');

let henri = null;

describe('config', () => {
  beforeAll(async () => (henri = await init('.', 1)));

  test('should be defined', () => {
    expect(henri.config).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(henri.config).toBeInstanceOf(BaseModule);
  });

  test('should throw if key is not there', () => {
    expect(() => henri.config.get('boo')).toThrow();
  });

  test('should not throw if in safe mode', () => {
    expect(henri.config.get('boo', true)).toBeFalsy();
  });

  test('should tell if key is present', () => {
    expect(henri.config.has('moo')).toBeFalsy();
  });

  test('should reload', () => {
    expect(henri.config.reload()).toBeTruthy();
  });
});
