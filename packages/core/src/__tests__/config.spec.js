const BaseModule = require('../base/module');
const Henri = require('../henri');

describe('config', () => {
  beforeAll(async () => {
    this.henri = new Henri({ runlevel: 1 });
    await this.henri.init();
  });

  afterAll(async () => {
    await this.henri.stop();
  });

  test('should be defined', () => {
    expect(this.henri.config).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(this.henri.config).toBeInstanceOf(BaseModule);
  });

  test('should not throw if in safe mode', () => {
    expect(this.henri.config.get('boo', true)).toBeFalsy();
  });

  test('should tell if key is present', () => {
    expect(this.henri.config.has('moo')).toBeFalsy();
  });

  test('should reload', () => {
    expect(this.henri.config.reload()).toBeTruthy();
  });
});
