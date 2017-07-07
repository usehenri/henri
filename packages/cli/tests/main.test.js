const { spawnSync } = require('child_process');

const henri = args => {
  return spawnSync('henri', args.split(' '));
};

describe('the cli', () => {
  describe('help', () => {
    test('will show help with no arguments', () => {
      const { status, stdout } = henri('');
      expect(status).toBe(0);
      expect(stdout.toString('utf8').includes('Usage')).toBeTruthy();
    });
    test('will show help', () => {
      const { status, stdout } = henri('help');
      expect(status).toBe(0);
      expect(stdout.toString('utf8').includes('Usage')).toBeTruthy();
    });
  });
});
