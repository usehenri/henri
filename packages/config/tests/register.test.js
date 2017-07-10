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
  test('reapers list should be populated', () => {
    const num = Object.keys(henri._reapers.list).length;
    henri.addReaper(() => {});
    expect(Object.keys(henri._reapers.list).length).toBeGreaterThan(num);
  });
  test('reapers should be functions', () => {
    const num = Object.keys(henri._reapers.list).length;
    henri.addReaper(' ');
    expect(Object.keys(henri._reapers.list).length).toBe(num);
  });
});
