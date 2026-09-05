const fs = require('fs');

const { commands, version } = require('../package.json');
const { cleanup, henri, tmpdir } = require('./helpers');

describe('the cli', () => {
  let dir;

  beforeAll(() => {
    dir = tmpdir('henri-main-');
  });

  afterAll(() => {
    cleanup(dir);
  });

  describe('help', () => {
    test('shows the usage with no arguments', () => {
      const { status, stdout } = henri([], { cwd: dir });

      expect(status).toBe(0);
      expect(stdout).toContain('Usage');
      expect(stdout).toContain('generate');
      expect(stdout).toContain('routes');
    });

    test('shows the usage with the help command', () => {
      const { status, stdout } = henri(['help'], { cwd: dir });

      expect(status).toBe(0);
      expect(stdout).toContain('Usage');
    });

    test('shows the help of a command with help <command>', () => {
      const { status, stdout } = henri(['help', 'routes'], { cwd: dir });

      expect(status).toBe(0);
      expect(stdout).toContain('$ henri routes');
    });

    test('documents the flags the commands accept', () => {
      const out = (command) => henri([command, '--help'], { cwd: dir }).stdout;

      expect(out('new')).toContain('--skip-install');
      expect(out('new')).toContain('--no-git');
      expect(out('init')).toContain('-f, --force');
      expect(out('destroy')).toContain('route <key>');
      expect(out('destroy')).toContain('view <folder>');
      expect(out('generate')).toContain('--force');
      expect(out('generate')).toContain('worker <name>');
    });

    describe.each(commands.filter((command) => command !== 'help'))(
      'henri %s --help',
      (command) => {
        test('prints the help without running the command', () => {
          const { status, stdout, stderr } = henri([command, '--help'], {
            cwd: dir,
          });

          expect(stderr).toBe('');
          expect(status).toBe(0);
          expect(stdout).toContain('Usage');
          // Nothing was created or started in the (empty) directory
          expect(fs.readdirSync(dir)).toEqual([]);
        });
      }
    );
  });

  describe('version', () => {
    test.each(['--version', '-v'])('prints the version with %s', (flag) => {
      const { status, stdout } = henri([flag], { cwd: dir });

      expect(status).toBe(0);
      expect(stdout.trim()).toBe(version);
    });
  });

  describe('errors', () => {
    test('rejects an unknown command', () => {
      const { status, stdout, stderr } = henri(['nope'], { cwd: dir });

      expect(status).toBe(1);
      expect(stderr).toContain('Unknown command "nope"');
      expect(stdout).toContain('Usage');
    });

    test('prints the error of a failing command, not the generic help', () => {
      const { status, stdout, stderr } = henri(['generate', 'nope', 'Thing'], {
        cwd: dir,
      });

      expect(status).toBe(1);
      expect(stderr).toContain(
        'henri generate failed: Unknown generator "nope"'
      );
      expect(stderr).toContain('--debug=henri:*');
      expect(stdout).not.toContain('Usage');
    });

    test('refuses to generate outside of a project', () => {
      const { status, stdout } = henri(['generate', 'model', 'Thing'], {
        cwd: dir,
      });

      expect(status).toBe(1);
      expect(stdout).toContain('not in an henri project');
    });
  });
});
