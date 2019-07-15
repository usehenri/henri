const Henri = require('../henri');

describe('henri', () => {
  describe('general', () => {
    beforeEach(() => {
      this.henri = new Henri({ runlevel: 1 });
    });

    it('should match snapshot', () => {
      delete this.henri.validator;
      this.henri.validator = {};

      expect(this.henri).toMatchSnapshot();
    });

    it('should have a reload method', () => {
      expect(this.henri.reload).toBeDefined();

      expect(this.henri.reload()).toBeTruthy();
    });

    it('should have a stop method', () => {
      expect(this.henri.stop).toBeDefined();

      expect(this.henri.stop()).toBeTruthy();
    });

    it('should register a global', () => {
      process.env.NODE_ENV = 'dev';

      const local = new Henri();

      expect(henri).toBeDefined();
      expect(local).toBeDefined();

      process.env.NODE_ENV = 'test';
    });

    it('should have a validator', () => {
      expect(this.henri.validator.isEmail('code@usehenri.io')).toBeTruthy();
    });
  });

  describe('with options', () => {
    it('should have runlevel 6 by default', () => {
      const henri = new Henri();

      expect(henri.runlevel).toEqual(6);
    });

    it('should accept different runlevel', () => {
      const henri = new Henri({ runlevel: 2 });

      expect(henri.runlevel).toEqual(2);
    });

    it('should have . as default folder', () => {
      process.env.NODE_ENV = 'dev';
      const henri = new Henri();

      expect(henri.prefix).toEqual('.');

      process.env.NODE_ENV = 'test';
    });

    it('should accept a new folder', () => {
      process.env.NODE_ENV = 'dev';
      const henri = new Henri({ cwd: './packages' });

      expect(henri.prefix).toEqual('./packages');
      process.env.NODE_ENV = 'test';
    });
  });

  describe('main module', () => {
    test('should not be null', () => {
      // eslint-disable-next-line global-require
      const start = require('../index');

      expect(typeof start).toEqual('function');
    });
  });
});
