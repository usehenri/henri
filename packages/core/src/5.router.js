const BaseModule = require('./base/module');

const path = require('path');
const fs = require('fs');
const debug = require('debug')('henri:router');
const { loopbackOnly } = require('./base/http');
const { respond, userConfig } = require('./base/auth');
const {
  collection,
  collectionLinks,
  halGuard,
  resource,
  resourceLinks,
} = require('./base/hateoas');
const { stripInternalIds } = require('./base/external-id');
const { jsonTypes, noStore, versionGuard } = require('./base/headers');
const { idempotency } = require('./base/idempotency');
const { limiter, shutdown } = require('./base/rate-limit');
const { table } = require('./base/routes');
const flash = require('./base/flash');
const { implicit, track } = require('./base/hooks');

/** Verbs of the routes that change something (idempotency applies) */
const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

/**
 * Tells if a user owns every given role
 *
 * @param {object} user the user (model instance)
 * @param {Array<string>} roles the roles
 * @returns {Promise<boolean>} allowed or not
 */
async function hasRoles(user, roles) {
  if (typeof user.hasRole === 'function') {
    return Boolean(await user.hasRole(roles));
  }

  const owned = Array.isArray(user.roles)
    ? user.roles
    : [user.roles].filter(Boolean);

  return roles.every((role) => owned.includes(role));
}

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
    this._results = { loaded: [], unknown: [] };
    this._stats = { failed: 0, good: 0 };
    this._limiters = [];

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
      this.rawRoutes = require(path.resolve('./config/routes'));
    } catch (error) {
      this.rawRoutes = {};

      if (fs.existsSync(path.resolve('./app/routes.js'))) {
        pen.warn('router', 'you should move your routes to `config/routes.js`');

        this.rawRoutes = require(path.resolve('./app/routes'));
      } else {
        pen.warn('router', 'unable to load routes from filesystem');
      }
    }

    this.routes = table(this.rawRoutes);

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

          this._results.loaded.push([
            'router',
            key,
            controller,
            `success${(roles && ' with roles') || ''}`,
            `${action}_${name}_path`,
          ]);

          this._stats.good++;
        } else {
          this.register({ opts: this.routes[key], route, verb });

          this._results.unknown.push(['router', key, controller, 'unknown']);

          this._stats.failed++;
        }
      }
    }

    pen.info(
      'router',
      `${this._stats.good} route${
        this._stats.good > 0 ? 's' : ''
      } loaded successfully`,
      'press R to see a list'
    );
    pen.error(
      'router',
      `${this._stats.failed} route${this._stats.failed > 0 ? 's' : ''} failed`,
      'press U to print a list'
    );

    // Development-only introspection, and only from this machine
    if (this.henri.isDev) {
      const local = loopbackOnly();

      this.handler.get('/_routes', local, (req, res) => res.json(this.routes));
      this.handler.get('/_controllers', local, (req, res) =>
        res.json(this.henri.controllers.all())
      );

      // Mailer previews: rendered with the sample data declared next to the
      // mailers, never delivered (see 2.mailers.js)
      if (this.henri.mailers && this.henri.mailers.previewable) {
        this.handler.use('/_mailers', local, this.henri.mailers.previews());
      }
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
    this._results = { loaded: [], unknown: [] };
    this._stats = { failed: 0, good: 0 };
    this._limiters.splice(0).forEach(shutdown);

    this.handler = null;
    this.activeRoutes = new Map();
    this.rawRoutes = {};
    this.routes = {};

    await this.init(true);

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
    const { pen, view, server } = this.henri;

    if (!view) {
      pen.warn('router', 'unable to register view fallback route');

      return true;
    }

    if (reload) {
      view.engine.fallback(this.handler);

      return true;
    }

    try {
      await view.engine.prepare();
      view.engine.fallback(this.handler);
      await server.start();
    } catch (error) {
      pen.fatal('router', error);
      throw error;
    }

    return true;
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
    if (fn) {
      [controllerName, controllerAction] = controller.split('#');

      this._paths[`${controllerAction}_${controllerName}_path`] = {
        method: verb,
        roles,
        route,
      };
    }

    if (fn === false) {
      if (!this.henri.isProduction) {
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

    const { after, before } = this.pipeline({
      action: controllerAction,
      controller: controllerName,
      name,
      opts,
      roles,
      route,
      verb,
    });
    // `before` hooks of the controller, then the action wrapped so that
    // returning without answering renders its page (see base/hooks.js)
    const hooks = this.hooks(controller);
    const handler = implicit(action, controllerName, controllerAction);

    if (!roles) {
      if (typeof this._roles['guest'] === 'undefined') {
        this._roles['guest'] = {};
      }

      this._roles['guest'][`${controllerAction}_${controllerName}_path`] = {
        method: verb,
        roles,
        route,
      };

      return this.handler[verb](route, ...before, ...after, ...hooks, handler);
    }

    if (!Array.isArray(roles)) {
      roles = [roles];
    }

    if (!this.henri._user) {
      this.henri.pen.warn(
        'router',
        name,
        'requires roles but no user model is loaded; requests will be denied'
      );
    }

    roles.map((role) => {
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
      ...before,
      this.roleGuard(roles, name),
      ...after,
      ...hooks,
      handler
    );
  }

  /**
   * The `before` hooks of a controller action, as middlewares
   *
   * They run once the route is allowed (behind the role guard and the
   * idempotency replay), right before the action.
   *
   * @param {string} controller the controller (`tasks#show`)
   * @returns {Array<function>} express middlewares
   * @memberof Router
   */
  hooks(controller) {
    const { controllers } = this.henri;

    if (!controllers || typeof controllers.hooks !== 'function') {
      return [];
    }

    const found = controllers.hooks(controller);

    if (found.length > 0) {
      debug('%s runs %d before hook(s)', controller, found.length);
    }

    return found;
  }

  /**
   * The middlewares around a controller action, from the route options
   * (`version`, `rateLimit`, `idempotent`) and the route kind: `before`
   * runs ahead of the role guard, `after` behind it (so that denied requests
   * consume no idempotency key).
   *
   * - `version: 'v1'`: clients asking another version through the Accept
   *   header get a 406, `req.apiVersion` defaults to the route's
   * - `rateLimit: { windowMs, max }`: a limit of its own for the route
   * - `idempotent: false`: opts a mutating route out of `Idempotency-Key`
   *   (on by default for every POST, PUT, PATCH and DELETE route)
   * - routes expanded from `resources`/`crud` are HAL-guarded
   *
   * @param {object} route the route (`{ action, controller, name, opts, roles, route, verb }`)
   * @returns {{before: Array<function>, after: Array<function>}} middlewares
   * @memberof Router
   */
  pipeline({ action, controller, name, opts = {}, roles, route, verb }) {
    const { api } = this.henri;
    const settings = (api && api.settings) || {};
    const info = Object.freeze({
      action,
      controller,
      name,
      resource: Boolean(opts.resource),
      roles: roles ? [].concat(roles) : null,
      route,
      verb,
      version: opts.version || null,
    });
    const before = [
      (req, res, next) => {
        res.locals.route = info;
        next();
      },
    ];
    const after = [];

    if (opts.version) {
      before.push(versionGuard(opts.version));
    }

    if (
      opts.rateLimit &&
      typeof opts.rateLimit === 'object' &&
      settings.rateLimit
    ) {
      const guard = limiter(
        this.henri,
        Object.assign({ name }, opts.rateLimit, {
          store: api.rateLimitStore(name),
        })
      );

      this._limiters.push(guard);
      before.push(guard);
    }

    if (
      MUTATING.has(verb) &&
      settings.idempotency &&
      opts.idempotent !== false
    ) {
      after.push(idempotency(this.henri, { ttl: settings.idempotency.ttl }));
    }

    if (opts.resource) {
      after.push(halGuard(this.henri, name));
    }

    return { after, before };
  }

  /**
   * Middleware denying a route to users missing the given roles
   *
   * Anonymous requests get a 401, authenticated users missing a role a 403
   * (JSON); browsers asking for HTML are redirected to
   * `config.user.loginPath` (default `/login`).
   *
   * @param {Array<string>} roles required roles
   * @param {string} name route name (for the logs)
   * @returns {function} express middleware
   * @memberof Router
   */
  roleGuard(roles, name) {
    return async (req, res, next) => {
      try {
        const user =
          (typeof req.isAuthenticated === 'function' &&
            req.isAuthenticated() &&
            req.user) ||
          null;

        if (user && (await hasRoles(user, roles))) {
          return next();
        }

        this.henri.pen.warn(
          'router',
          'denied',
          name,
          user ? 'missing role' : 'not authenticated'
        );
        debug('denied %s: user %o needs %o', name, user && user.roles, roles);

        const { loginPath } = userConfig(this.henri.config);

        return respond(res, {
          html: () => res.redirect(loginPath),
          json: () =>
            user
              ? res.boom.forbidden('Missing role', { roles })
              : res.boom.unauthorized('Authentication required'),
        });
      } catch (error) {
        return next(error);
      }
    };
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

      roles.forEach((role) => {
        typeof this._roles[role] === 'object' &&
          Object.assign(paths, this._roles[role]);
      });
    }

    return paths;
  }

  /**
   * The representation of the current user that can leave the server
   *
   * @param {object} user `req.user` (model instance) or null
   * @returns {?object} `henri.user.publicUser(user)` or null
   * @memberof Router
   */
  publicUser(user) {
    const { user: users } = this.henri;

    if (!user || !users || typeof users.publicUser !== 'function') {
      return null;
    }

    return users.publicUser(user);
  }

  /**
   * Builds the options given to the view engines (and returned as JSON)
   *
   * @param {Express.Request} req the request
   * @param {Express.Response} res the response
   * @param {object} [extras={}] `data` and/or a `graphql` query
   * @returns {Promise<object>} the view options
   * @memberof Router
   */
  async viewOptions(req, res, { data = {}, graphql = null } = {}) {
    let payload = data;
    let errors = null;

    if (graphql) {
      const result = await this.henri.graphql.run(graphql, undefined, {
        req,
        res,
      });

      payload = (result && result.data) || result || data;
      errors = result && result.errors;
    }

    const opts = {
      csrf: req.csrfToken || null,
      // The last gate on the way to a page: a record carrying a public
      // identifier leaves its primary key here (see base/external-id.js)
      data: stripInternalIds(payload),
      errors,
      // Read once per request: rendering a page consumes the messages
      flash: flash.consume(req),
      localUrl: this.henri.server.url,
      paths: this.pathForRoles(req.user),
      query: req.query,
      user: this.publicUser(req.user),
    };

    if (this.henri.graphql) {
      opts.graphql = {
        endpoint:
          (this.henri.graphql.active && this.henri.graphql.endpoint) || false,
        query: graphql || false,
      };
    }

    return opts;
  }

  /**
   * Content negotiation for the pages: `html` for browsers (and `* / *`),
   * `json` for API clients asking for `application/json`,
   * `application/hal+json` or the versioned `application/vnd.henri.v1+json`
   *
   * @param {Express.Request} req the request
   * @param {Express.Response} res the response
   * @param {{html: function, json: function}} handlers the handlers (one may be missing)
   * @returns {*} whatever the handler returns
   * @memberof Router
   */
  negotiate(req, res, { html, json } = {}) {
    const handlers = {};

    if (typeof html === 'function') {
      handlers.html = html;
    }

    if (typeof json === 'function') {
      for (const type of jsonTypes(req)) {
        handlers[type] = json;
      }
    }

    handlers.default = typeof html === 'function' ? html : json;

    return res.format(handlers);
  }

  /**
   * The JSON answer of `res.render()`: the view options plus `_links`
   * derived from the route (`self`, and the resource links of the
   * current record or collection, filtered by the roles of the user)
   *
   * @param {Express.Request} req the request
   * @param {Express.Response} res the response
   * @param {object} opts the view options (see viewOptions)
   * @returns {Express.Response} the response
   * @memberof Router
   */
  renderJson(req, res, opts) {
    const info = res.locals.route || {};
    const params = req.params || {};
    const id =
      typeof params.id === 'undefined' || params.id === null ? null : params.id;
    const links = { self: { href: req.originalUrl || req.url } };

    if (info.controller) {
      Object.assign(
        links,
        resourceLinks({ id, params, paths: opts.paths, type: info.controller })
      );

      if (id === null) {
        Object.assign(
          links,
          collectionLinks({ params, paths: opts.paths, type: info.controller })
        );
      }
    }

    noStore(req, res);

    return res.json(Object.assign({}, opts, { _links: links }));
  }

  /**
   * Add middlewares to express
   *
   * @returns {boolean} success?
   * @memberof Router
   */
  middlewares() {
    // `req.flash()` first: the login and logout middlewares below use it too
    this.handler.use(flash());

    if (this.henri._middlewares.length > 0) {
      let middlewaresLoaded = [];

      this.henri._middlewares.map((middle) => {
        middlewaresLoaded.push(middle.name);
        middle.func(this.handler);
      });

      this.henri.pen.info(
        'middleware',
        `${middlewaresLoaded.join('/')}`,
        'loaded'
      );
    }

    this.handler.use((req, res, cb) => {
      res.locals._req = req;
      // `flash` is defined lazily: reading it (the view engine copies
      // `req._henri`) is what consumes the messages, so a request that never
      // renders leaves them in the session for the next one
      req._henri = flash.expose(req, {
        csrf: req.csrfToken || null,
        localUrl: this.henri.server.url,
        paths: this._roles['guest'],
        query: req.query,
        user: this.publicUser(req.user),
      });

      res.render = async (route, extras = {}) => {
        let { data = {}, graphql = null } = extras;

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

          if (Object.values(extras).every((val) => typeof val === 'string')) {
            graphql = extras;
            this.henri.isDev &&
              this.henri.pen.warn(
                'view',
                route,
                'assuming graphql as second argument'
              );
          }

          if (Object.values(extras).every((val) => typeof val === 'object')) {
            data = extras;
            this.henri.isDev &&
              this.henri.pen.warn(
                'view',
                route,
                `assuming orm object${
                  Object.keys(extras).length > 1 && 's'
                } as second argument`
              );
          }
        }

        const opts = await this.viewOptions(req, res, { data, graphql });

        return this.negotiate(req, res, {
          html: () => this.henri.view.engine.render(req, res, route, opts),
          json: () => this.renderJson(req, res, opts),
        });
      };

      // HAL answers for the JSON api (see base/hateoas.js)
      res.resource = (record, options) =>
        resource(this.henri, req, res, record, options);
      res.collection = (records, options) =>
        collection(this.henri, req, res, records, options);
      res.negotiate = (handlers) => this.negotiate(req, res, handlers);

      res.hbs = async (route, extras = {}) => {
        const { data = {}, graphql = null } = extras;
        const opts = await this.viewOptions(req, res, { data, graphql });

        return res.format({
          default: () =>
            this.henri.view.hbs.instance.render(req, res, route, opts),
          html: () =>
            this.henri.view.hbs.instance.render(req, res, route, opts),
          json: () => res.json(opts),
        });
      };

      // Tells an action that answered from one that returned without
      // answering, which is what the implicit render needs
      track(res);

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
module.exports = Router;
