/**
 * Expansion of the `config/routes.js` keys into concrete routes.
 *
 * One entry of the file becomes zero, one or many routes:
 *
 * ```js
 * module.exports = {
 *   root: 'main#home',                       // GET /
 *   'get /about': 'main#about',
 *   'resources tasks': {
 *     only: ['index', 'show', 'create'],     // or except: [...]
 *     collection: { 'get search': 'search' },
 *     member: { 'post archive': 'archive' },
 *     nested: { 'resources comments': 'comments' },
 *   },
 *   'namespace admin': { 'resources users': { roles: ['admin'] } },
 * };
 * ```
 *
 * Every route carries `{ verb, route, controller, path, ...options }` where
 * `path` is the name of the helper, always `<action>_<controller>_path`.
 * `@usehenri/cli` uses the same code so that `henri routes`, `henri doctor`
 * and the generators read the table without booting the server.
 */
const { fail } = require('./errors');
const posix = require('path').posix;

/** The http verbs a route key may use */
const VERBS = [
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
];

/** The keywords a route key may use in place of a verb */
const KEYWORDS = ['crud', 'namespace', 'resources', 'root'];

/** Everything a key may start with and still name its own verb */
const KEYS = [...VERBS, 'crud', 'resources'];

/** The seven actions of `resources`, in registration order */
const RESOURCE_ACTIONS = [
  'index',
  'create',
  'update',
  'destroy',
  'edit',
  'new',
  'show',
];

/** The four actions of `crud` (no page, no form) */
const CRUD_ACTIONS = ['index', 'create', 'update', 'destroy'];

/** Options shaping a resource: they never reach a route object */
const STRUCTURAL = [
  'collection',
  'except',
  'member',
  'nested',
  'omit',
  'only',
  'param',
];

/**
 * Trims a character from both ends of a string
 *
 * @param {string} str string to be trimmed
 * @param {string} mask unwanted char
 * @returns {string} trimmed string
 */
function trim(str, mask) {
  let out = String(str);

  while (out.length > 0 && mask.includes(out[0])) {
    out = out.slice(1);
  }
  while (out.length > 0 && mask.includes(out[out.length - 1])) {
    out = out.slice(0, -1);
  }

  return out;
}

/**
 * Normalizes an url path: one leading slash, no double slash, no trailing one
 *
 * @param {string} urlPath the path
 * @returns {string} the normalized path
 */
function normalize(urlPath) {
  const clean = posix.normalize(`/${String(urlPath)}`.replace(/\/{2,}/g, '/'));

  return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean;
}

/**
 * An option that may be a string or an array of strings, as an array
 *
 * @param {*} value the option
 * @returns {?Array<string>} the strings, or null when the option is absent
 */
function list(value) {
  if (typeof value === 'undefined' || value === null) {
    return null;
  }

  return []
    .concat(value)
    .filter((entry) => typeof entry === 'string' && entry.length > 0);
}

/**
 * The singular of a resource name, for the parameter of a nested resource
 * (`tasks` -> `task_id`, `categories` -> `category_id`)
 *
 * @param {string} word the plural
 * @returns {string} the singular (unchanged when it does not look plural)
 */
function singularize(word) {
  const name = String(word);

  if (/ies$/i.test(name)) {
    return name.replace(/ies$/i, 'y');
  }

  if (/(x|ch|sh|ss|s)es$/i.test(name)) {
    return name.replace(/es$/i, '');
  }

  if (/(?<![su])s$/i.test(name)) {
    return name.replace(/s$/i, '');
  }

  return name;
}

/**
 * The controller name (without the action) a route entry points to
 *
 * @param {string|object} value the value of a config/routes.js entry
 * @returns {?string} the controller name or null
 */
function controllerOf(value) {
  const controller =
    typeof value === 'string' ? value : value && value.controller;

  return typeof controller === 'string' ? controller.split('#')[0] : null;
}

/**
 * Splits a route key into what it means
 *
 * @param {string} key the key (`get /tasks`, `resources tasks`, `root`)
 * @returns {{kind: string, name: string, verb: string}} the parsed key
 */
function parseKey(key) {
  const parts = String(key).trim().split(/\s+/);
  const head = (parts[0] || '').toLowerCase();

  if (head === 'root' && parts.length === 1) {
    return { kind: 'root', name: '/', verb: 'get' };
  }

  if (KEYWORDS.includes(head) && parts.length > 1) {
    return { kind: head, name: parts.slice(1).join(' '), verb: head };
  }

  if (parts.length > 1) {
    return {
      kind: 'route',
      name: parts[1],
      verb: KEYS.includes(head) ? head : 'get',
    };
  }

  return { kind: 'route', name: parts[0] || '/', verb: 'get' };
}

/**
 * The route options, without the keys that only shape the expansion
 *
 * @param {object} opts the entry options
 * @returns {object} the options every built route carries
 */
