describe('controllers', () => {
  let reloader;
  beforeEach(() => {
    process.env.ALLOW_CONFIG_MUTATIONS = true;
    require('../../config/index.js');
    require('../index.js');
  });
  test('should should globally be defined', () => {
    expect(henri.controllers).toBeDefined();
  });
  test('should have a#bc', () => {
    expect(henri.controllers['a#bc']).toBeDefined();
    expect(henri.controllers['b#cd']).not.toBeDefined();
  });
  test('should reload', async () => {
    const res1 = jest.fn();
    const res2 = jest.fn();

    expect(henri.controllers['a#bc']).toBeDefined();
    expect(henri.controllers['b#cd']).not.toBeDefined();
    henri.controllers['a#bc']({}, { send: res1 });
    expect(res1).toBeCalled();
    reloader = henri._loaders.list.pop();
    expect(reloader).toBeDefined();
    henri.config.location.controllers =
      './packages/controller/tests/controllers-two';
    await reloader();
    expect(henri.controllers['a#bc']).not.toBeDefined();
    expect(henri.controllers['b#cd']).toBeDefined();
    henri.controllers['b#cd']({}, { send: res2 });
    expect(res2).toBeCalled();
  });
  test('should load from default location', async () => {
    expect(henri.controllers).toBeDefined();
    delete henri.config.location;
    await reloader();
    expect(Object.keys(henri.controllers).length).toBeLessThanOrEqual(0);
  });
});
