const BaseModule = require('../base/module');
const Henri = require('../henri');
const Workers = require('../5.workers');

describe('models', () => {
  beforeAll(async () => {
    this.henri = new Henri({
      runlevel: 5,
    });
    await this.henri.init();
  });

  afterAll(async () => {
    await this.henri.stop();
  });

  test('should be defined', () => {
    expect(this.henri.workers).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(this.henri.workers).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const workers = new Workers();

    expect(workers).toMatchSnapshot();
  });

  test('should stop on reload', () => {
    const stop = jest.fn();

    this.henri.workers.workers['witness.js'] = {
      stop: stop,
    };

    this.henri.workers.reload();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
