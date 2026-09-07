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
 * `assetPrefix` is `config.assets.prefix`, and **the environment variable is
 * how it actually arrives**, in both of the processes this function runs in.
 * `app/views/next.config.js` requires `./conf`, which calls this with
 * nothing but a working directory, and next.js reads that file: under the
 * `next build` henri spawns because there is no henri there at all, and --
 * measured rather than assumed -- inside a booted application too, where
 * next.js 16 answers a request through the configuration it loaded off disk
 * rather than through the `conf` object it was constructed with. A prefix
 * handed only to `next({ conf })` reaches the build manifest and never a tag
 * of the document. So `build()` sets `HENRI_ASSET_PREFIX` on the child's
 * environment and the engine sets it on its own before it calls this.
 *
 * The `assetPrefix` option is the explicit half, for a caller that has the
 * value in hand (the engine passes it as well, so `engine.conf` says what
 * next.js will do).
 *
 * `config/next.js` still gets the last word, like every other key here.
 *
 * @param {string} [cwd=process.cwd()] the application directory
 * @param {object} [options={}] `{ assetPrefix }`, from a booted henri
 * @returns {object} the next.js configuration
 */
function createNextConfig(cwd = process.cwd(), options = {}) {
  const dir = path.resolve(cwd, 'app/views');
  const hooks = loadUserHooks(cwd);
  const assetPrefix =
    typeof options.assetPrefix === 'string'
      ? options.assetPrefix
      : process.env.HENRI_ASSET_PREFIX || '';

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

  if (assetPrefix) {
    config.assetPrefix = assetPrefix;
  }

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
