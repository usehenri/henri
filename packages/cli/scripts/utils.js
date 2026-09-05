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
const check = (file) => fs.existsSync(path.join(process.cwd(), file));

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
 * Resolve a module the way `require()` would from a project directory
 *
 * @param {string} name Module name (ex: @usehenri/react/engine)
 * @param {string} [dir=process.cwd()] Project directory to resolve from
 * @returns {string} Absolute path of the module entry
 * @throws when the module is not installed in the project
 */
const resolveFrom = (name, dir = process.cwd()) =>
  require.resolve(name, { paths: [path.resolve(dir)] });

/**
 * Resolve the package.json of a package installed in a project
 *
 * @param {string} name Package name (ex: @usehenri/core)
 * @param {string} [dir=process.cwd()] Project directory to resolve from
 * @returns {object|null} The parsed package.json or null when not installed
 */
const resolvePackageJson = (name, dir = process.cwd()) => {
  try {
    return require(resolveFrom(`${name}/package.json`, dir));
  } catch {
    // Package hides package.json behind "exports": walk up from its entry
  }

  try {
    let current = path.dirname(resolveFrom(name, dir));

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
 * Read the application configuration the way @usehenri/core does:
 * config/<NODE_ENV>.json when it exists, config/default.json otherwise.
 *
 * @param {string} [dir=process.cwd()] Project directory
 * @param {string} [env=process.env.NODE_ENV] Environment name
 * @returns {object} The configuration ({} when no file exists)
 */
const readConfig = (dir = process.cwd(), env = process.env.NODE_ENV) => {
  const candidates = [
    path.join(dir, 'config', `${env || 'dev'}.json`),
    path.join(dir, 'config', 'default.json'),
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return fs.readJsonSync(file);
    }
  }

  return {};
};

/**
 * Load config/routes.js from a project without the require cache
 *
 * @param {string} [dir=process.cwd()] Project directory
 * @returns {object} The raw routes ({} when the file is missing)
 * @throws when the file has a syntax error
 */
const readRoutes = (dir = process.cwd()) => {
  const location = path.join(dir, 'config', 'routes.js');

  if (!fs.existsSync(location)) {
    return {};
  }

  delete require.cache[require.resolve(location)];

  return require(location);
};

/**
 * Is a directory inside a git repository (a .git entry in it or above)?
 *
 * @param {string} [dir=process.cwd()] Directory to check
 * @returns {boolean} True when inside a repository
 */
const insideGit = (dir = process.cwd()) => {
  let current = path.resolve(dir);

  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return true;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return false;
    }
    current = parent;
  }
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

/**
 * Capitalize a word
 *
 * @param {string} word Word that needs to be capitalized
 * @returns {string} Capitalized word
 */
const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Pluralize an english word (enough for resource names: task -> tasks,
 * category -> categories, box -> boxes, person -> people)
 *
 * @param {string} word A singular word
 * @returns {string} Its plural
 */
const pluralize = (word) => {
  const lower = word.toLowerCase();
  const irregulars = {
    child: 'children',
    man: 'men',
    person: 'people',
    woman: 'women',
  };

  if (irregulars[lower]) {
    return irregulars[lower];
  }

  if (/(s|x|z|ch|sh)$/.test(lower)) {
    return `${lower}es`;
  }

  if (/[^aeiou]y$/.test(lower)) {
    return `${lower.slice(0, -1)}ies`;
  }

  return `${lower}s`;
};

/**
 * Names derived from a model name: `Post` gives
 * { doc: 'Post', lower: 'post', plural: 'posts' }
 *
 * @param {string} name Model or resource name, as typed by the user
 * @returns {{doc: string, lower: string, plural: string}} The names
 */
const names = (name) => {
  const lower = name.toLowerCase();

  return {
    doc: capitalize(name),
    lower,
    plural: pluralize(lower),
  };
};

module.exports = {
  abort,
  capitalize,
  check,
  commands,
  cwd,
  detectPackageManager,
  format,
  helpHeader,
  insideGit,
  names,
  pluralize,
  readConfig,
  readRoutes,
  resolveFrom,
  resolvePackageJson,
  validInstall,
  version,
};