function routeOptions(opts) {
  const out = {};

  for (const key of Object.keys(opts)) {
    if (!STRUCTURAL.includes(key) && key !== 'controller') {
      out[key] = opts[key];
    }
  }

  return out;
}

/** A controller name: a path of segments, no spaces, no surprises */
const NAME = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/i;

/** An action name */
const ACTION = /^[a-z_][a-z0-9_]*$/i;

/**
 * Refuse a controller or action that will not resolve to a file.
 *
 * A trailing space in `{ controller: 'ship ' }` used to travel all the way to
 * the loader and surface as a missing controller, which sends the reader
 * looking for a file that is right there.
 *
 * @param {string} controller what the route named, for the message
 * @param {string} name the controller part
 * @param {?string} action the action part, when the route named one
 * @param {string} route the path, for the message
 * @returns {void}
 * @throws {Error} when either part is not a usable name
 */
function assertName(controller, name, action, route) {
  const quoted = JSON.stringify(controller);

  if (!NAME.test(name)) {
    throw fail(
      'HENRI_ROUTE_INVALID_CONTROLLER',
      `route "${route}" points at ${quoted}, which is not a controller name: ` +
        'use letters, digits, dashes and underscores, with "/" for a ' +
        'directory. A stray space is the usual cause.'
    );
  }

  if (typeof action === 'string' && !ACTION.test(action)) {
    throw fail(
      'HENRI_ROUTE_INVALID_ACTION',
      `route "${route}" points at ${quoted}, which is not an action name: ` +
        'use letters, digits and underscores after the "#".'
    );
  }
}

/**
 * Builds one route object
 *
 * @param {object} spec `{ verb, route, controller, options, resource }`
 * @returns {?object} the route, or null without a controller
 */
function build({ verb, route, controller, options = {}, resource = false }) {
  if (typeof controller !== 'string' || controller.length === 0) {
    return null;
  }

  const [name, action] = controller.split('#');

  assertName(controller, name, action, route);
  const entry = Object.assign({}, options, {
    controller,
    path: `${action}_${name}_path`,
    route: normalize(route),
    verb,
  });

  if (resource) {
    entry.resource = true;
  }

  return entry;
}

/**
 * Prefixes a controller with the namespace it is declared in
 *
 * @param {*} controller the controller (`tasks#index`)
 * @param {string} namespace the namespace (`admin`)
 * @returns {*} the namespaced controller
 */
function namespaced(controller, namespace) {
  if (typeof controller !== 'string' || !namespace) {
    return controller;
  }

  return controller.startsWith(`${namespace}/`)
    ? controller
    : `${namespace}/${controller}`;
}

/**
 * The `[key, value]` pairs of a `member`/`collection` option
 *
 * @param {*} spec an array of keys or an object of key/value
 * @returns {Array<Array>} the pairs
 */
function pairs(spec) {
  if (Array.isArray(spec)) {
    return spec
      .filter((entry) => typeof entry === 'string')
      .map((entry) => [entry, null]);
  }

  if (spec && typeof spec === 'object') {
    return Object.entries(spec);
  }

  return [];
}

/**
 * Expands the `member` and `collection` routes of a resource
 *
 * @param {Array<object>} out where the routes are pushed
 * @param {*} spec the option (array of keys or object)
 * @param {object} context `{ base, controller, namespace, options, member }`
 * @returns {void}
 */
function extras(out, spec, { base, controller, namespace, options, member }) {
  for (const [key, value] of pairs(spec)) {
    const parts = String(key).trim().split(/\s+/);
    const head = (parts[0] || '').toLowerCase();
    const hasVerb = parts.length > 1 && VERBS.includes(head);
    const segment = trim(
      hasVerb ? parts.slice(1).join(' ') : String(key).trim(),
      '/'
    );
    let target = value;
    let extra = {};

    if (target && typeof target === 'object') {
      extra = routeOptions(target);
      target = target.controller || target.action || null;
    }

    const name =
      typeof target === 'string' && target.length > 0
        ? target
        : segment
            .split('/')
            .pop()
            .replace(/[^A-Za-z0-9_$]/g, '_');
    const full = name.includes('#')
      ? namespaced(name, namespace)
      : `${controller}#${name}`;

    out.push(
      build({
        controller: full,
        options: Object.assign({}, options, extra),
        route: member ? `${base}/:id/${segment}` : `${base}/${segment}`,
        verb: hasVerb ? head : 'get',
      })
    );
  }
}

/**
 * Expands one entry into `out`, recursing through namespaces and nested
 * resources
 *
 * @param {Array<object>} out where the routes are pushed
 * @param {string} key the entry key
 * @param {string|object} value the entry value
 * @param {object} [context={}] `{ namespace, prefix }`
 * @returns {void}
 */
