const path = require('path');
const Route = require('./route');

class RouteHandler {
  constructor() {
    this.routes = {};
    this.expended = {};
    this.load();
    this.parse();
  }

  load() {
    const { config, log } = henri;
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
    this.routes = routes;
  }

  parse() {
    let routes = {};
    for (const key in this.routes) {
      const result = new Route(key, this.routes[key]);
      routes = Object.assign({}, routes, result);
    }
    this.expended = routes;
  }

  prepare() {
    const { controllers, log } = henri;
    const routes = this.expended;
    for (let key of Object.keys(routes)) {
      const { verb, route, controller, roles } = routes[key];

      if (typeof controllers[controller] !== 'undefined') {
        this.register({ verb, route, opts: routes[key], controller, roles });
        this.register({
          verb,
          route: `/_data${route}`,
          opts: routes[key],
          controller,
          roles,
        });
        log.info(
          `${key} => ${controller}: registered ${(roles && 'with roles') || ''}`
        );
      } else {
        this.register({ verb, route, opts: routes[key] });
        log.error(`${key} => ${controller}: unknown controller for route `);
      }
    }
  }

  register({ verb, route, opts, controller, roles }) {
    const fn = typeof henri.controllers[controller] === 'function';
    const name = `${verb} ${route}`;
    henri._routes[name] = Object.assign({}, opts, { active: fn });

    // Ideally, populate with information from path-to-regexp for better
    // parameters matching client-side...
    if (fn && !/data/.test(route)) {
      const [name, action] = controller.split('#');
      henri._paths[`${action}_${name}_path`] = { route, method: verb };
    }

    if (fn === false) {
      return henri.router[verb](route, (req, res) =>
        res.status(501).send({ msg: 'Not implemented' })
      );
    }
    this.addToExpress({ verb, route, controller, roles });
  }

  addToExpress({ verb, route, controller, roles }) {
    if (!roles) {
      return henri.router[verb](route, henri.controllers[controller]);
    }

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
  }
}

module.exports = RouteHandler;
