const { fail } = require('./base/errors');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const util = require('util');
const readline = require('readline');
const { globSync } = require('glob');
const debug = require('debug')('henri:utils');

/**
 * Resolve a module the way `require()` would from a given directory.
 * Walks up the parent directories, so hoisted workspace packages are found.
 *
 * @param {string} request module name or path (ex: '@usehenri/disk')
 * @param {string} [dir=process.cwd()] directory to resolve from
 * @returns {string} absolute path to the module entry file
 * @throws when the module cannot be resolved
 */
function resolveFrom(request, dir = process.cwd()) {
  return require.resolve(request, { paths: [path.resolve(dir)] });
}

/**
 * Locate the package.json of an installed package
 *
 * @param {string} pkgName package name (ex: 'react')
 * @param {string} [dir=process.cwd()] directory to resolve from
 * @returns {object} parsed package.json
 * @throws when the package cannot be found
 */
function resolvePackageJson(pkgName, dir = process.cwd()) {
  try {
    return require(resolveFrom(`${pkgName}/package.json`, dir));
  } catch (error) {
    // Package uses "exports" without exposing package.json: walk up from main
    let current = path.dirname(resolveFrom(pkgName, dir));

    while (current !== path.dirname(current)) {
      const candidate = path.join(current, 'package.json');

      if (fs.existsSync(candidate)) {
        const pkg = require(candidate);

        if (pkg.name === pkgName) {
          return pkg;
        }
      }
      current = path.dirname(current);
    }

    throw error;
  }
}

/**
 * Detect the package manager of a project
 * pnpm when `pnpm-lock.yaml` or the `packageManager` field says so, then
 * yarn (`yarn.lock` or `packageManager`), npm otherwise. Parent directories
 * are checked too, so an application inside a workspace is detected.
 *
 * @param {string} [dir=process.cwd()] project directory
 * @returns {('pnpm'|'yarn'|'npm')} the package manager name
 */
function detectPackageManager(dir = process.cwd()) {
  let current = path.resolve(dir);

  for (;;) {
    let declared = '';

    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(current, 'package.json'), 'utf8')
      );

      declared =
        typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
    } catch (error) {
      declared = '';
    }

    // An explicit packageManager field wins over lockfiles
    const explicit = ['pnpm', 'yarn', 'npm'].find((name) =>
      declared.startsWith(name)
    );

    if (explicit) {
      return explicit;
    }

    if (fs.existsSync(path.join(current, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }

    if (fs.existsSync(path.join(current, 'yarn.lock'))) {
      return 'yarn';
    }

    if (fs.existsSync(path.join(current, 'package-lock.json'))) {
      return 'npm';
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return 'npm';
    }
    current = parent;
  }
}

/**
 * The exact command to install packages in a project
 *
 * @param {Array<string>} packages package names (with optional @version)
 * @param {string} [dir=process.cwd()] project directory
 * @returns {string} the install command (ex: 'pnpm add next react')
 */
function installCommand(packages, dir = process.cwd()) {
  const commands = {
    npm: 'npm install --save',
    pnpm: 'pnpm add',
    yarn: 'yarn add',
  };

  return `${commands[detectPackageManager(dir)]} ${packages.join(' ')}`;
}

/**
 * Check that a list of packages is installed in the current project
 * Nothing is ever installed on the user's behalf: the exact install command
 * for the detected package manager is printed and an error is thrown.
 *
 * @async
 * @throws when at least one package is missing (or too old)
 * @param {Array<string>} [packages=[]] package names (with optional @version)
 * @param {Henri} [inst=global.henri] the henri instance (for logging)
 * @returns {Promise<boolean>} true when everything is installed
 */
async function checkPackages(packages = [], inst = global.henri) {
  const missing = checkMissing(packages);

  if (missing.length < 1) {
    return true;
  }

  const command = installCommand(missing);
  const message = `Unable to load ${generateMessage(missing)} from the current project.

  Install ${missing.length > 1 ? 'them' : 'it'} with:

    ${command}
`;

  if (inst && inst.pen) {
    inst.pen.error('packages', `missing: ${missing.join(' ')}`);
    inst.pen.error('packages', `run: ${command}`);
  }

  throw fail('HENRI_BOOT_PACKAGES_MISSING', message);
}

/**
 * Compare two dotted version strings (pre-release tags are ignored)
 *
 * @param {string} left a version (ex: 15.1.0)
 * @param {string} right another version (ex: 15.0.0)
 * @returns {number} negative when left < right, 0 when equal, positive otherwise
 */