function collect(out, key, value, context = {}) {
  const { namespace = '', prefix = '' } = context;
  const parsed = parseKey(key);
  const opts =
    typeof value === 'string'
      ? { controller: value }
      : Object.assign({}, value || {});

  if (parsed.kind === 'namespace') {
    const name = trim(parsed.name, '/');
    // A namespace holds routes, nothing else
    const children =
      value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    for (const [child, entry] of Object.entries(children)) {
      if (typeof entry === 'undefined' || entry === null) {
        continue;
      }

      collect(out, child, entry, {
        namespace: namespace ? `${namespace}/${name}` : name,
        prefix: normalize(`${prefix}/${name}`),
      });
    }

    return;
  }

  const options = routeOptions(opts);

  if (parsed.kind === 'root') {
    out.push(
      build({
        controller: namespaced(opts.controller, namespace),
        options,
        route: `${prefix}/`,
        verb: 'get',
      })
    );

    return;
  }

  if (parsed.kind !== 'resources' && parsed.kind !== 'crud') {
    out.push(
      build({
        controller: namespaced(opts.controller, namespace),
        options,
        route: `${prefix}${parsed.name}`,
        verb: parsed.verb,
      })
    );

    return;
  }

  const name = trim(parsed.name, '/');
  const scope = opts.scope ? `/${trim(String(opts.scope), '/')}` : '';
  const base = normalize(`${prefix}${scope}/${name}`);
  const controller = namespaced(opts.controller || name, namespace);
  const wanted = parsed.kind === 'resources' ? RESOURCE_ACTIONS : CRUD_ACTIONS;
  const only = list(opts.only);
  const except = [...(list(opts.except) || []), ...(list(opts.omit) || [])];
  const allowed = (action) =>
    wanted.includes(action) &&
    (only === null || only.includes(action)) &&
    !except.includes(action);
  const one = (verb, route, action) =>
    allowed(action) &&
    out.push(
      build({
        controller: `${controller}#${action}`,
        options,
        resource: true,
        route,
        verb,
      })
    );
  const sides = { base, controller, namespace, options };

  one('get', base, 'index');
  one('post', base, 'create');
  extras(out, opts.collection, Object.assign({ member: false }, sides));
  one('patch', `${base}/:id`, 'update');
  one('put', `${base}/:id`, 'update');
  one('delete', `${base}/:id`, 'destroy');
  extras(out, opts.member, Object.assign({ member: true }, sides));
  one('get', `${base}/:id/edit`, 'edit');
  one('get', `${base}/new`, 'new');
  one('get', `${base}/:id`, 'show');

  const param = opts.param || `${singularize(name.split('/').pop())}_id`;

  for (const [child, entry] of Object.entries(opts.nested || {})) {
    if (typeof entry === 'undefined' || entry === null) {
      continue;
    }

    collect(out, child, entry, { namespace, prefix: `${base}/:${param}` });
  }
}

/**
 * Expand one config/routes.js entry
 *
 * @param {string} key verb + route (ex: get /paintings, resources tasks)
 * @param {string|object} value controller ("main#home") or options
 * @param {object} [context={}] `{ namespace, prefix }` (used when recursing)
 * @returns {Array<object>} the routes
 */
function expandEntry(key, value, context = {}) {
  const out = [];

  collect(out, key, value, context);

  return out.filter(Boolean);
}

/**
 * Expand every entry of a raw routes object, in file order
 *
 * @param {object} [rawRoutes={}] the content of config/routes.js
 * @returns {Array<object>} the routes
 */
function expand(rawRoutes = {}, { onOverride = null } = {}) {
  const seen = new Map();
  const from = new Map();

  for (const [key, value] of Object.entries(rawRoutes || {})) {
    if (typeof value === 'undefined' || value === null) {
      continue;
    }

    for (const route of expandEntry(key, value)) {
      const id = `${route.verb} ${route.route}`;
      const previous = seen.get(id);

      // Later keys win, and keep the position of the first one. Say so when
      // the winner is a different controller: a resources entry quietly
      // shadowing a route written above it is hard to see in a routes file.
      if (previous && previous.controller !== route.controller && onOverride) {
        onOverride({
          by: key,
          controller: route.controller,
          declaredBy: from.get(id),
          previous: previous.controller,
          route: id,
        });
      }

      from.set(id, key);
      seen.set(id, route);
    }
  }

  return Array.from(seen.values());
}

/**
 * The expanded routes keyed by `verb path`, what `henri.router.routes` holds
 *
 * @param {object} [rawRoutes={}] the content of config/routes.js
 * @returns {object} the table
 */
function table(rawRoutes = {}, options = {}) {
  const out = {};

  for (const route of expand(rawRoutes, options)) {
    out[`${route.verb} ${route.route}`] = route;
  }

  return out;
}

module.exports = {
  CRUD_ACTIONS,
  KEYWORDS,
  RESOURCE_ACTIONS,
  VERBS,
  controllerOf,
  expand,
  expandEntry,
  normalize,
  singularize,
  table,
};
