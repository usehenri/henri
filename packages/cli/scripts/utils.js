/* eslint-disable no-console */
const fs = require('fs-extra');
const path = require('path');
const spawn = require('cross-spawn');

const { version, commands } = require('../package.json');

const cwd = process.cwd();

/**
 * Check if a file exists
 *
 * @param {*} file Filename
 * @returns {boolean} True or false?
 */
const check = (file) => fs.existsSync(path.join(cwd, file));

/**
 * Detects which package manager is available, preferring pnpm, then yarn, then npm.
 * Honors the packageManager field of the current project when present.
 *
 * @param {string} [dir=process.cwd()] Project directory
 * @returns {('pnpm'|'yarn'|'npm')} The package manager binary name
 */
const detectPackageManager = (dir = process.cwd()) => {
  try {
    const pkg = require(path.resolve(dir, 'package.json'));
    const declared =
      typeof pkg.packageManager === 'string' &&
      pkg.packageManager.split('@')[0];

    if (declared && ['pnpm', 'yarn', 'npm'].includes(declared)) {
      return declared;
    }
  } catch {
    // No package.json yet; fall through to detection
  }

  for (const candidate of ['pnpm', 'yarn']) {
    const result = spawn.sync(candidate, ['--version'], { stdio: 'ignore' });

    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  return 'npm';
};

/**
 * Resolve the package.json of a package installed in a project
 *
 * @param {string} name Package name (ex: @usehenri/core)
 * @param {string} [dir=process.cwd()] Project directory to resolve from
 * @returns {object|null} The parsed package.json or null when not installed
 */
const resolvePackageJson = (name, dir = process.cwd()) => {
  const paths = [path.resolve(dir)];

  try {
    return require(require.resolve(`${name}/package.json`, { paths }));
  } catch {
    // Package hides package.json behind "exports": walk up from its entry
  }

  try {
    let current = path.dirname(require.resolve(name, { paths }));

    while (current !== path.dirname(current)) {
      const candidate = path.join(current, 'package.json');

      if (fs.existsSync(candidate)) {
        const pkg = require(candidate);

        if (pkg.name === name) {
          return pkg;
        }
      }
      current = path.dirname(current);
    }
  } catch {
    // Not installed
  }

  return null;
};

/**
 * Will validate if it's an henri install (more or less)
 *
 * @param {*} args Fatal or no
 * @returns {boolean|void} If fatal is specified, exit the process
 */
const validInstall = (args) => {
  try {
    const pkg = require(path.resolve(process.cwd(), 'package.json'));

    if (pkg && !pkg.henri) {
      return notHenri(args);
    }
    if (!fs.existsSync(path.resolve(process.cwd(), 'app/views/pages'))) {
      return notHenri(args);
    }

    return true;
  } catch {
    return notHenri(args);
  }
};

/**
 * Abort or return false
 *
 * @param {*} args Aguments
 * @returns {boolean|void} Good or not?
 */
const notHenri = ({ fatal = false } = {}) => {
  if (fatal) {
    abort(
      `
    Seems like you are not in an henri project.

    Aborting...
    `,
      true
    );
  }

  return false;
};

/**
 * Print error and exit
 *
 * @param {*} msg The message
 * @param {boolean} [fail=false] If fail, exit with 1 instead of 0
 * @return {void}
 */
const abort = (msg, fail = false) => {
  console.log(`
  ${msg}
  `);
  process.exit(fail ? 1 : 0);
};

/**
 * Helper function to print headers (with version)
 * @return {string} the header
 */
const helpHeader = () =>
  `
  henri (${version})
  `;

/**
 * Formats code with prettier using the henri house style
 *
 * @param {string} code Source code
 * @returns {Promise<string>} Formatted code
 */
const format = async (code) => {
  const prettier = require('prettier');

  return prettier.format(code, {
    parser: 'babel',
    singleQuote: true,
    trailingComma: 'es5',
  });
};

module.exports = {
  abort,
  check,
  commands,
  cwd,
  detectPackageManager,
  format,
  helpHeader,
  resolvePackageJson,
  validInstall,
  version,
};
