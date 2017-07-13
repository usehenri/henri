const path = require('path');
process.env.NODE_CONFIG_DIR = path.resolve('./packages/config/tests/config');

describe('config module', () => {
  describe('main functions', () => {
    beforeEach(() => {
      require('../index');
    });
    test('should suppress warnings', () => {
      expect(process.env.SUPPRESS_NO_CONFIG_WARNING).toBeTruthy();
    });
    test('should scaffold the internal configuration', () => {
      expect(henri._modules).toBeDefined();
    });
    test('should be accessible from henri', () => {
      expect(henri.config).toBeDefined();
    });
    test('should register addLoader', () => {
      expect(henri.addLoader).toBeDefined();
    });
    test('should reload properly', () => {
      expect(henri.config).toBeDefined();
      delete henri.config;
      expect(henri.config).toBeUndefined();
      henri._loaders[0]();
      expect(henri.config).toBeDefined();
    });
  });
});
