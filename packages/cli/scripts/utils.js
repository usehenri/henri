const fs = require('fs-extra');
const path = require('path');
const spawn = require('cross-spawn');

const { pluralize: corePluralize } = require('@usehenri/core/src/base/routes');
const { version, commands } = require('../package.json');

const cwd = process.cwd();

/**
 * Check if a file exists
 *
 * @param {*} file Filename
 * @returns {boolean} True or false?
 */
const check = (file) => fs.existsSync(path.join(process.cwd(), file));

/** The package managers henri knows how to install with */
const PACKAGE_MANAGERS = ['pnpm', 'yarn', 'npm'];

/** The lockfile each one leaves in a project */
const LOCKFILES = {
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
};

/**
 * Which package manager to install with, and why
 *
 * In order: an explicit choice (`--pm`), the `packageManager` field of the
 * project, its lockfile, the manager that invoked this process
 * (`npm_config_user_agent`, set by `pnpm dlx`, `npx`, `yarn dlx` and every
 * `<pm> run`), then a probe of the binaries. The probe is last because a
 * version manager shim can answer non-zero outside its own project (mise
 * exits 1 with "No version is set for shim: pnpm"), which used to hand a
 * pnpm user a yarn application with no pnpm-workspace.yaml.
 *
 * @param {string} [dir=process.cwd()] Project directory
 * @param {string} [preferred] An explicit choice (--pm)
 * @returns {{pm: ('pnpm'|'yarn'|'npm'), source: string}} The manager and
 *   where the answer came from
 * @throws {CliError} USAGE when `preferred` is not a known manager
 */
const packageManagerChoice = (dir = process.cwd(), preferred = undefined) => {
  if (typeof preferred !== 'undefined' && preferred !== null) {
    const wanted = String(preferred).toLowerCase();

    if (!PACKAGE_MANAGERS.includes(wanted)) {
      const { CliError } = require('./errors');

      throw new CliError('USAGE', `Unknown package manager '${preferred}'`, {
        hint: `Valid values: ${PACKAGE_MANAGERS.join(', ')}`,
      });
    }

    return { pm: wanted, source: '--pm' };
  }

  try {
    const pkg = fs.readJsonSync(path.resolve(dir, 'package.json'));
    const declared =
      typeof pkg.packageManager === 'string' &&
      pkg.packageManager.split('@')[0];

    if (declared && PACKAGE_MANAGERS.includes(declared)) {
      return { pm: declared, source: 'the packageManager field' };
    }
  } catch {
    // No package.json yet; fall through to detection
  }

  for (const [lockfile, name] of Object.entries(LOCKFILES)) {
    if (fs.existsSync(path.resolve(dir, lockfile))) {
      return { pm: name, source: lockfile };
    }
  }

  const [agent] = String(process.env.npm_config_user_agent || '').split('/');

  if (PACKAGE_MANAGERS.includes(agent)) {
    return { pm: agent, source: 'npm_config_user_agent' };
  }

  for (const candidate of ['pnpm', 'yarn']) {
    const result = spawn.sync(candidate, ['--version'], { stdio: 'ignore' });

    if (!result.error && result.status === 0) {
      return { pm: candidate, source: `${candidate} --version` };
    }
  }

  return { pm: 'npm', source: 'the default' };
};

/**
 * Which package manager to install with (see packageManagerChoice)
 *
 * @param {string} [dir=process.cwd()] Project directory
 * @param {string} [preferred] An explicit choice (--pm)
 * @returns {('pnpm'|'yarn'|'npm')} The package manager binary name
 * @throws {CliError} USAGE when `preferred` is not a known manager
 */
const detectPackageManager = (dir = process.cwd(), preferred = undefined) =>
  packageManagerChoice(dir, preferred).pm;

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
 * Three ways, because CommonJS resolution alone is not enough any more: an
 * ESM-only package whose `exports` map has no `./package.json` and no
 * `require` condition (`@inertiajs/react`) throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED on both attempts even though it is
 * installed, so the last resort reads node_modules from disk.
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
    // ESM only, or not installed at all: look on disk
  }

  let current = path.resolve(dir);

  for (;;) {
    const candidate = path.join(
      current,
      'node_modules',
      ...name.split('/'),
      'package.json'
    );

    try {
      if (fs.existsSync(candidate)) {
        return fs.readJsonSync(candidate);
      }
    } catch {
      // Unreadable: keep walking up
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return null;
    }
    current = parent;
  }
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
 * The view engines `henri new` and the generators know about, and the
 * directory under template/ each one is scaffolded from. `inertia` is the
 * default: server-rendered React on Vite, with no framework of its own to
 * grow into the server. `react` is the frozen Next.js engine.
 */
