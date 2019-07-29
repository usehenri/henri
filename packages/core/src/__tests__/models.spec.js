const BaseModule = require('../base/module');
const Henri = require('../henri');
const Model = require('../3.model');

describe('models', () => {
  beforeAll(async () => {
    this.henri = new Henri({
      runlevel: 3,
    });
    await this.henri.init();
  });

  afterAll(async () => {
    await this.henri.stop();
  });

  test('should be defined', () => {
    expect(this.henri.model).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(this.henri.model).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const model = new Model();

    expect(model).toMatchSnapshot();
  });
}, 20000);
