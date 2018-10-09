const BaseModule = require('./base/module');

const path = require('path');
const url = require('url');
const bounce = require('bounce');

/**
 * Router module
 *
 * @class Router
 * @extends {BaseModule}
 */
class Router extends BaseModule {
  /**
   * Creates an instance of Router.
   * @memberof Router
   */
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 5;
    this.name = 'router';
    this.henri = null;

    this._middlewares = [];
    this._paths = {};
    this._roles = {};

    this.stats = { failed: 0, good: 0 };
    this.handler = null;
    this.activeRoutes = new Map();
    this.rawRoutes = {};
    this.routes = {};

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @param {boolean} [reload=false] Are we reloading?
   * @returns {!string} The name of the module
   * @memberof Router
   */
  async init(reload = false) {
    const { pen, controllers } = this.henri;

    this.handler = this.henri.server.express.Router();

    this.middlewares();

    try {
      // eslint-disable-next-line global-require
      this.rawRoutes = require(path.resolve('./app/routes'));
    } catch (error) {
      this.rawRoutes = {};
      pen.warn('router', 'unable to load routes from filesystem');
    }

    for (const key in this.rawRoutes) {
      if (typeof this.rawRoutes[key] !== 'undefined') {
        const result = new Route(key, this.rawRoutes[key]);

        this.routes = Object.assign({}, this.routes, result);
      }
    }

    for (let key of Object.keys(this.routes)) {
      if (typeof this.routes[key] !== 'undefined') {
        const { verb, route, controller, roles } = this.routes[key];

        if (typeof controllers.get(controller) !== 'undefined') {
          this.register({
            controller,
            opts: this.routes[key],
            roles,
            route,
            verb,
          });
          const [name, action] = controller.split('#');

          pen.info(
            'router',
            key,
            controller,
            `success${(roles && ' with roles') || ''}`,
            `${action}_${name}_path`
          );

          this.stats.good++;
        } else {
          this.register({ opts: this.routes[key], route, verb });
          pen.error('router', key, controller, 'unknown');
          this.stats.failed++;
        }
      }
    }

    /* istanbul ignore next */
    if (process.env.NODE_ENV !== 'production') {
      this.handler.get('/_routes', (req, res) => res.json(this.routes));
      this.handler.get('/_controllers', (req, res) =>
        res.json(this.henri.controllers.all())
      );
    }

    await this.startView(reload);

    return this.name;
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Router
   */
  async reload() {
    this._paths = {};
    this._roles = {};
    this.stats = { failed: 0, good: 0 };
    this.handler = null;
    this.activeRoutes = new Map();
    this.rawRoutes = {};
    this.routes = {};

    try {
      await this.init(true);
    } catch (error) {
      bounce.rethrow(error, 'system');
    }

    return this.name;
  }

  /**
   * Start the view (or restart)
   *
   * @param {boolean} [reload=false] Are we reloading?
   * @returns {boolean} success?
   * @memberof Router
   */
  async startView(reload = false) {
    return new Promise(async (resolve, reject) => {
      const { pen } = this.henri;

      /* istanbul ignore next */
      if (this.henri.view && !reload) {
        try {
          await this.henri.view.engine.prepare();
          this.henri.view.engine.fallback(this.handler);
          await this.henri.server.start();
        } catch (error) {
          bounce.rethrow(error, 'system');
          pen.fatal('router', error);

          return reject(error);
        }
      } else {
        if (this.henri.view) {
          this.henri.view && this.henri.view.engine.fallback(this.handler);
          try {
            !reload && (await this.henri.server.start());
          } catch (error) {
            bounce.rethrow(error, 'system');
          }
        } else {
          pen.warn('router', 'unable to register view fallback route');
        }
      }

      return resolve(true);
    });
  }

  /**
   * Register a route
   *
   * @param {object} { verb: string, route: string, opts: object, controller: function, roles:Array }
   * @returns {(boolean|controller)} False or a controller
   * @memberof Router
   */
  register({ verb, route, opts, controller, roles }) {
    const action = this.henri.controllers.get(controller);
    const fn = typeof action === 'function';
    const name = `${verb} ${route}`;
    let controllerName = '';
    let controllerAction = '';

    this.activeRoutes.set(name, Object.assign({}, opts, { active: fn }));

    // Ideally, populate with information from path-to-regexp for better
    // ...parameters matching client-side...
    if (fn && !/data/.test(route)) {
      [controllerName, controllerAction] = controller.split('#');

      this._paths[`${controllerAction}_${controllerName}_path`] = {
        method: verb,
        roles,
        route,
      };
    }

    if (fn === false) {
      if (!this.henri.isProduction) {
        this.henri.pen.error('router', verb, route, controller);

        return this.handler[verb](route, (req, res) =>
          res.boom.notImplemented('Controller not found', {
            method: verb,
            route,
          })
        );
      } else {
        return false;
      }
    }

    if (!roles) {
      if (typeof this._roles['guest'] === 'undefined') {
        this._roles['guest'] = {};
      }

      this._roles['guest'][`${controllerAction}_${controllerName}_path`] = {
        method: verb,
        roles,
        route,
      };

      return this.handler[verb](route, action);
    }

    if (!Array.isArray(roles)) {
      roles = [roles];
    }

    roles.map(role => {
      if (typeof this._roles[role] === 'undefined') {
        this._roles[role] = {};
      }

      this._roles[role][`${controllerAction}_${controllerName}_path`] = {
        method: verb,
        roles,
        route,
      };
    });

    this.handler[verb](
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
          henri.pen.info('router', 'got through');

          return next();
        } else {
          const reas = req.user && (await req.user.hasRole(roles));

          henri.pen.warn('router', 'denied');
          console.log(reas, req.user, roles);

          return res.redirect('/login');
        }
      },
      action
    );
  }

  /**
   * Get the paths based on users' roles
   *
   * @param {*} user The user or null
   * @returns {object} List of paths
   * @memberof Router
   */
  pathForRoles(user) {
    let paths = {};

    paths = Object.assign({}, this._roles['guest']);

    if (user && user.roles) {
      let roles = Array.isArray(user.roles) ? user.roles : [user.roles];

      roles.forEach(role => {
        typeof this._roles[role] === 'object' &&
          Object.assign(paths, this._roles[role]);
      });
    }

    return paths;
  }

  /**
   * Add middlewares to express
   *
   * @returns {boolean} success?
   * @memberof Router
   */
  middlewares() {
    if (this.henri._middlewares.length > 0) {
      this.henri._middlewares.map(func => func(this.handler));
    }

    this.handler.use((req, res, cb) => {
      res.locals._req = req;
      req._henri = {
        localUrl: this.henri.server.url,
        paths: this._roles['guest'],
        query: req.query,
        user: req.user || {},
      };

      delete res.render;

      res.render = async (route, extras = {}) => {
        let { data = {}, graphql = null } = extras;

        const allowedPaths = this.pathForRoles(req.user);

        if (
          Object.keys(extras).length > 0 &&
          typeof extras.data === 'undefined' &&
          typeof extras.graphql === 'undefined'
        ) {
          this.henri.isDev &&
            this.henri.pen.warn(
              'view',
              route,
              `res.render() second argument missing 'data' or 'graphql' key`
            );

          if (Object.values(extras).every(val => typeof val === 'string')) {
            graphql = extras;
            this.henri.isDev &&
              this.henri.pen.warn(
                'view',
                route,
                'assuming graphql as second argument'
              );
          }

          if (Object.values(extras).every(val => typeof val === 'object')) {
            data = extras;
            this.henri.isDev &&
              this.henri.pen.warn(
                'view',
                route,
                `assuming orm object${Object.keys(extras).length > 1 &&
                  's'} as second argument`
              );
          }
        }

        data = (graphql && (await this.henri.graphql.run(graphql))) || data;

        let opts = {
          data: (graphql && data.data) || data,
          errors: graphql && data.errors,
          localUrl: this.henri.server.url,
          paths: allowedPaths,
          query: req.query,
          user: req.user || {},
        };

        if (this.henri.graphql) {
          opts.graphql = {
            endpoint: (henri.graphql.active && henri.graphql.endpoint) || false,
            query: graphql || false,
          };
        }

        return res.format({
          default: () => this.henri.view.engine.render(req, res, route, opts),
          html: () => this.henri.view.engine.render(req, res, route, opts),
          json: () => res.json(opts),
        });
      };

      delete res.hbs;
      res.hbs = async (route, extras = {}) => {
        let { data = {}, graphql = null } = extras;

        data = (graphql && (await this.henri.graphql.run(graphql))) || data;

        const allowedPaths = this.pathForRoles(req.user);

        let opts = {
          data: (graphql && data.data) || data,
          errors: graphql && data.errors,
          localUrl: this.henri.server.url,
          paths: allowedPaths,
          query: req.query,
          user: req.user || {},
        };

        if (this.henri.graphql) {
          opts.graphql = {
            endpoint: (henri.graphql.active && henri.graphql.endpoint) || false,
            query: graphql || false,
          };
        }

        return res.format({
          default: () =>
            this.henri.view.hbs.instance.render(req, res, route, opts),
          html: () =>
            this.henri.view.hbs.instance.render(req, res, route, opts),
          json: () => res.json(opts),
        });
      };
      cb();
    });

    return true;
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {(string|boolean)} Module name or false
   * @memberof Router
   */
  static async stop() {
    return false;
  }
}

