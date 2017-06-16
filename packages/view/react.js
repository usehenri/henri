const path = require('path');
const next = require(path.resolve(process.cwd(), 'node_modules', 'next'));
const conf = require('./conf');
const moduleAlias = require('module-alias');

const renderer = henri.config.get('renderer').toLowerCase();

switch (renderer) {
  case 'react':
    henri.checkPackages(['react', 'react-dom', 'next']);
    break;
  case 'preact':
    henri.checkPackages([
      'react',
      'react-dom',
      'next',
      'preact',
      'preact-compat',
    ]);
    break;
  case 'inferno':
    henri.checkPackages([
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

const instance = next({
  dir: henri.folders.view,
  dev: !henri.isProduction,
  conf,
});

function prepare() {
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

module.exports = { fallback, instance, prepare, render };
