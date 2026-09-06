const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bin = path.resolve(__dirname, '../../henri/bin/henri.js');

/**
 * Run the henri binary
 *
 * @param {string[]} args Arguments
 * @param {object} [opts] spawnSync options (cwd, ...)
 * @returns {object} spawnSync result with utf8 output
 */
const henri = (args, opts = {}) =>
  spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    ...opts,
  });

/**
 * Create a temporary directory
 *
 * @param {string} [prefix='henri-'] Directory prefix
 * @returns {string} The directory
 */
const tmpdir = (prefix = 'henri-') =>
  fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/**
 * Scaffold an application with `henri new` in a temporary directory
 *
 * @param {string[]} [flags=['--no-git']] Extra flags (--skip-install is always on)
 * @returns {{dir: string, app: string, result: object}} Paths and the spawn result
 */
const scaffold = (flags = ['--no-git']) => {
  const dir = tmpdir('henri-new-');
  const result = henri(['new', 'app', '--skip-install', ...flags], {
    cwd: dir,
  });

  if (result.status !== 0) {
    throw new Error(`henri new failed: ${result.stdout}${result.stderr}`);
  }

  return { app: path.join(dir, 'app'), dir, result };
};

/**
 * Read a file of the application
 *
 * @param {string} app Application directory
 * @param {string} file Relative path
 * @returns {string} Content
 */
const read = (app, file) => fs.readFileSync(path.join(app, file), 'utf8');

/**
 * Does a file exist in the application?
 *
 * @param {string} app Application directory
 * @param {string} file Relative path
 * @returns {boolean} Exists?
 */
const exists = (app, file) => fs.existsSync(path.join(app, file));

/**
 * Load config/routes.js of the application, fresh from disk every time
 * (the test runner's module registry would otherwise cache it)
 *
 * @param {string} app Application directory
 * @returns {object} The routes
 */
const routesOf = (app) => {
  const code = read(app, 'config/routes.js');
  const module = { exports: {} };

  new Function('module', 'exports', code)(module, module.exports);

  return module.exports;
};

/**
 * Remove a directory
 *
 * A directory that was never made is nothing to remove: an `afterAll` runs
 * even when the `beforeAll` that would have made it threw, and a TypeError
 * there hides the failure that actually happened.
 *
 * @param {string} dir Directory
 * @returns {void}
 */
const cleanup = (dir) =>
  dir && fs.rmSync(dir, { force: true, recursive: true });

/**
 * Link workspace packages into a fixture application's node_modules.
 *
 * Core resolves `@usehenri/<name>` from the application directory, and the
 * fixtures are checked in without one. Several test files share a fixture
 * and run at the same time, so the link is made without asking first
 * (`existsSync` then `symlinkSync` is two operations with a gap in between,
 * and the loser of that race got an `EEXIST` that read like a bug in the
 * fixture); an existing link, and one another file made a moment ago, are
 * both the wanted state.
 *
 * @param {string} fixture The application directory
 * @param {...string} names The workspace package names (`drizzle`, `jobs`)
 * @returns {void}
 */
const linkAdapter = (fixture, ...names) => {
  for (const name of names) {
    const target = path.join(fixture, 'node_modules', '@usehenri', name);

    fs.mkdirSync(path.dirname(target), { recursive: true });

    try {
      fs.symlinkSync(
        path.resolve(__dirname, '../..', name),
        target,
        'junction'
      );
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
};

module.exports = {
  bin,
  cleanup,
  exists,
  henri,
  linkAdapter,
  read,
  routesOf,
  scaffold,
  tmpdir,
};
