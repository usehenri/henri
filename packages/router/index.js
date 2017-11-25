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
    const [verb, route, controller] = parseRoute(key, routes[key]);

    if (verb === 'resources') {
      const scope = controller.scope ? `/${controller.scope}/` : '/';
      controller.resources = route;
      routes[`get ${scope}${route}`] = Object.assign({}, controller, {
        controller: `${controller.controller}#index`,
      });
      routes[`get ${scope}${route}/new`] = Object.assign({}, controller, {
        controller: `${controller.controller}#new`,
      });
      routes[`post ${scope}${route}`] = Object.assign({}, controller, {
        controller: `${controller.controller}#create`,
      });
      routes[`get ${scope}${route}/:_id`] = Object.assign({}, controller, {
        controller: `${controller.controller}#show`,
      });
      routes[`get ${scope}${route}/:_id/edit`] = Object.assign({}, controller, {
        controller: `${controller.controller}#edit`,
      });
      routes[`patch ${scope}${route}/:_id`] = Object.assign({}, controller, {
        controller: `${controller.controller}#update`,
      });
      routes[`put ${scope}${route}/:_id`] = Object.assign({}, controller, {
        controller: `${controller.controller}#update`,
      });
      routes[`delete ${scope}${route}/:_id`] = Object.assign({}, controller, {
        controller: `${controller.controller}#destroy`,
      });

      delete routes[key];
    } else if (verb === 'crud') {
      const scope = controller.scope ? `/${controller.scope}/` : '/';
      controller.resources = route;
      routes[`get ${scope}${route}`] = Object.assign({}, controller, {
        controller: `${controller.controller}#index`,
      });
      routes[`post ${scope}${route}`] = Object.assign({}, controller, {
        controller: `${controller.controller}#create`,
      });
      routes[`patch ${scope}${route}/:_id`] = Object.assign({}, controller, {
        controller: `${controller.controller}#update`,
      });
      routes[`put ${scope}${route}/:_id`] = Object.assign({}, controller, {
        controller: `${controller.controller}#update`,
      });
      routes[`delete ${scope}${route}/:_id`] = Object.assign({}, controller, {
        controller: `${controller.controller}#destroy`,
      });
      delete routes[key];
    } else {
      routes[key] = controller;
    }
  }

  for (const key in routes) {
    const [verb, route, opts] = parseRoute(key, routes[key]);
    const { roles, controller } = opts;

    if (controllers.hasOwnProperty(controller)) {
      register(verb, route, routes[key], controllers[controller], roles);
      register(
        verb,
        `/_data${route}`,
        routes[key],
        controllers[controller],
        roles
      );
      log.info(
        `${key} => ${controller}: registered ${(roles && 'with roles') || ''}`
      );
    } else {
      register(verb, route, routes[key]);
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

function register(verb, route, opts, fn, roles) {
  if (typeof fn === 'function') {
    if (roles) {
      henri.router[verb](
        route,
        async function(req, res, next) {
          if (req.params._id && req.params._id.includes('favicon.')) {
            return res.status(404).send();
          }
          if (
            req.isAuthenticated() &&
            req.user &&
            (await req.user.hasRole(roles))
          ) {
            return next();
          }
          return res.redirect('/login');
        },
        fn
      );
    } else {
      henri.router[verb](route, fn);
    }
  } else {
    henri.router[verb](route, (req, res) =>
      res.status(501).send({ msg: 'Not implemented' })
    );
  }
  const name = `${verb} ${route}`;
  henri._routes[name] = Object.assign(opts, {
    active: typeof fn === 'function',
  });
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

const parseRoute = (key, args) => {
  let controller = args;
  const routeKey = key.split(' ');
  let verb = routeKey.length > 1 ? routeKey[0].toLowerCase() : 'get';
  let route = routeKey.length > 1 ? routeKey[1] : key;
  if (typeof controller === 'string') {
    controller = { controller: controller };
  }
  if (!verbs.includes(verb)) {
    verb = 'get';
    log.warn(`the verb used in ${key} is unknown. using GET instead.`);
  }
  return [verb, route, controller];
};

const verbs = [
  'checkout',
  'copy',
  'delete',
  'get',
  'head',
  'lock',
  'merge',
  'mkactivity',
  'mkcol',
  'move',
  'm-search',
  'notify',
  'options',
  'patch',
  'post',
  'purge',
  'put',
  'report',
  'search',
  'subscribe',
  'trace',
  'unlock',
  'unsubscribe',
  'resources',
  'crud',
];

async function reload() {
  await init(true);
  log.warn('routes reloaded');
}

henri.addLoader(reload);

module.exports = init();

log.info('router module loaded.');
