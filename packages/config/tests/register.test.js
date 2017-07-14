describe('register', () => {
  beforeEach(() => {
    require('../index');
  });
  test('add a module', () => {
    const num = Object.keys(henri._modules).length;
    henri.addModule('test-12', () => {});
    expect(Object.keys(henri._modules).length).toBeGreaterThan(num);
  });
  test('to throw if name exists already', () => {
    henri.log.fatalError = jest.fn();
    expect(henri._modules['test-13']).toBeUndefined();
    henri.addModule('test-13', () => {});
    expect(henri._modules['test-13']).toBeDefined();
    henri.addModule('test-13', () => {});
    expect(henri.log.fatalError).toBeCalled();
  });

  test('should not register non-fonctions', () => {
    process.env.NODE_ENV = 'production';
    const num = Object.keys(henri._loaders).length;
    henri.addLoader('test-12', 'hello');
    expect(Object.keys(henri._loaders).length).toBe(num);
    process.env.NODE_ENV = 'test';
  });

  test('reload', async () => {
    const reloader = jest.fn();
    henri.notify = jest.fn();
    henri.addLoader(reloader);
    await henri.reload();
    expect(reloader).toHaveBeenCalledTimes(1);
    await henri.reload();
    await henri.reload();
    expect(reloader).toHaveBeenCalledTimes(3);
  });

  test('addUnloader', () => {
    henri.log.error = jest.fn();
    henri.addUnloader('boo');
    expect(henri.log.error).toHaveBeenCalledTimes(1);
  });
  test('stop', async () => {
    const unloader = jest.fn();
    henri.addUnloader(unloader);
    henri.stop();
    expect(unloader).toHaveBeenCalledTimes(1);
    await henri.stop();
    await henri.stop();
    expect(unloader).toHaveBeenCalledTimes(3);
  });
});