function compareVersions(left, right) {
  const parse = (version) =>
    String(version)
      .replace(/^[^\d]*/, '')
      .split('-')[0]
      .split('.')
      .map((part) => parseInt(part, 10) || 0);
  const first = parse(left);
  const second = parse(right);
  const size = Math.max(first.length, second.length);

  for (let index = 0; index < size; index++) {
    const delta = (first[index] || 0) - (second[index] || 0);

    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

/**
 *  Checks missing packages
 *
 * @param {any} packages list of packages
 * @returns  {Array<string>} missing packages
 */
function checkMissing(packages) {
  debug(`checking for missing packages in: ${packages.join(' ')}`);
  let missing = [];

  for (let pkg of packages) {
    try {
      // Scoped packages start with '@': only the version separator is split
      const at = pkg.lastIndexOf('@');
      const pkgName = at > 0 ? pkg.slice(0, at) : pkg;
      const version = at > 0 ? pkg.slice(at + 1) : null;

      resolveFrom(pkgName);

      if (version) {
        const target = resolvePackageJson(pkgName);

        if (compareVersions(target.version, version) < 0) {
          debug(
            `package version error for ${pkgName}; wanted >= ${version} but got ${target.version}`
          );
          throw new Error('version mismatch');
        }
      }
    } catch (error) {
      missing.push(pkg);
    }
  }

  missing.length > 0 && debug(`missing pkgs: ${missing.join(' ')}`);

  return missing;
}

/**
 * Join and conjugates words in a human readable manner
 *
 * @param {Array<string>} missing items
 * @returns {string} human readable string (ex: 'a', 'b' and 'c')
 */
const generateMessage = (missing) => {
  const quoted = missing.map((val) => `'${val}'`);

  if (quoted.length > 1) {
    return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  }

  return quoted.join('');
};

/**
 * Load every module of a directory, recursively (replaces include-all)
 * Keys are the lowercased file name without extension (`identity`), and
 * `globalId` keeps the original case, as the adapters expect. With
 * `keepDirectoryPath`, sub-directories prefix the key (`admin/users`).
 * Modules are always re-read from disk (the require cache is bypassed), so
 * reloads pick up changes.
 *
 * @param {string} location directory to load from
 * @param {object} [options={}] options
 * @param {boolean} [options.keepDirectoryPath=false] prefix keys with folders
 * @returns {object} the modules, keyed by identity
 * @throws on duplicate keys or when a module fails to load
 */
function loadModules(location, { keepDirectoryPath = false } = {}) {
  const dirname = path.resolve(location);
  const modules = {};

  if (!fs.existsSync(dirname)) {
    return modules;
  }

  const files = globSync('**/*.js', {
    cwd: dirname,
    ignore: ['**/.git/**', '**/.svn/**', '**/node_modules/**'],
    nodir: true,
    posix: true,
  }).sort();

  for (const file of files) {
    const fullPath = path.join(dirname, file);
    const name = keepDirectoryPath
      ? file.replace(/\.js$/, '')
      : path.posix.basename(file, '.js');

    delete require.cache[require.resolve(fullPath)];

    const mod = require(fullPath);

    if (typeof mod === 'undefined' || mod === null) {
      continue;
    }

    if (!mod.identity) {
      mod.identity = name;
    }

    if (!mod.globalId) {
      mod.globalId = mod.identity;
    }

    mod.identity = String(mod.identity).toLowerCase();

    if (Object.prototype.hasOwnProperty.call(modules, mod.identity)) {
      throw fail(
        'HENRI_BOOT_DUPLICATE_IDENTITY',
        `Duplicate module '${mod.identity}' while loading ${dirname} (${file})`
      );
    }

    modules[mod.identity] = mod;
  }

  return modules;
}

/**
 * Is the address a loopback address?
 *
 * @param {string} address an ip address (ex: 127.0.0.1, ::1, ::ffff:127.0.0.1)
 * @returns {boolean} loopback or not
 */
function isLoopback(address) {
  if (typeof address !== 'string' || address.length < 1) {
    return false;
  }

  const ip = address.toLowerCase().replace(/^::ffff:/, '');

  return ip === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

/**
 * Chalk color for log/pen
 *
 * @param {string} [level='error'] error level
 * @returns {string} color
 */
function getColor(level = 'error') {
  const colors = {
    debug: 'blue',
    error: 'red',
    info: 'green',
    silly: 'magenta',
    verbose: 'white',
    warn: 'yellow',
  };

  return colors[level.toLowerCase()] || 'red';
}

/**
 * Clears the console
 * Thanks to friendly-errors-webpack-plugin
 *
 * @returns {boolean} success?
 */
function clearConsole() {
  if (process.stdout.isTTY && process.env.NODE_ENV !== 'test') {
    // Fill screen with blank lines. Then move to 0 (beginning of visible part) and clear it
    const blank = '\n'.repeat(process.stdout.rows || 1);

    console.log(blank); // eslint-disable-line no-console
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  }

  return true;
}

/**
 * Wrap a V8 call site (or a util.getCallSites() record) in the small
 * interface the module system uses
 *
 * @param {object} site a call site
 * @returns {{getFileName: function, getFunctionName: function, getLineNumber: function, getColumnNumber: function}} the frame
 */
function frame(site) {
  const isV8 = typeof site.getFileName === 'function';

  return {
    getColumnNumber: () => (isV8 ? site.getColumnNumber() : site.column),
    getFileName: () => (isV8 ? site.getFileName() : site.scriptName),
    getFunctionName: () =>
      (isV8 ? site.getFunctionName() : site.functionName) || null,
    getLineNumber: () => (isV8 ? site.getLineNumber() : site.lineNumber),
  };
}

/**
 * The current call stack (replaces callsite)
 * Index 0 is the function calling stack(), index 1 its caller, and so on.
 * Uses util.getCallSites() (Node 22.9+) and falls back to V8's structured
 * stack trace.
 *
 * @param {number} [limit=16] maximum number of frames
 * @returns {Array<object>} frames exposing getFileName/getFunctionName/getLineNumber
 */
function stack(limit = 16) {
  if (typeof util.getCallSites === 'function') {
    try {
      // Skip this very function
      return util
        .getCallSites(limit + 1)
        .slice(1)
        .map(frame);
    } catch (error) {
      debug('util.getCallSites failed, falling back to V8: %s', error);
    }
  }

  const original = Error.prepareStackTrace;
  const holder = {};

  Error.prepareStackTrace = (_, sites) => sites;
  Error.captureStackTrace(holder, stack);
  const sites = holder.stack;

  Error.prepareStackTrace = original;

  return (Array.isArray(sites) ? sites : []).slice(0, limit).map(frame);
}

/**
 * Checks the syntax of a file and reports errors through the pen
 *
 * @param {string} location file location
 * @param {function} [onSuccess] callback called when the syntax is valid
 * @param {Henri} [inst=global.henri] the henri instance
 * @returns {Promise<(boolean|string|Error)>} true when valid, a message when unreadable, the SyntaxError otherwise
 */
async function syntax(location, onSuccess, inst = global.henri) {
  if (typeof inst === 'undefined' || inst === null) {
    throw new Error('henri is not defined...');
  }

  if (path.extname(location) === '.html') {
    return true;
  }

  let data;

  try {
    data = await fs.promises.readFile(location, 'utf8');
  } catch (error) {
    return `unable to check the syntax of ${location}`;
  }

  return parseSyntax(location, data, onSuccess, inst);
}

/**
 * Check the syntax of a source file with Node's own parser
 * JSON files are parsed, CommonJS files are compiled (not executed).
 * Other file types are not checked.
 *
 * @param {string} file filename (used for the extension and error frames)
 * @param {string} source file contents
 * @returns {boolean} true when the syntax is valid or not checkable
 * @throws {SyntaxError} when the source does not parse
 */
function checkSyntax(file, source) {
  const ext = path.extname(file).toLowerCase();

  if (ext === '.json') {
    JSON.parse(source);

    return true;
  }

  if (ext === '.js' || ext === '.cjs') {
    new vm.Script(source, { filename: file });

    return true;
  }

  return true;
}

/**
 * Parse a file and report syntax errors through the pen
 *
 * @param {string} file filename
 * @param {string} data file data
 * @param {function} [onSuccess] callback
 * @param {Henri} [inst=global.henri] the henri instance
 * @returns {(boolean|Error)} true when valid, the error otherwise
 */
function parseSyntax(file, data, onSuccess, inst = global.henri) {
  if (typeof inst === 'undefined' || inst === null) {
    throw new Error('henri is not defined...');
  }

  try {
    checkSyntax(file, data.toString());

    typeof onSuccess === 'function' && onSuccess();

    return true;
  } catch (error) {
    // V8 syntax errors start their stack with "<file>:<line>" then a code frame
    const lines = (error.stack || '').split('\n');
    const match = /:(\d+)$/.exec(lines[0] || '');
    const line = match ? match[1] : 0;
    const frames = lines.slice(0, 3).join('\n');

    inst.pen.error('server', `while parsing ${file}:${line}`);
    // eslint-disable-next-line no-console
    console.log(' ');
    // eslint-disable-next-line no-console
    console.log(frames);
    // eslint-disable-next-line no-console
    console.log(' ');

    return error;
  }
}

module.exports = {
  checkMissing,
  checkPackages,
  checkSyntax,
  clearConsole,
  compareVersions,
  detectPackageManager,
  getColor,
  installCommand,
  isLoopback,
  loadModules,
  resolveFrom,
  resolvePackageJson,
  stack,
  syntax,
};
