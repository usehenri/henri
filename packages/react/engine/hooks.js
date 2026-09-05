const path = require('path');
const fs = require('fs');
const debug = require('debug')('henri:react');

/**
 * Report an error through henri's pen when it exists, or the console
 *
 * @param {...string} args message parts
 * @returns {void}
 */
function report(...args) {
  if (global.henri && global.henri.pen) {
    return global.henri.pen.error('react', ...args);
  }

  // eslint-disable-next-line no-console
  return console.error('[react]', ...args);
}

/**
 * Load a user hook file (config/webpack.js or config/next.js).
 * The file must export an object with a `key` property.
 *
 * @param {string} file absolute path of the hook file
 * @param {string} key expected property (webpack, next)
 * @param {string[]} types accepted typeof values for the property
 * @returns {?(function|object)} the hook or null
 */
function loadHook(file, key, types) {
  if (!fs.existsSync(file)) {
    debug('no %s found', file);

    return null;
  }

  try {
    // eslint-disable-next-line global-require
    const conf = require(file);
    const hook = conf && conf[key];

    if (types.includes(typeof hook) && hook !== null) {
      debug('loaded %s hook from %s', key, file);

      return hook;
    }

    report(
      `Can't load your ${path.relative(process.cwd(), file)} file.`,
      `It should export an object with a '${key}' ${types.join(' or ')}.`
    );
  } catch (error) {
    report(`unable to load ${file}`, error.message);
    debug('error', error);
  }

  return null;
}

/**
 * Load the user hooks that extend the next.js configuration
 *
 * - config/webpack.js: `{ webpack: (config, { dev }, webpack) => config }`
 *   Selecting this hook switches the bundler from Turbopack to webpack.
 * - config/next.js: `{ next: (config) => config }` or `{ next: { ...keys } }`
 *   Extends the next.js configuration whatever the bundler is.
 *
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {{ next: ?(function|object), webpack: ?function }} the hooks
 */
function loadUserHooks(cwd = process.cwd()) {
  return {
    next: loadHook(path.resolve(cwd, 'config', 'next.js'), 'next', [
      'function',
      'object',
    ]),
    webpack: loadHook(path.resolve(cwd, 'config', 'webpack.js'), 'webpack', [
      'function',
    ]),
  };
}

module.exports = { loadUserHooks };
