const fs = require('fs');
const os = require('os');
const path = require('path');

const utils = require('../scripts/utils.js');

describe('cli utilities', () => {
  test('cwd returns correct directory', () => {
    expect(utils.cwd).toBe(process.cwd());
  });

  test('check looks for a file in the current directory', () => {
    expect(utils.check('package.json')).toBe(true);
    expect(utils.check('does-not-exist.json')).toBe(false);
  });

  test('pluralizes resource names', () => {
    expect(utils.pluralize('task')).toBe('tasks');
    expect(utils.pluralize('Category')).toBe('categories');
    expect(utils.pluralize('box')).toBe('boxes');
    expect(utils.pluralize('day')).toBe('days');
    expect(utils.pluralize('person')).toBe('people');
  });

  test('derives the names of a resource', () => {
    expect(utils.names('post')).toEqual({
      doc: 'Post',
      lower: 'post',
      plural: 'posts',
    });
    expect(utils.names('HighScore')).toEqual({
      doc: 'HighScore',
      lower: 'highscore',
      plural: 'highscores',
    });
  });

  test('reads the configuration the way core does', () => {
    const demo = path.resolve(__dirname, '../../demo');

    expect(utils.readConfig(demo, 'test').env).toBe('test');
    expect(utils.readConfig(demo, 'nothing').env).toBe('default');
    expect(utils.readConfig(path.resolve(__dirname), 'test')).toEqual({});
  });

  describe('package manager detection', () => {
    let dir;
    let agent;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-pm-'));
      agent = process.env.npm_config_user_agent;
    });

    afterEach(() => {
      fs.rmSync(dir, { force: true, recursive: true });
      if (typeof agent === 'undefined') {
        delete process.env.npm_config_user_agent;
      } else {
        process.env.npm_config_user_agent = agent;
      }
    });

    test('--pm wins over everything and is validated', () => {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ packageManager: 'yarn@4.0.0' })
      );

      expect(utils.packageManagerChoice(dir, 'pnpm')).toEqual({
        pm: 'pnpm',
        source: '--pm',
      });
      expect(() => utils.detectPackageManager(dir, 'bun')).toThrow(
        /Unknown package manager 'bun'/
      );
    });

    test('reads the packageManager field, then the lockfile', () => {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@11.25.0' })
      );
      expect(utils.detectPackageManager(dir)).toBe('pnpm');

      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
      expect(utils.packageManagerChoice(dir)).toEqual({
        pm: 'yarn',
        source: 'yarn.lock',
      });
    });

    // The regression: outside a project a mise shim answers non-zero for
    // `pnpm --version`, the probe fell through to yarn and a pnpm user got a
    // yarn application. The manager that ran the command is asked first now.
    test('prefers the manager that invoked the cli over the probe', () => {
      process.env.npm_config_user_agent =
        'pnpm/11.25.0 npm/? node/v24.0.0 darwin arm64';
      expect(utils.packageManagerChoice(dir)).toEqual({
        pm: 'pnpm',
        source: 'npm_config_user_agent',
      });

      process.env.npm_config_user_agent = 'yarn/4.0.0 npm/? node/v24.0.0';
      expect(utils.detectPackageManager(dir)).toBe('yarn');

      process.env.npm_config_user_agent = 'bun/1.0.0';
      expect(['pnpm', 'yarn', 'npm']).toContain(
        utils.detectPackageManager(dir)
      );
    });
  });

  test('finds the package.json of an ESM only dependency', () => {
    const inertia = path.resolve(__dirname, '../../inertia');

    // @inertiajs/react has no `require` and no `./package.json` condition in
    // its exports map: CommonJS resolution throws, the disk fallback answers
    expect(utils.resolvePackageJson('@inertiajs/react', inertia).name).toBe(
      '@inertiajs/react'
    );
    expect(utils.resolvePackageJson('@usehenri/cli', __dirname).name).toBe(
      '@usehenri/cli'
    );
    expect(utils.resolvePackageJson('not-a-real-package', inertia)).toBe(null);
  });

  test('detects a git repository from a nested directory', () => {
    expect(utils.insideGit(__dirname)).toBe(true);
    expect(utils.insideGit(path.parse(__dirname).root)).toBe(false);
  });
});
