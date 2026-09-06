const BaseModule = require('./base/module');

const path = require('path');
const fs = require('fs');
const debug = require('debug')('henri:router');
const { check } = require('./base/arguments');
const { loopbackOnly, negotiate: answer } = require('./base/http');
const runtime = require('./base/runtime');
const { fail } = require('./base/errors');
const { respond, userConfig } = require('./base/auth');
const {
  collection,
  collectionLinks,
  halGuard,
  resource,
  resourceLinks,
} = require('./base/hateoas');
const { publish } = require('./base/references');
const { engine: graphqlEngine } = require('./base/graphql');
const { jsonTypes, noStore, versionGuard } = require('./base/headers');
const { idempotency } = require('./base/idempotency');
const { limiter, shutdown } = require('./base/rate-limit');
const openapi = require('./base/openapi');
const { table } = require('./base/routes');
const flash = require('./base/flash');
const { implicit, track } = require('./base/hooks');
const { needsRecord } = require('./base/policies');

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
    this.needs = ['config', 'controllers', 'server', 'user'];
    this.after = ['mailers', 'view'];
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

    this.routes = table(this.rawRoutes, {
      onOverride: ({ route, previous, controller, declaredBy, by }) =>
        this.henri.pen.warn(
          'router',
          `${route} is declared twice: "${declaredBy}" gives it to ${previous},`,
          `"${by}" overrides it with ${controller}`
        ),
    });

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
      // The OpenAPI description of what this application exposes, from the
      // same table. It is introspection, like the two above: development
      // only and from this machine only, because it names every route, the
      // roles that guard it and the policy behind it. An application that
      // wants to publish it commits the file `henri openapi --out` writes
      this.handler.get('/_openapi.json', local, (req, res) =>
        res.json(this.describe())
      );

      // Mailer previews: rendered with the sample data declared next to the
      // mailers, never delivered (see 2.mailers.js)
      if (this.henri.mailers && this.henri.mailers.previewable) {
        this.handler.use('/_mailers', local, this.henri.mailers.previews());
      }
    }

    // What a booted application answers about itself: the last errors, the
    // logs, the routes it really registered and a read-only look at the
    // stores, for `henri mcp` and the agents behind it. Never in production,
    // never from another machine and never from a browser (base/runtime.js)
    if (!this.henri.isProduction) {
      this.handler.use(runtime.PATH, loopbackOnly(), runtime(this.henri));
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
   * The OpenAPI 3.1 description of what this application exposes, built
   * from the table this router registered, the model files and the
   * configuration (`base/openapi.js`). `henri openapi` builds the same
   * document from the files, without booting.
   *
   * @returns {object} the document
   * @memberof Router
   */
  describe() {
    const { config, controllers, model, policies } = this.henri;
    const actions = {};
    let info = {};

    for (const route of Object.values(this.routes)) {
      actions[route.controller] =
        typeof controllers.get(route.controller) === 'function';
    }

    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(this.henri.cwd(), 'package.json'), 'utf8')
      );

      info = {
        description: pkg.description,
        title: pkg.name,
        version: pkg.version,
      };
    } catch (error) {
      debug('no readable package.json: the description keeps its defaults');
    }

    return openapi.build({
      actions,
      config,
      info,
      models: (model && model.models) || [],
      policies: policies ? policies.names() : null,
      routes: Object.values(this.routes),
    });
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
    // What the action declared it accepts (see base/params-schema.js), then
    // the `before` hooks of the controller, then the action wrapped so that
    // returning without answering renders its page (see base/hooks.js)
    const checks = this.checks(controller);
    const hooks = this.hooks(controller);
    const handler = implicit(action, controllerName, controllerAction);

    const helper = `${controllerAction}_${controllerName}_path`;
    // The guards, in the order a request meets them: the role decides
    // whether this kind of person may reach the endpoint at all, the policy
    // whether this person may take this action (see policyGuard)
    const guards = [];

    if (roles) {
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

      for (const role of roles) {
        if (typeof this._roles[role] === 'undefined') {
          this._roles[role] = {};
        }

        this._roles[role][helper] = { method: verb, roles, route };
      }

      guards.push(this.roleGuard(roles, name));
    } else {
      if (typeof this._roles['guest'] === 'undefined') {
        this._roles['guest'] = {};
      }

      this._roles['guest'][helper] = { method: verb, roles, route };
    }

    if (opts && opts.policy) {
      guards.push(
        this.policyGuard({
          action: controllerAction,
          controller: controllerName,
          name,
          policy: opts.policy,
        })
      );
    }

    return this.handler[verb](
      route,
      ...before,
      ...guards,
      ...after,
      ...checks,
      ...hooks,
      handler
    );
  }

  /**
   * Middleware refusing a route to a user the policy says no to.
   *
   * It composes with the role guard rather than replacing it: the role
   * decides who may reach the endpoint, the policy who may act on the
   * record, and a route may declare both. `policy: true` uses the policy
   * named after the controller (`proposals` -> `app/policies/proposal.js`),
   * a string names another one.
   *
   * There is a limit to what a gate can decide, and it is worth being
   * precise about: the record is not loaded yet. So the gate answers the
   * questions that have no record -- `index`, `new`, `create`, and any rule
   * that declares no record parameter -- and, for the rest, records what
   * the route asked for so `res.resource()` enforces it on the way out and
   * `config.policies.verify` reports an action that answered without ever
   * asking (see `verify`).
   *
   * A missing policy or a missing rule refuses, like everywhere else.
   *
   * @param {object} route `{ action, controller, name, policy }`
   * @returns {function} express middleware
   * @memberof Router
   */
  policyGuard({ action, controller, name, policy }) {
    const wanted = policy === true ? controller : policy;

    return async (req, res, next) => {
      const { policies } = this.henri;

      try {
        const target = policies.resolve(wanted);
        const user =
          (typeof req.isAuthenticated === 'function' &&
            req.isAuthenticated() &&
            req.user) ||
          null;

        if (!target) {
          policies.once(
            `route:${name}`,
            name,
            `asks for the "${wanted}" policy, which does not exist: refused`,
            `henri generate policy ${wanted}`
          );

          return this.refuse(
            req,
            res,
            policies.refusal(user, action, null, {})
          );
        }

        const rule = policies.rule(target, action);

        if (rule && needsRecord(rule)) {
          // Undecidable here: remembered so the answer is checked
          req._policy = { action, name: target, route: name };
          this.verify(req, res, name);

          return next();
        }

        if (await policies.can(user, action, null, { policy: target, req })) {
          return next();
        }

        debug('denied %s: %s#%s said no', name, target, action);

        return this.refuse(
          req,
          res,
          policies.refusal(user, action, null, { policy: target })
        );
      } catch (error) {
        return next(error);
      }
    };
  }

  /**
   * Answers a refusal: the negotiated status for a signed-in user, the
   * login page (or a 401) for an anonymous one
   *
   * @param {Express.Request} req the request
   * @param {Express.Response} res the response
   * @param {PolicyError} error the refusal
   * @returns {*} the response
   * @memberof Router
   */
  refuse(req, res, error) {
    this.henri.pen.warn('policies', 'denied', req.method, req.path);

    if (error.redirect) {
      return respond(res, {
        html: () => res.redirect(error.redirect),
        json: () => res.boom.unauthorized(error.message),
      });
    }

    return answer(res, error.status, error.message);
  }

  /**
   * Reports a route that declared a policy and answered without ever asking
   * it.
   *
   * The gate could not decide (the rule needs the record, which only the
   * action has), so the action is the one that has to authorize. When it
   * answers successfully without having asked, the route is unguarded and
   * nobody would know: this is the line that says so, once per route.
   * `config.policies.verify: false` turns it off.
   *
   * @param {Express.Request} req the request
   * @param {Express.Response} res the response
   * @param {string} name the route name
   * @returns {void}
   * @memberof Router
   */
  verify(req, res, name) {
    const { policies } = this.henri;

    if (!policies.settings.verify) {
      return;
    }

    res.on('finish', () => {
      if (req._policyAsked.has(req._policy.action) || res.statusCode >= 400) {
        return;
      }

      policies.once(
        `verify:${name}`,
        name,
        `declares a policy its action never asked: ${req._policy.name}#${req._policy.action} decided nothing`,
        'call req.authorize(action, record) once the record is loaded'
      );
    });
  }

  /**
   * The parameter check of a controller action, as middlewares
   *
   * It runs once the route is allowed and right before the `before` hooks:
   * a request that may not reach the action is never told what is wrong
   * with its parameters, and a hook that loads a record already sees the
   * coerced value. An action that declared nothing gets nothing.
   *
   * @param {string} controller the controller (`tasks#create`)
   * @returns {Array<function>} express middlewares
   * @memberof Router
   */
  checks(controller) {
    const { controllers } = this.henri;

    if (!controllers || typeof controllers.checks !== 'function') {
      return [];
    }

    const found = controllers.checks(controller);

    if (found.length > 0) {
      debug('%s checks its parameters', controller);
    }

    return found;
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
      policy: opts.policy || null,
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
   * The options a request-scoped policy question carries: the request
   * itself, and what the route is about when the caller named nothing
   *
   * @param {Express.Request} req the request
   * @param {Express.Response} res the response
   * @param {(object|string)} [options={}] what the caller passed
   * @returns {object} the options
   * @memberof Router
   */
  policyOptions(req, res, options = {}) {
    const info = res.locals.route || {};
    const given = typeof options === 'string' ? { policy: options } : options;

    return Object.assign(
      { req, type: info.controller || null },
      info.policy && info.policy !== true ? { policy: info.policy } : {},
      given
    );
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
   * @param {object} [extras={}] `data` and/or a `graphql` query, and the
   *   `include` of the personal fields this page is allowed to carry
   * @returns {Promise<object>} the view options
   * @memberof Router
   */
  async viewOptions(
    req,
    res,
    { data = {}, graphql = null, include = [] } = {}
  ) {
    let payload = data;
    let errors = null;

    if (graphql) {
      // Never undefined and never silent: a page built from a query without
      // @usehenri/graphql fails the request and says what to install
      const result = await graphqlEngine(
        this.henri,
        'this render is built from a graphql query'
      ).run(graphql, undefined, { req, res });

      payload = (result && result.data) || result || data;
      errors = result && result.errors;
    }

    // The read half of the access trail, for the pages: the same entry the
    // JSON answers get, one per model the payload carries (base/trail.js)
    this.henri.trail && (await this.henri.trail.seen(req, payload));

    // Read once per request: rendering a page consumes the messages
    const messages = flash.consume(req);
    const allowed = this.pathForRoles(req.user);

    const opts = {
      csrf: req.csrfToken || null,
      // The last gate on the way to a page: a record carrying a public
      // identifier leaves its primary key here and the foreign keys that
      // name another row leave as that row's public identifier (see
      // base/references.js), and then a field marked
      // `personal: { expose: false }` leaves the payload altogether unless
      // this render asked for it (see base/privacy.js)
      data: this.henri.privacy
        ? this.henri.privacy.strip(await publish(this.henri, payload), include)
        : await publish(this.henri, payload),
      // A handler that refused a form and redirected leaves its errors in the
      // flash (`req.flash('errors', { email: 'is required' })`), which is how
      // post/redirect/get reaches the page: they arrive where a rendered
      // error would, so a page reads `errors` whichever way it was answered
      errors: errors || flash.bag(messages.errors),
      flash: messages,
      localUrl: this.henri.server.url,
      // Filtered twice: by the roles, then by the policies that can answer
      // without a record. A page that cannot link where the reader may not
      // go is what stops the leak (see 3.policies.js)
      paths: this.henri.policies
        ? await this.henri.policies.paths(req.user || null, allowed, { req })
        : allowed,
      query: req.query,
      user: this.publicUser(req.user),
    };

    // The nonce of this response, for the view engines and for a template
    // writing an inline script of its own. Absent unless `csp.nonce` is on:
    // a key that is always there and usually null is what makes a page
    // stamp a nonce nothing enforces
    if (res.locals && res.locals.cspNonce) {
      opts.nonce = res.locals.cspNonce;
    }

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
      const exposed = {
        csrf: req.csrfToken || null,
        localUrl: this.henri.server.url,
        paths: this._roles['guest'],
        user: this.publicUser(req.user),
      };

      // `query` is read when the page is built, not now: an action that
      // declared what it accepts has had those values coerced since
      // (base/params-schema.js), and the page reads the same request
      // everything else does
      Object.defineProperty(exposed, 'query', {
        configurable: true,
        enumerable: true,
        get: () => req.query,
      });

      // Only with `csp.nonce` on: the key is absent otherwise, so an
      // application that did not ask for one never reads a null and takes it
      // for a nonce (see base/headers.js)
      if (res.locals.cspNonce) {
        exposed.nonce = res.locals.cspNonce;
      }

      req._henri = flash.expose(req, exposed);

      res.render = async (route, extras = {}) => {
        check('res.render', [route, extras]);

        let { data = {}, graphql = null } = extras;
        const include = Array.isArray(extras.include) ? extras.include : [];

        if (
          typeof extras.data !== 'undefined' &&
          typeof extras.graphql !== 'undefined'
        ) {
          // The query wins and the data is discarded, so asking for both is
          // a page rendered with something other than what it was given
          throw fail(
            'HENRI_ARGUMENT_INVALID',
            'res.render(options) takes data or graphql, not both: the query answers the page and the data would be thrown away'
          );
        }

        if (
          Object.keys(extras).length > 0 &&
          typeof extras.data === 'undefined' &&
          typeof extras.graphql === 'undefined' &&
          typeof extras.include === 'undefined'
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

        const opts = await this.viewOptions(req, res, {
          data,
          graphql,
          include,
        });

        return this.negotiate(req, res, {
          html: () => this.henri.view.engine.render(req, res, route, opts),
          json: () => this.renderJson(req, res, opts),
        });
      };

      // The actions this request asked the policy about. It is what tells
      // an action that decided from one that forgot, and `res.resource()`
      // trusts it: the controller has the record, a presenter's output may
      // not carry what the rule reads (see base/hateoas.js)
      req._policyAsked = new Set();

      // The one way to ask, with the user of this request already filled
      // in (see 3.policies.js). Asking is also what tells the verify check
      // that the action did not forget
      req.can = (action, record = null, options = {}) => {
        req._policyAsked.add(action);

        return this.henri.policies.can(
          req.user || null,
          action,
          record,
          this.policyOptions(req, res, options)
        );
      };

      req.authorize = (action, record = null, options = {}) => {
        req._policyAsked.add(action);

        return this.henri.policies.authorize(
          req.user || null,
          action,
          record,
          this.policyOptions(req, res, options)
        );
      };

      req.scope = (name, context = {}) =>
        this.henri.policies.scope(
          req.user || null,
          name || this.policyOptions(req, res, {}).type,
          Object.assign({ req }, context)
        );

      // HAL answers for the JSON api (see base/hateoas.js)
      res.resource = (record, options) =>
        resource(this.henri, req, res, record, options);
      res.collection = (records, options) =>
        collection(this.henri, req, res, records, options);
      res.negotiate = (handlers) => {
        check('res.negotiate', [handlers]);

        if (
          typeof handlers.html !== 'function' &&
          typeof handlers.json !== 'function'
        ) {
          const error = fail(
            'HENRI_ARGUMENT_INVALID',
            'res.negotiate(handlers) must hold an html handler, a json handler, or both, and it holds neither'
          );

          // Without this it answered 406, which blames the Accept header of
          // a client for a mistake in the controller
          error.hint =
            'res.negotiate({ html: () => res.render(...), json: () => res.resource(...) })';

          throw error;
        }

        return this.negotiate(req, res, handlers);
      };

      res.hbs = async (route, extras = {}) => {
        // The same arguments as res.render, and a body of its own
        check('res.render', [route, extras], 'res.hbs');

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
