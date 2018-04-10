const BaseModule = require('./base/module');

const path = require('path');
const url = require('url');

class Router extends BaseModule {
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 4;
    this.name = 'router';
    this.henri = null;

    this._middlewares = [];
    this._paths = {};

    this.stats = { good: 0, failed: 0 };
    this.handler = null;
    this.activeRoutes = new Map();
    this.rawRoutes = {};
    this.routes = {};

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
  }

  async init(reload = false) {
    const { pen, controllers } = this.henri;

    this.handler = this.henri.server.express.Router();

    this.middlewares();

    try {
      this.rawRoutes = require(path.resolve('./app/routes'));
    } catch (e) {
      this.rawRoutes = {};
      pen.warn('router', 'unable to load routes from filesystem');
    }

    for (const key in this.rawRoutes) {
      const result = new Route(key, this.rawRoutes[key]);
      this.routes = Object.assign({}, this.routes, result);
    }

    for (let key of Object.keys(this.routes)) {
      const { verb, route, controller, roles } = this.routes[key];

      if (typeof controllers.get(controller) !== 'undefined') {
        this.register({
          verb,
          route,
          opts: this.routes[key],
          controller,
          roles,
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
        this.register({ verb, route, opts: this.routes[key] });
        pen.error('router', key, controller, 'unknown');
        this.stats.failed++;
      }
    }

    /* istanbul ignore next */
    if (process.env.NODE_ENV !== 'production') {
      this.handler.get('/_routes', (req, res) => res.json(this.routes));
      this.handler.get('/_controllers', (req, res) =>
        res.json(this.henri.controllers.all())
      );
    }

    this.startView(reload);

    return this.name;
  }

  async reload() {
    this._paths = {};
    this.stats = { good: 0, failed: 0 };
    this.handler = null;
    this.activeRoutes = new Map();
    this.rawRoutes = {};
    this.routes = {};

    await this.init(true);
    return this.name;
  }

  async startView(reload = false) {
    const { pen } = this.henri;
    /* istanbul ignore next */
    if (this.henri.view && !reload) {
      try {
        await this.henri.view.engine.prepare();
        this.henri.view.engine.fallback(this.handler);
        this.henri.server.start();
      } catch (error) {
        pen.fatal('router', 'unable to start renderer', error);
      }
    } else {
      if (this.henri.view) {
        this.henri.view && this.henri.view.engine.fallback(this.handler);
        !reload && this.henri.server.start();
      } else {
        pen.warn('router', 'unable to register view fallback route');
      }
    }
  }

  register({ verb, route, opts, controller, roles }) {
    const action = this.henri.controllers.get(controller);

    const fn = typeof action === 'function';

    const name = `${verb} ${route}`;

    this.activeRoutes.set(name, Object.assign({}, opts, { active: fn }));

    // Ideally, populate with information from path-to-regexp for better
    // parameters matching client-side...
    if (fn && !/data/.test(route)) {
      const [name, action] = controller.split('#');
      this._paths[`${action}_${name}_path`] = { route, method: verb };
    }

    if (fn === false) {
      if (!this.henri.isProduction) {
        this.henri.pen.error('router', verb, route, controller);
        return this.handler[verb](route, (req, res) =>
          res.status(501).send({ msg: 'Not implemented', route, method: verb })
        );
      } else {
        return false;
      }
    }

    if (!roles) {
      return this.handler[verb](route, action);
    }

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
          return next();
        }
        return res.redirect('/login');
      },
      action
    );
  }

  middlewares(router) {
    if (this.henri._middlewares.length > 0) {
      this.henri._middlewares.map(func => func(this.handler));
    }

    this.handler.use((req, res, cb) => {
      res.locals._req = req;
      req._henri = {
        paths: this._paths,
        localUrl: this.henri.server.url,
        user: req.user || {},
        query: req.query,
      };
      delete res.render;
      res.render = async (route, extras = {}) => {
        let { data = {}, graphql = null } = extras;

        data = (graphql && (await this.henri.graphql.run(graphql))) || data;

        let opts = {
          data: (graphql && data.data) || data,
          errors: graphql && data.errors,
          paths: this._paths,
          localUrl: this.henri.server.url,
          user: req.user || {},
          query: req.query,
        };

        if (this.henri.graphql) {
          opts.graphql = {
            endpoint: (henri.graphql.active && henri.graphql.endpoint) || false,
            query: graphql || false,
          };
        }

        return res.format({
          html: () => this.henri.view.engine.render(req, res, route, opts),
          json: () => res.json(opts),
          default: () => this.henri.view.engine.render(req, res, route, opts),
        });
      };
      cb();
    });
  }

  stop() {
    return false;
  }
}

class Route {
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

  parse(key, opts) {
    const routeKey = key.split(' ');
    const verb = routeKey.length > 1 ? routeKey[0].toLowerCase() : 'get';
    this.route = routeKey.length > 1 ? routeKey[1] : key;
    this.verb = !verbs.includes(verb) ? 'get' : verb;
    this.opts = Object.assign(this.opts, { route: this.route, verb });
  }

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

  buildResource(verb, key, method) {
    const rebuilt = url.resolve(key, '');
    this.result[`${verb} ${rebuilt}`] = this.buildOpts(verb, rebuilt, method);
  }

  buildOpts(verb, key, method = null) {
    const { opts } = this;
    return Object.assign({}, opts, {
      controller: method ? `${opts.controller}#${method}` : opts.controller,
      route: key,
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

function trim(s, mask) {
  while (~mask.indexOf(s[0])) {
    s = s.slice(1);
  }
  while (~mask.indexOf(s[s.length - 1])) {
    s = s.slice(0, -1);
  }
  return s;
}

module.exports = Router;
