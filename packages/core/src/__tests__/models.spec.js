const BaseModule = require('../base/module');
const Henri = require('../henri');
const Model = require('../3.model');

let henri;

describe('models', () => {
  beforeAll(async () => {
    henri = new Henri({
      runlevel: 3,
    });
    await henri.init();
  });

  afterAll(async () => {
    await henri.stop();
  });

  test('should be defined', () => {
    expect(henri.model).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(henri.model).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const model = new Model();

    expect(model).toMatchSnapshot();
  });
}, 20000);
