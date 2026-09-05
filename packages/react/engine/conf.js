/**
 * next.js configuration used by the henri react engine.
 *
 * It is loaded twice: by the engine (passed to `next()` as `conf`) and, for
 * production builds, by `next build` through the `app/views/next.config.js`
 * file that requires this module. The latter runs in worker processes where
 * the `henri` global does not exist, so this file only relies on
 * `process.cwd()` (henri changes the working directory to the application
 * root before loading the view engine).
 *
 * Import aliases (`import x from 'components/x'`) come from the
 * `app/views/jsconfig.json` file (`baseUrl: "."`), which both Turbopack and
 * webpack honour; the engine creates it when the application has none.
 */
const path = require('path');
const debug = require('debug')('henri:react');
const { loadUserHooks } = require('./hooks');

const cwd = process.cwd();
const dir = path.resolve(cwd, 'app/views');
const hooks = loadUserHooks(cwd);

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
 * webpack configuration hook (only used when config/webpack.js exists, which
 * switches the bundler from Turbopack to webpack)
 *
 * @param {object} config webpack configuration built by next.js
 * @param {object} options next.js webpack options ({ dev, isServer, ... })
 * @returns {object} the configuration
 */
function webpack(config, options) {
  config = hooks.webpack(config, options, options.webpack);

  if (!config || !config.module || !config.module.rules || !config.resolve) {
    report('Seems like you removed stuff from your webpack configuration...');
    report('');
    report('Are you sure that you are returning the config passed as argument?');
    report('');
    report('Check the syntax of config/webpack.js. See below for a jQuery example:');
    report('');
    report('    module.exports = {');
    report('      webpack: (config, { dev }, webpack) => {');
    report('        config.plugins.push(');
    report('          new webpack.ProvidePlugin({');
    report("            $: 'jquery',");
    report("            jQuery: 'jquery',");
    report('          })');
    report('        );');
    report('        return config;');
    report('      },');
    report('    };');
    report('');
    process.exit(-1);
  }

  return config;
}

let config = {
  sassOptions: {
    loadPaths: [path.join(dir, 'styles'), dir, path.join(cwd, 'node_modules')],
  },
  // Note: henri's router runs first, next.js only sees what henri did not
  // route (and the pages henri renders through res.render). Filesystem
  // routing stays enabled: next.js 16 refuses to render page files otherwise.
};

if (hooks.webpack) {
  debug('config/webpack.js found: building with webpack instead of turbopack');
  config.webpack = webpack;
}

if (typeof hooks.next === 'function') {
  config = hooks.next(config) || config;
} else if (hooks.next) {
  config = Object.assign({}, config, hooks.next);
}

debug('next.js configuration %O', config);

module.exports = config;
