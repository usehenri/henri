const { cwd, log, utils: { checkPackages } } = henri;
const path = require('path');
const next = require('next');
const builder = require(path.resolve(require.resolve('next'), '../build'))
  .default;

const conf = henri.isTest ? {} : require('./conf');
const moduleAlias = require('module-alias');

let instance = null;
const renderer = henri.config.get('renderer').toLowerCase();

switch (renderer) {
  case 'react':
    checkPackages(['react', 'react-dom', 'react-hot-loader']);
    break;
  case 'preact':
    checkPackages(['react', 'react-dom', 'next', 'preact', 'preact-compat']);
    break;
  case 'inferno':
    checkPackages([
      'react',
      'react-dom',
      'next',
      'inferno',
      'inferno-compat',
      'inferno-server',
    ]);
    break;
}

if (henri.isProduction) {
  if (renderer === 'inferno') {
    moduleAlias.addAlias('react', 'inferno-compat');
    moduleAlias.addAlias('react-dom/server', 'inferno-server');
    moduleAlias.addAlias('react-dom', 'inferno-compat');
  }
  if (renderer === 'preact') {
    moduleAlias.addAlias('react', 'preact-compat');
    moduleAlias.addAlias('react-dom', 'preact-compat');
  }
}

async function prepare() {
  if (henri.isProduction) {
    log.info('building next.js pages for production');
    try {
      await builder(path.resolve(cwd, './app/views'), conf);
    } catch (e) {
      log.error(e);
    }
  }
  log.info('starting next.js instance...');
  instance = next({
    dir: path.resolve(cwd, './app/views'),
    dev: !henri.isProduction,
    conf,
  });

  return instance.prepare();
}

function fallback(router) {
  const handle = instance.getRequestHandler();
  router.get('*', (req, res) => {
    return handle(req, res);
  });
}

function render(req, res, route, opts) {
  instance.render(req, res, route, opts);
}

module.exports = { fallback, prepare, render };
