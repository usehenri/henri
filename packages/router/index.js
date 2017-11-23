const path = require('path');

const { express, log, view } = henri;

async function init(reload = false) {
  const { config, controllers } = henri;
  henri.router = express.Router();

  middlewares();

  let routes = null;
  /* istanbul ignore next */
  try {
    routes = require(config.has('location.routes')
      ? path.resolve(config.get('location.routes'))
      : path.resolve('./app/routes'));
  } catch (e) {
    log.warn('unable to load routes from filesystem');
    routes = {};
  }
  /* istanbul ignore next */
  if (config.has('routes') && Object.keys(config.get('routes')).length > 1) {
    routes = Object.assign({}, routes, config.get('routes'));
  }

  for (const key in routes) {
    let controller = routes[key];
    const routeKey = key.split(' ');
    let verb = routeKey.length > 1 ? routeKey[0].toLowerCase() : 'get';
    let route =
      routeKey.length > 1 ? routeKey[1].replace('/', '') : key.replace('/', '');
    if (typeof controller === 'string') {
      controller = { controller: controller };
    }
    if (verb === 'ressources') {
      const scope = controller.scope ? `/${controller.scope}/` : '/';
      routes[`get ${scope}${route}`] = {
        ...controller,
        controller: `${controller.controller}#index`,
      };
      routes[`get ${scope}${route}/new`] = {
        ...controller,
        controller: `${controller.controller}#new`,
      };
      routes[`post ${scope}${route}`] = {
        ...controller,
        controller: `${controller.controller}#create`,
      };
      routes[`get ${scope}${route}/:id`] = {
        ...controller,
        controller: `${controller.controller}#show`,
      };
      routes[`get ${scope}${route}/:id/edit`] = {
        ...controller,
        controller: `${controller.controller}#edit`,
      };
      routes[`patch ${scope}${route}/:id`] = {
        ...controller,
        controller: `${controller.controller}#update`,
      };
      routes[`put ${scope}${route}/:id`] = {
        ...controller,
        controller: `${controller.controller}#update`,
      };
      routes[`delete ${scope}${route}/:id`] = {
        ...controller,
        controller: `${controller.controller}#destroy`,
      };
      delete routes[key];
    } else {
      routes[key] = controller;
    }
  }

  for (const key in routes) {
    const controller = routes[key].controller;
    const routeKey = key.split(' ');
    let verb = routeKey.length > 1 ? routeKey[0].toLowerCase() : 'get';
    let route = routeKey.length > 1 ? routeKey[1] : key;

    if (controllers.hasOwnProperty(controller)) {
      register(verb, route, controller, controllers[controller]);
      register(verb, `/_data${route}`, controller, controllers[controller]);
      log.info(`${key} => ${controller}: registered`);
    } else {
      register(verb, route, controller);
      log.error(`${key} => ${controller}: unknown controller for route `);
    }
  }
  /* istanbul ignore next */
  if (process.env.NODE_ENV !== 'production') {
    henri.router.get('/_routes', (req, res) => res.json(henri._routes));
  }
  /* istanbul ignore next */
  if (view && !reload) {
    try {
      view.prepare().then(() => {
        view.fallback(henri.router);
        henri.start(global['_initialDelay'] || null);
      });
    } catch (error) {
      log.error('unable to start renderer: ', error);
    }
  } else {
    view && view.fallback(henri.router);
    !view && log.warn('unable to register view fallback route');
  }
}

function register(verb, route, controller, fn) {
  if (typeof fn === 'function') {
    henri.router[verb](route, fn);
  }
  const name = `${verb} ${route}`;
  henri._routes[name] = `${controller}${
    typeof fn !== 'function' ? ' (unknown controller)' : ' (ok)'
  }`;
}
/* istanbul ignore next */
function middlewares(router) {
  if (henri._middlewares.length > 0) {
    henri._middlewares.map(func => func());
  }
  henri.router.use((req, res, cb) => {
    res.locals._req = req;
    delete res.render;
    res.render = (route, data = {}) => {
      const opts = {
        data,
        user: req.user || {},
        query: req.query,
      };
      if (req.url.startsWith('/_data/')) {
        return res.json(data);
      }
      /* istanbul ignore next */
      return res.format({
        html: () => view.render(req, res, route, opts),
        json: () => res.json(data),
        default: () => view.render(req, res, route, opts),
      });
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
