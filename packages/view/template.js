const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { log } = henri;

const cache = new Map();

const instance = {
  render: (req, res, route, opts) => {
    route = route === '/' ? '/index' : route;
    const data = getFile(route);

    if (!data) {
      return res.status(404).send('Not Found');
    }
    const script = new vm.Script('`' + data.replace(/`/g, '\\`') + '`');

    try {
      const result = script.runInNewContext({ data: opts.data });
      res.send(result);
    } catch (e) {
      log.error(`An error occured while rendering ${route}`);
      e.stack = e.stack.split('\n');
      e.stack.splice(1, 3);
      e.stack = e.stack.join('\n');
      log.error(e.stack);
      return res.status(500).send('Internal Server Error');
    }
  },
};

function prepare() {
  return new Promise(resolve => resolve());
}

function fallback(router) {
  router.get('*', (req, res) => {
    return render(req, res, req.path, {});
  });
}

function render(req, res, route, opts) {
  instance.render(req, res, route, opts);
}

function getFile(route) {
  const fullRoute = route.slice(-1) === '/' ? `${route}index` : route;
  const pathToFile = `${path.join(henri.folders.view, 'pages', route)}.html`;

  if (henri.isProduction && cache.has(pathToFile)) {
    return cache.get(pathToFile);
  }

  try {
    const data = fs.readFileSync(pathToFile);
    if (henri.isProduction) {
      cache.set(pathToFile, data);
    }
    return data.toString('utf8');
  } catch (e) {
    // Maybe we should cache 404s also..
    log.error(`404 - ${route} ${fullRoute} ${pathToFile}`);
    return null;
  }
}

module.exports = { fallback, prepare, render };
