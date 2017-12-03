const path = require('path');

const { express, log, view } = henri;

async function init(reload = false) {
  const { config, controllers } = henri;
  henri.router = express.Router();

  middlewares();
  let routes = {};

  /* istanbul ignore next */
  try {
    routes = require(config.has('location.routes')
      ? path.resolve(config.get('location.routes'))
      : path.resolve('./app/routes'));
  } catch (e) {
    log.warn('unable to load routes from filesystem');
  }
  /* istanbul ignore next */
  if (config.has('routes') && Object.keys(config.get('routes')).length > 1) {
    routes = Object.assign({}, routes, config.get('routes'));
  }

  for (const key in routes) {
    const [verb, route, controller] = parseRoute(key, routes[key]);
    routes[key] = controller;

    if (verb === 'resources' || verb === 'crud') {
      controller.resources = route;
      routes = buildResources({ verb, routes, controller, route, key });
    }
  }

  for (const key in routes) {
    const [verb, route, opts] = parseRoute(key, routes[key]);
    const { roles, controller } = opts;

    if (controllers.hasOwnProperty(controller)) {
      register(verb, route, routes[key], controller, roles);
      register(verb, `/_data${route}`, routes[key], controller, roles);
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

const buildResources = ({ verb, routes, controller, route, key }) => {
  const scope = controller.scope ? `/${controller.scope}/` : '/';

  routes[`get ${scope}${route}`] = buildRoute(controller, 'index');
  routes[`get ${scope}${route}/:id/edit`] = buildRoute(controller, 'edit');
  routes[`patch ${scope}${route}/:id`] = buildRoute(controller, 'update');
  routes[`put ${scope}${route}/:id`] = buildRoute(controller, 'update');
  routes[`delete ${scope}${route}/:id`] = buildRoute(controller, 'destroy');

  if (verb === 'resources') {
    routes[`get ${scope}${route}/new`] = buildRoute(controller, 'new');
    routes[`post ${scope}${route}`] = buildRoute(controller, 'create');
    routes[`get ${scope}${route}/:id`] = buildRoute(controller, 'show');
  }

  delete routes[key];
  return routes;
};

const buildRoute = (controller, method) =>
  Object.assign({}, controller, {
    controller: `${controller.controller}#${method}`,
  });

function register(verb, route, opts, controller, roles) {
  if (typeof henri.controllers[controller] === 'function') {
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
        henri.controllers[controller]
      );
    } else {
      henri.router[verb](route, henri.controllers[controller]);
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

  // Ideally, populate with information from path-to-regexp for better
  // parameters matching client-side...
  if (typeof fn === 'function' && !/data/.test(route)) {
    const [name, action] = controller.split('#');
    henri._paths[`${action}_${name}_path`] = { route, method: verb };
  }
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
        paths: henri._paths,
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
