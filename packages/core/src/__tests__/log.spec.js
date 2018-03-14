const init = require('../index');
const BaseModule = require('../base/module');

let henri = null;

describe('config', () => {
  beforeAll(async () => (henri = await init('.', 2)));

  test('should be defined', () => {
    expect(henri.log).toBeDefined();
  });

  test('should extend BaseModule', () => {
    expect(henri.config).toBeInstanceOf(BaseModule);
  });

  test('should have properties', () => {
    expect(henri.log.since).toBeDefined();
    expect(henri.log.winston).toBeDefined();
    expect(henri.log._time).toBeDefined();
    expect(henri.log._timeSkipped).toBeDefined();
  });

  test('should keep time', async () => {
    const time = henri.log._time;
    const skipped = henri.log._timeSkipped;
    expect(henri.log.time()).toEqual('');
    expect(henri.log._timeSkipped).toBeGreaterThanOrEqual(skipped);
    expect(henri.log._time).toBeGreaterThanOrEqual(time);
    henri.log._timeSkipped = 10;
    expect(henri.log.time()).not.toEqual('');
  });
});
