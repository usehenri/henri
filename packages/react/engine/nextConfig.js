/**
 * Builds the next.js configuration used by the henri react engine for an
 * application directory: henri's defaults, extended by the user hooks in
 * config/next.js (any bundler) and config/webpack.js (switches to webpack).
 *
 * `./conf` evaluates it for `process.cwd()`, which is what `next build` reads
 * through `app/views/next.config.js`; the engine calls it with `henri.cwd()`.
 *
 * Import aliases (`import x from 'components/x'`) come from the
 * `app/views/jsconfig.json` file (`baseUrl: "."`), which both Turbopack and
 * webpack honour; the engine creates it when the application has none.
 */
const path = require('path');
const debug = require('debug')('henri:react');
const { loadUserHooks, report } = require('./hooks');

const EXAMPLE = [
  'Check the syntax of config/webpack.js. See below for a jQuery example:',
  '',
  '    module.exports = {',
  '      webpack: (config, { dev }, webpack) => {',
  '        config.plugins.push(',
  '          new webpack.ProvidePlugin({',
  "            $: 'jquery',",
  "            jQuery: 'jquery',",
  '          })',
  '        );',
  '        return config;',
  '      },',
  '    };',
  '',
];

/**
 * Is this a webpack configuration next.js can still use?
 *
 * @param {*} config what the user hook returned
 * @returns {boolean} valid?
 */
function isWebpackConfig(config) {
  return Boolean(
    config &&
    typeof config === 'object' &&
    config.module &&
    config.module.rules &&
    config.resolve
  );
}

/**
 * Wrap the user's config/webpack.js hook so a broken return value fails the
 * build with an explanation instead of leaving next.js with a bad config.
 * next.js does not await this hook, so the user function must be synchronous.
 *
 * @param {function} hook the `webpack` export of config/webpack.js
 * @returns {function} the next.js `webpack` configuration hook
 */
function createWebpackHook(hook) {
  return function webpack(config, options) {
    const result = hook(config, options, options.webpack);

    if (result && typeof result.then === 'function') {
      report(
        'config/webpack.js returned a promise: the webpack hook must be synchronous.'
      );
      throw new Error(
        'config/webpack.js: the webpack hook must be synchronous'
      );
    }

    if (!isWebpackConfig(result)) {
      report('Seems like you removed stuff from your webpack configuration...');
      report('');
      report(
        'Are you sure that you are returning the config passed as argument?'
      );
      report('');
      EXAMPLE.forEach((line) => report(line));
      throw new Error(
        'config/webpack.js: the webpack hook must return the configuration it received'
      );
    }

    return result;
  };
}

/**
 * Build the next.js configuration for an application
 *
 * @param {string} [cwd=process.cwd()] the application directory
 * @returns {object} the next.js configuration
 */
function createNextConfig(cwd = process.cwd()) {
  const dir = path.resolve(cwd, 'app/views');
  const hooks = loadUserHooks(cwd);

  let config = {
    sassOptions: {
      loadPaths: [
        path.join(dir, 'styles'),
        dir,
        path.join(cwd, 'node_modules'),
      ],
    },
    // Note: henri's router runs first, next.js only sees what henri did not
    // route (and the pages henri renders through res.render). Filesystem
    // routing stays enabled: next.js 16 refuses to render page files otherwise.
  };

  if (hooks.webpack) {
    debug(
      'config/webpack.js found: building with webpack instead of turbopack'
    );
    config.webpack = createWebpackHook(hooks.webpack);
  }

  if (typeof hooks.next === 'function') {
    config = hooks.next(config) || config;
  } else if (hooks.next) {
    config = Object.assign({}, config, hooks.next);
  }

  debug('next.js configuration %O', config);

  return config;
}

module.exports = { createNextConfig, createWebpackHook };