/**
 * Route helper class
 *
 * @class Route
 */
class Route {
  /**
   * Creates an instance of Route.
   *
   * @param {string} key verb + route (ex: get /paintings)
   * @param {object} opts route options (scope, roles, etc)
   * @memberof Route
   */
  constructor(key, opts) {
    this.verb = '';
    this.route = '';
    this.opts = typeof opts === 'string' ? { controller: opts } : opts;
    this.result = {};
    this.scope = this.opts.scope ? `/${this.opts.scope}/` : '/';
    this.parse(key, opts);
    this.process();

    return this.result;
  }

  /**
   * Parse the route
   *
   * @param {string} key verb + route (ex: get /paintings)
   * @returns {void}
   * @memberof Route
   */
  parse(key) {
    const routeKey = key.split(' ');
    const verb = routeKey.length > 1 ? routeKey[0].toLowerCase() : 'get';

    this.route = routeKey.length > 1 ? routeKey[1] : key;
    this.verb = !verbs.includes(verb) ? 'get' : verb;
    this.opts = Object.assign(this.opts, { route: this.route, verb });
  }

  /**
   * Process the route information taken in the constructor
   *
   * @returns {void}
   * @memberof Route
   */
  process() {
    if (this.verb === 'resources' || this.verb === 'crud') {
      const route = trim(this.route, '/');

      this.buildResource(`get`, `${this.scope}${route}`, 'index');
      this.buildResource(`post`, `${this.scope}${route}`, 'create');
      this.buildResource(`patch`, `${this.scope}${route}/:id`, 'update');
      this.buildResource(`put`, `${this.scope}${route}/:id`, 'update');
      this.buildResource(`delete`, `${this.scope}${route}/:id`, 'destroy');

      if (this.verb === 'resources') {
        this.buildResource(`get`, `${this.scope}${route}/:id/edit`, 'edit');
        this.buildResource(`get`, `${this.scope}${route}/new`, 'new');
        this.buildResource(`get`, `${this.scope}${route}/:id`, 'show');
      }
    } else {
      this.buildResource(this.verb, this.route);
    }
  }

