const Henri = require('../henri');

describe('henri', () => {
  describe('general', () => {
    beforeAll(() => {
      this.henri = new Henri({ runlevel: 1 });
    });

    it('should match snapshot', () => {
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
      const henri = new Henri();
      expect(henri.prefix).toEqual('.');
    });

    it('should accept a new folder', () => {
      const henri = new Henri({ cwd: './packages' });
      expect(henri.prefix).toEqual('./packages');
    });
  });
});
