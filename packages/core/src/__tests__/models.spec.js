const BaseModule = require('../base/module');
const Henri = require('../henri');

describe('models', () => {
  beforeAll(async () => {
    this.henri = new Henri({ runlevel: 2 });
    await this.henri.init();
  });

  test('should be defined', () => {
    expect(this.henri.model).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(this.henri.model).toBeInstanceOf(BaseModule);
  });
});