  /**
   * Builds a resource (multiple routes for a resource)
   *
   * @param {string} verb http verb (get, post, put, etc.)
   * @param {string} urlPath the key (url)
   * @param {string} method action (create,edit, update, destroy, etc.)
   * @return {void}
   * @memberof Route
   */
  buildResource(verb, urlPath, method) {
    if (this.opts.omit && this.opts.omit.includes(method)) {
      return;
    }
    const rebuilt = url.resolve(urlPath, '');

    this.result[`${verb} ${rebuilt}`] = this.buildOpts(verb, rebuilt, method);
  }

  /**
   * Builds the route object that will be used finally
   *
   * @param {string} verb http verb (get, post, put, etc.)
   * @param {string} urlPath the key (url)
   * @param {string} method action (create,edit, update, destroy, etc.)
   * @returns {object} a router-readable object
   * @memberof Route
   */
  buildOpts(verb, urlPath, method = null) {
    const { opts } = this;

    return Object.assign({}, opts, {
      controller: method ? `${opts.controller}#${method}` : opts.controller,
      route: urlPath,
      verb: verb,
    });
  }
}

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

/**
 * Trims a string
 *
 * @param {string} str string to be trimmed
 * @param {string} mask unwanted char
 * @returns {string} trimmed string
 */
function trim(str, mask) {
  while (~mask.indexOf(str[0])) {
    str = str.slice(1);
  }
  while (~mask.indexOf(str[str.length - 1])) {
    str = str.slice(0, -1);
  }

  return str;
}

module.exports = Router;
