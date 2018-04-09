const BaseModule = require('../base/module');
const Henri = require('../henri');
const Model = require('../2.model');

describe('models', () => {
  beforeAll(async () => {
    this.henri = new Henri({
      runlevel: 2,
    });
    await this.henri.init();
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

  test('should load models', () => {
    this.henri.pen.fatal = jest.fn();

    expect(this.henri.model.ids).toEqual([]);
    expect(this.henri.model.models).toEqual([]);
    expect(this.henri.model.stores).toEqual({});

    this.henri.model.configure(models);

    expect(this.henri.pen.fatal).toHaveBeenCalledTimes(1);
  });
});

const models = {
  artwork: {
    schema: {
      title: String,
      year: Number,
    },
    identity: 'artwork',
    globalId: 'Artwork',
  },
};
