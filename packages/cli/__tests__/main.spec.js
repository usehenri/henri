const fs = require('fs');
const path = require('path');

const { commands, version } = require('../package.json');
const { CliError, toCliError } = require('../scripts/errors');
const { cleanup, henri, tmpdir } = require('./helpers');

describe('errors', () => {
  test('a coded error keeps its code, its hint and its problems', () => {
    const invalid = Object.assign(new Error('invalid configuration'), {
      code: 'CONFIG_INVALID',
      hint: 'See the documentation',
      problems: [{ key: 'port' }],
    });
    // How a boot failure reaches the command line: wrapped by henri.init()
    const failure = toCliError(
      new Error('henri - unable to execute init(): invalid configuration', {
        cause: invalid,
      })
    );

    expect(failure).toBeInstanceOf(CliError);
    expect(failure.code).toBe('CONFIG_INVALID');
    expect(failure.exitCode).toBe(1);
    expect(failure.hint).toBe('See the documentation');
    expect(failure.message).toBe('invalid configuration');
    expect(failure.problems).toEqual([{ key: 'port' }]);
  });

  test('anything else is a FAILED wrapper', () => {
    const failure = toCliError(new Error('boom'));

    expect(failure.code).toBe('FAILED');
    expect(failure.exitCode).toBe(1);
    expect(failure.problems).toBeUndefined();
  });

  test('a cause chain that loops is walked once', () => {
    const first = new Error('first');
    const second = new Error('second', { cause: first });

    first.cause = second;

    expect(toCliError(second).code).toBe('FAILED');
  });
});

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
      expect(out('generate')).toContain('job <name>');
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
    test('rejects an unknown command with the usage exit code', () => {
      const { status, stdout, stderr } = henri(['nope'], { cwd: dir });

      expect(status).toBe(2);
      expect(stderr).toContain('Unknown command "nope"');
      expect(stdout).toContain('Usage');
    });

    test('prints the error of a failing command, not the generic help', () => {
      const { status, stdout, stderr } = henri(['generate', 'nope', 'Thing'], {
        cwd: dir,
      });

      expect(status).toBe(2);
      expect(stderr).toContain(
        'henri generate failed: Unknown generator "nope"'
      );
      expect(stderr).toContain('Available: agents, authentication');
      expect(stdout).not.toContain('Usage');
    });

    test('prints the debug hint for unexpected failures', () => {
      const app = path.join(dir, 'broken');

      fs.mkdirSync(path.join(app, 'app', 'views', 'pages'), {
        recursive: true,
      });
      fs.mkdirSync(path.join(app, 'config'));
      fs.writeFileSync(
        path.join(app, 'package.json'),
        JSON.stringify({ henri: true, name: 'broken' })
      );
      fs.writeFileSync(
        path.join(app, 'config', 'routes.js'),
        'module.exports = {'
      );

      const { status, stderr } = henri(['routes'], { cwd: app });

      expect(status).toBe(1);
      expect(stderr).toContain('henri routes failed:');
      expect(stderr).toContain('--debug=henri:*');
    });

    test('refuses to generate outside of a project with exit code 3', () => {
      const { status, stderr } = henri(['generate', 'model', 'Thing'], {
        cwd: dir,
      });

      expect(status).toBe(3);
      expect(stderr).toContain('is not an henri project');
      expect(stderr).toContain('henri new <name>');
    });
  });
});