const RENDERERS = { inertia: 'inertia', react: 'default' };

/** The renderer of a new application, and of a configuration without one */
const DEFAULT_RENDERER = 'inertia';

/**
 * The view engine of an application, read back from its configuration so a
 * generator writes the pages that application can render
 *
 * @param {string} [dir=process.cwd()] Project directory
 * @returns {string} inertia (the default) or react
 */
const rendererOf = (dir = process.cwd()) => {
  let config = {};

  try {
    config = readConfig(dir, undefined);
  } catch {
    // An unreadable configuration: the default renderer will do
  }

  const renderer = String(
    (config && config.renderer) || DEFAULT_RENDERER
  ).toLowerCase();

  return RENDERERS[renderer] ? renderer : DEFAULT_RENDERER;
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
 * Does a directory hold a henri application? (a package.json with the
 * `henri` field and an app/views/pages folder)
 *
 * @param {string} [dir=process.cwd()] Directory to check
 * @returns {boolean} True when it looks like an application
 */
const isProject = (dir = process.cwd()) => {
  try {
    const pkg = fs.readJsonSync(path.resolve(dir, 'package.json'));

    return Boolean(
      pkg && pkg.henri && fs.existsSync(path.resolve(dir, 'app/views/pages'))
    );
  } catch {
    return false;
  }
};

/**
 * Will validate if it's an henri install (more or less)
 *
 * @param {*} args Fatal or no
 * @returns {boolean} Is the current directory an application?
 * @throws {CliError} NOT_A_PROJECT (exit code 3) when fatal and it is not
 */
const validInstall = ({ fatal = false } = {}) => {
  if (isProject(process.cwd())) {
    return true;
  }

  if (fatal) {
    const { CliError } = require('./errors');

    throw new CliError(
      'NOT_A_PROJECT',
      `${process.cwd()} is not an henri project`,
      {
        hint: 'Run the command from the root of your application (the folder with package.json and app/), or create one with: henri new <name>',
      }
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
 * Prefer the `@usehenri/core` the project depends on, and fall back to the
 * one shipped with this CLI
 *
 * @returns {string} Resolved path of the Henri class
 */
const resolveHenri = () => {
  try {
    return require.resolve('@usehenri/core/src/henri', {
      paths: [process.cwd()],
    });
  } catch {
    return require.resolve('@usehenri/core/src/henri');
  }
};

/**
 * Boots the application to a runlevel, without a port.
 *
 * Runlevel 4 is what `henri db:seed`, `henri jobs`, `henri privacy`,
 * `henri retention` and `henri trail` all boot to: the models and the user
 * module are there, no route is registered and nothing is listening.
 *
 * @param {object} [options={}] Options
 * @param {number} [options.runlevel=4] How far up to boot
 * @returns {Promise<object>} The henri instance
 */
const boot = async ({ runlevel = 4 } = {}) => {
  process.env.SKIP_WORKERS = 'true';
  process.env.CONSOLE_ONLY = 'true';

  const Henri = require(resolveHenri());
  const henri = new Henri({ runlevel });

  await henri.init();

  return henri;
};

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
 * Pluralize an english word, lowercased (task -> tasks, category ->
 * categories, box -> boxes, person -> people)
 *
 * The rules are core's (`base/routes.js`, next to `singularize`): the
 * resource names this command writes and the GraphQL fields henri derives
 * from a model have to agree on what a plural is.
 *
 * @param {string} word A singular word
 * @returns {string} Its plural
 */
const pluralize = (word) => corePluralize(String(word).toLowerCase());

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
  DEFAULT_RENDERER,
  PACKAGE_MANAGERS,
  RENDERERS,
  abort,
  boot,
  capitalize,
  check,
  commands,
  cwd,
  detectPackageManager,
  format,
  helpHeader,
  insideGit,
  isProject,
  names,
  packageManagerChoice,
  pluralize,
  readConfig,
  readRoutes,
  rendererOf,
  resolveFrom,
  resolveHenri,
  resolvePackageJson,
  validInstall,
  version,
};
