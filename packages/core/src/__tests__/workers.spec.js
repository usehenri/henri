const BaseModule = require('../base/module');
const Henri = require('../henri');
const Workers = require('../5.workers');

let henri;

describe('models', () => {
  beforeAll(async () => {
    henri = new Henri({
      runlevel: 5,
    });
    await henri.init();
  });

  afterAll(async () => {
    await henri.stop();
  });

  test('should be defined', () => {
    expect(henri.workers).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(henri.workers).toBeInstanceOf(BaseModule);
  });

  test('should match snapshot', () => {
    const workers = new Workers();

    expect(workers).toMatchSnapshot();
  });

  test('should stop on reload', () => {
    const stop = vi.fn();

    henri.workers.workers['witness.js'] = {
      stop: stop,
    };

    henri.workers.reload();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
