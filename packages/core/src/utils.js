const spawn = require('cross-spawn');
const { compareVersions } = require('compare-versions');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const stack = require('callsite');
const readline = require('readline');
const bounce = require('@hapi/bounce');
const debug = require('debug')('henri:utils');
const { checkbox } = require('@inquirer/prompts');

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
 *  Check if yarn exists
 *
 * @return {boolean} it exists?
 */
const yarnExists = () => spawn.sync('yarn', ['help']).status === 0;

/**
 *  Check if a bunch of packages exists
 *
 * @throws
 * @param {any} [packages=[]] list of packages
 * @returns {boolean} they exist?
 */
async function checkPackages(packages = []) {
  let missing = checkMissing(packages);

  if (missing.length > 0) {
    const msg = generateMessage(missing);

    if (henri.isDev && process.stdin.isTTY) {
      const install = await checkbox({
        choices: missing.map((name) => ({ name, value: name })),
        message:
          'Do you want me to try to install missing packages? (ctrl+c to cancel)',
      });

      if (install.length > 0) {
        if (yarnExists()) {
          spawn.sync('yarn', ['add', ...install], { stdio: 'inherit' });
        } else {
          spawn.sync('npm', ['install', '--save', ...install], {
            stdio: 'inherit',
          });
        }
      }
    } else {
      throw new Error(`Unable to load ${msg.join(' ')} from the current project.

      Try installing ${missing.length > 1 ? 'them' : 'it'}:

        # ${yarnExists() ? 'yarn add' : 'npm install'} ${missing.join(' ')}
      `);
    }
  }

  return true;
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
      const [pkgName, version = null] = pkg.split('@');

      resolveFrom(pkgName);

      if (version) {
        const target = resolvePackageJson(pkgName);

        if (compareVersions(target.version, version) < 0) {
          // eslint-disable-next-line no-console
          console.log(
            `package version error for ${pkgName}; wanted > ${version} but got ${target.version}`
          );
          throw new Error();
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
 * @param {string} missing items
 * @returns {string} human readable string (i hope...)
 */
const generateMessage = (missing) => {
  if (missing.length > 1) {
    return missing.map((val, index) =>
      index === missing.length - 1 ? `\b\b and '${val}'` : `'${val}',`
    );
  }

  return missing;
};

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
 * Checks syntax of a file (server.js has a better version?)
 *
 * @param {any} location file location
 * @param {any} onSuccess callback
 * @param {any} inst the henri instance
 * @returns {(Promise<string>|boolean)} result
 */
async function syntax(location, onSuccess, inst = undefined) {
  if (typeof inst === 'undefined') {
    if (typeof henri === 'undefined') {
      throw new Error('henri is not defined...');
    }
    inst = henri;
  }

  return new Promise((resolve) => {
    if (path.extname(location) === '.html') {
      inst.status.set('locked', false);

      return resolve();
    }
    fs.readFile(location, 'utf8', (err, data) => {
      if (err) {
        return resolve(`unable to check the syntax of ${location}`);
      }
      parseSyntax(resolve, location, data, onSuccess, inst);
    });
  });
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
 * @param {Promise} resolve to be resoived
 * @param {string} file filename
 * @param {string} data file data
 * @param {function} onSuccess callback
 * @param {any} inst the henri instance
 * @returns {Promise} result
 */
async function parseSyntax(resolve, file, data, onSuccess, inst = undefined) {
  if (typeof inst === 'undefined') {
    if (typeof henri === 'undefined') {
      throw new Error('henri is not defined...');
    }
    inst = henri;
  }

  try {
    checkSyntax(file, data.toString());

    inst.status.set('locked', false);
    typeof onSuccess === 'function' && onSuccess();

    return resolve(true);
  } catch (error) {
    // V8 syntax errors start their stack with "<file>:<line>" then a code frame
    const lines = (error.stack || '').split('\n');
    const match = /:(\d+)$/.exec(lines[0] || '');
    const line = match ? match[1] : 0;
    const frame = lines.slice(0, 3).join('\n');

    inst.pen.error('server', `while parsing ${file}:${line}`);
    // eslint-disable-next-line no-console
    console.log(' ');
    // eslint-disable-next-line no-console
    console.log(frame);
    // eslint-disable-next-line no-console
    console.log(' ');
    resolve(error);
  }
}

module.exports = {
  bounce,
  checkPackages,
  checkSyntax,
  clearConsole,
  getColor,
  resolveFrom,
  resolvePackageJson,
  stack,
  syntax,
  yarnExists,
};
