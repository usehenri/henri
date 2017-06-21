const path = require('path');

const { log, view, express } = henri;

async function init(reload = false) {
  const { controllers } = henri;
  henri.router = express.Router();

  middlewares();

  const routes = require(path.resolve('./app/routes'));

  for (const key in routes) {
    const controller = routes[key];
    const routeKey = key.split(' ');
    let verb = routeKey.length > 1 ? routeKey[0].toLowerCase() : 'get';
    let route = routeKey.length > 1 ? routeKey[1] : key;

    if (controllers.hasOwnProperty(controller)) {
      register(verb, route, controller, controllers[controller]);
      register(verb, `/_data${route}`, controller, controllers[controller]);
      log.info(`${key} => ${controller}: registered.`);
    } else {
      register(verb, route, controller);
      log.error(`${key} => ${controller}: unknown controller for route `);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    henri.router.get('/_routes', (req, res) => res.json(henri._routes));
  }

  if (view && !reload) {
    view.prepare().then(() => {
      view.fallback(henri.router);
      henri.start(global['_initialDelay'] || null);
    });
  } else {
    view.fallback(henri.router);
  }
}

function register(verb, route, controller, fn) {
  if (typeof fn === 'function') {
    henri.router[verb](route, fn);
  }
  const name = `${verb} ${route}`;
  const entry = {};
  entry[name] = `${controller}${typeof fn !== 'function'
    ? ' (unknown controller)'
    : ' (ok)'}`;
  henri._routes.push(entry);
}

function middlewares(router) {
  henri.router.use((req, res, cb) => {
    res.locals._req = req;
    delete res.render;
    res.render = (route, data) => {
      const opts = {
        data,
        query: req.query,
      };
      if (req.url.startsWith('/_data/')) {
        return res.json(data);
      }
      view.render(req, res, route, opts);
    };
    cb();
  });
}

async function reload() {
  await init(true);
  log.warn('routes reloaded');
}

henri.addLoader(reload);

module.exports = init();

log.info('router module loaded.');
