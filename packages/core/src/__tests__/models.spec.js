const BaseModule = require('../base/module');
const Henri = require('../henri');

describe('models', () => {
  beforeAll(() => {
    this.henri = new Henri({ runlevel: 5 });
    this.henri.init();
  });

  test('should be defined', () => {
    console.log(this.henri);
    expect(this.henri.model).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(this.henri.model).toBeInstanceOf(BaseModule);
  });
});
