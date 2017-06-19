const path = require('path');
const Nuxt = require(path.resolve(process.cwd(), 'node_modules', 'nuxt'));
const { log } = henri;

let conf = {};

try {
  conf = require(path.resolve(cwd, 'config', 'nuxt.config.js'));
  delete conf.rootDir;
  log.info('using your nuxt.config.js file');
} catch (e) {
  log.info('preparing nuxt with default settings only.');
}

const defaultConfig = {
  srcDir: henri.folders.view,
  dev: !henri.isProduction,
};

Object.assign(conf, defaultConfig);

const instance = new Nuxt(conf);

function prepare() {
  return instance.build();
}

function fallback(router) {
  router.use(instance.render);
}

async function render(req, res, route, opts) {
  const { html, error, redirected } = await instance.render(route, {
    req,
    res,
  });
  // TODO: add error and redirected validation...
  res.send(html);
}

module.exports = { fallback, prepare, render };
