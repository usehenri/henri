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
 * @param {string} dir Directory
 * @returns {void}
 */
const cleanup = (dir) => fs.rmSync(dir, { force: true, recursive: true });

module.exports = {
  bin,
  cleanup,
  exists,
  henri,
  read,
  routesOf,
  scaffold,
  tmpdir,
};
