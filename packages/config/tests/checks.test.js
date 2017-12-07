describe('checks', () => {
  beforeEach(() => {
    require('../index');
  });
  test('checkPackages exists', () => {
    expect(henri.checkPackages).toBeDefined();
  });
  test('throws on missing packages', () => {
    henri.log.fatalError = jest.fn();
    henri.checkPackages(['a', 'ss']);
    henri.checkPackages(['a']);
    expect(henri.log.fatalError).toBeCalled();
  });
  test('does nothing on existing packages', () => {
    henri.log.fatalError = jest.fn();
    henri.checkPackages(['jest']);
    expect(henri.log.fatalError).not.toBeCalled();
  });
});
