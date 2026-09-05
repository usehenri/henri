/**
 * Expansion of the config/routes.js keys into concrete routes.
 *
 * This mirrors the `Route` helper of @usehenri/core (src/5.router.js), which
 * core does not export. Keep both in sync: the CLI uses this copy so that
 * `henri routes` and the generators can read the table without booting the
 * server.
 */
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
  'resources',
  'crud',
];

/**
 * Trims a character from both ends of a string
 *
 * @param {string} str string to be trimmed
 * @param {string} mask unwanted char
 * @returns {string} trimmed string
 */
const trim = (str, mask) => {
  while (str.length > 0 && mask.includes(str[0])) {
    str = str.slice(1);
  }
  while (str.length > 0 && mask.includes(str[str.length - 1])) {
    str = str.slice(0, -1);
  }

  return str;
};

/**
 * The controller name (without the action) a route key points to
 *
 * @param {string|object} value The value of a config/routes.js entry
 * @returns {string|null} The controller name or null
 */
const controllerOf = (value) => {
  const controller =
    typeof value === 'string' ? value : value && value.controller;

  return typeof controller === 'string' ? controller.split('#')[0] : null;
};

/**
 * Expand one config/routes.js entry
 *
 * @param {string} key verb + route (ex: get /paintings, resources tasks)
 * @param {string|object} value controller ("main#home") or options
 * @returns {Array<object>} The routes ({ verb, route, controller, path, roles })
 */
const expandEntry = (key, value) => {
  const opts = typeof value === 'string' ? { controller: value } : { ...value };
  const parts = key.trim().split(/\s+/);
  const rawVerb = parts.length > 1 ? parts[0].toLowerCase() : 'get';
  const verb = VERBS.includes(rawVerb) ? rawVerb : 'get';
  const route = parts.length > 1 ? parts[1] : key.trim();
  const scope = opts.scope ? `/${opts.scope}/` : '/';
  const results = [];

  const build = (method, urlPath, action = null) => {
    if (opts.omit && opts.omit.includes(action)) {
      return;
    }

    // Same normalization as core's url.resolve(urlPath, ''), without the
    // deprecated legacy url API
    const rebuilt = new URL(urlPath, 'http://henri.local').pathname;
    const controller = action
      ? `${opts.controller}#${action}`
      : opts.controller;
    const [name, act] = String(controller).split('#');

    results.push({
      ...opts,
      controller,
      path: `${act}_${name}_path`,
      route: rebuilt,
      verb: method,
    });
  };

  if (verb === 'resources' || verb === 'crud') {
    const base = `${scope}${trim(route, '/')}`;

    build('get', base, 'index');
    build('post', base, 'create');
    build('patch', `${base}/:id`, 'update');
    build('put', `${base}/:id`, 'update');
    build('delete', `${base}/:id`, 'destroy');

    if (verb === 'resources') {
      build('get', `${base}/:id/edit`, 'edit');
      build('get', `${base}/new`, 'new');
      build('get', `${base}/:id`, 'show');
    }
  } else {
    build(verb, route);
  }

  return results;
};

/**
 * Expand every entry of a raw routes object, in file order
 *
 * @param {object} rawRoutes The content of config/routes.js
 * @returns {Array<object>} The routes ({ verb, route, controller, path, roles })
 */
const expand = (rawRoutes = {}) => {
  const seen = new Map();

  for (const [key, value] of Object.entries(rawRoutes)) {
    if (typeof value === 'undefined' || value === null) {
      continue;
    }

    for (const route of expandEntry(key, value)) {
      // Later keys win, like Object.assign in core
      seen.set(`${route.verb} ${route.route}`, route);
    }
  }

  return Array.from(seen.values());
};

module.exports = { VERBS, controllerOf, expand, expandEntry };
