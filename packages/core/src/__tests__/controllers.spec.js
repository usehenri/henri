describe('controllers', () => {
  beforeEach(() => {
    process.env.ALLOW_CONFIG_MUTATIONS = true;
    require('../index');
  });
  test('should should globally be defined', () => {
    expect(henri.controllers).toBeDefined();
  });
});
