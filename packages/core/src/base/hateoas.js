const {
  EXTERNAL_ID,
  hasExternalId,
  stripInternalIds,
} = require('./external-id');
const { jsonType, noStore } = require('./headers');
const { linkHeader, pageLinks, paginate } = require('./pagination');

/**
 * HAL (Hypertext Application Language) representations for the JSON API.
 *
 * A resource is its public fields plus `_links` built from the router's path
 * helpers (`show_tasks_path`, `edit_tasks_path`, ...), filtered by the roles
 * of the current user so a client only sees the links it may follow. The
 * identifier in the payload and in every href is the record's `externalId`;
 * the primary key stays on the server (see base/external-id.js):
 *
 * ```json
 * {
 *   "_links": {
 *     "self": { "href": "/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11" },
 *     "collection": { "href": "/tasks" },
 *     "edit": { "href": "/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11/edit" },
 *     "update": { "href": "/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11", "method": "PATCH" },
 *     "destroy": { "href": "/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11", "method": "DELETE" }
 *   },
 *   "externalId": "0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11",
 *   "name": "Write the docs"
 * }
 * ```
 *
 * A collection embeds its items under `_embedded.<type>` with the links
 * around the page (`self`, `first`, `prev`, `next`, `last`), `create` and
 * `new` when allowed, `count`, `page`, `perPage` and `total`.
 */

/**
 * The public id of a record as a string: its `externalId` when it has one
 * (every model, unless it opted out), the primary key otherwise. This is
 * what every href of `_links` is made of, so a url never carries the
 * sequential id of a row.
 *
 * @param {*} record a model instance or a plain object
 * @returns {?string} the id or null
 */
function identify(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  if (hasExternalId(record)) {
    return record[EXTERNAL_ID];
  }

  const id =
    typeof record.id !== 'undefined' && record.id !== null
      ? record.id
      : record._id;

  return id === null || typeof id === 'undefined' ? null : String(id);
}

/**
 * A record as a plain object with its public identifier
 *
 * Model instances are serialized through their own `toJSON()` (Mongoose,
 * Sequelize, Drizzle) so the schema options (hidden fields, virtuals) apply.
 *
 * @param {*} record a model instance or a plain object
 * @returns {object} a copy
 */
function toPlain(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  let plain = record;

  if (typeof record.toJSON === 'function') {
    plain = record.toJSON();
  } else if (typeof record.toObject === 'function') {
    plain = record.toObject();
  }

  // A record carrying a public identifier answers with it and nothing else:
  // the primary key is dropped here and at every depth (a `.lean()` query or
  // a hand-built object never went through a model's own toJSON)
  plain = Object.assign({}, stripInternalIds(plain));

  if (hasExternalId(plain)) {
    return plain;
  }

  const id = identify(plain);

  if (id !== null && (typeof plain.id === 'undefined' || plain.id === null)) {
    plain.id = id;
  }

  return plain;
}

/**
 * Fills the parameters of a route template (`/tasks/:id`)
 *
 * @param {string} template the route
 * @param {object} [params={}] values by parameter name
 * @returns {string} the href
 */
function fill(template, params = {}) {
  return String(template).replace(
    /:([A-Za-z_][A-Za-z0-9_]*)\??/g,
    (match, name) => {
      const value = params[name];

      return value === null || typeof value === 'undefined'
        ? match
        : encodeURIComponent(String(value));
    }
  );
}

/**
 * A path helper of a type (`show_tasks_path`) among the allowed paths
 *
 * @param {object} paths allowed paths (see Router.pathForRoles)
 * @param {string} type the controller name
 * @param {string} action the action
 * @returns {?object} `{ route, method, roles }` or null
 */
function helper(paths, type, action) {
  return (paths && paths[`${action}_${type}_path`]) || null;
}

/**
 * Turns `{ rel: '/href' }` or `{ rel: { href } }` into HAL links
 *
 * @param {object} [links={}] custom links
 * @returns {object} HAL links
 */
function normalizeLinks(links = {}) {
  const result = {};

  for (const rel of Object.keys(links || {})) {
    const value = links[rel];

    if (typeof value === 'string') {
      result[rel] = { href: value };
    } else if (value && typeof value === 'object') {
      result[rel] = value;
    }
  }

  return result;
}

/**
 * The links of one resource: `self`, `collection`, `edit`, `update`, `destroy`
 *
 * `self` comes from the `show` route, or the `update`/`destroy` route of a
 * crud resource (which has no show page).
 *
 * @param {object} options options
 * @param {string} options.type the controller name (`tasks`)
 * @param {?string} [options.id=null] the record id
 * @param {object} [options.params={}] route parameters of the request
 * @param {object} [options.paths={}] allowed paths (Router.pathForRoles)
 * @returns {object} HAL links
 */
function resourceLinks({ type, id = null, params = {}, paths = {} }) {
  const links = {};
  const values = Object.assign({}, params, id === null ? {} : { id });
  const self =
    helper(paths, type, 'show') ||
    helper(paths, type, 'update') ||
    helper(paths, type, 'destroy');
  const index = helper(paths, type, 'index');

  if (id !== null && self) {
    links.self = { href: fill(self.route, values) };
  }

  if (index) {
    links.collection = { href: fill(index.route, params) };
  }

  if (id !== null) {
    const edit = helper(paths, type, 'edit');
    const update = helper(paths, type, 'update');
    const destroy = helper(paths, type, 'destroy');

    if (edit) {
      links.edit = { href: fill(edit.route, values) };
    }
    if (update) {
      links.update = { href: fill(update.route, values), method: 'PATCH' };
    }
    if (destroy) {
      links.destroy = { href: fill(destroy.route, values), method: 'DELETE' };
    }
  }

  return links;
}

/**
 * The links of a collection: `create` (POST) and `new` (the form)
 *
 * @param {object} options options
 * @param {string} options.type the controller name
 * @param {object} [options.params={}] route parameters of the request
 * @param {object} [options.paths={}] allowed paths
 * @returns {object} HAL links
 */
function collectionLinks({ type, params = {}, paths = {} }) {
  const links = {};
  const create = helper(paths, type, 'create');
  const form = helper(paths, type, 'new');

  if (create) {
    links.create = { href: fill(create.route, params), method: 'POST' };
  }
  if (form) {
    links.new = { href: fill(form.route, params) };
  }

  return links;
}

/**
 * The type (controller name) of the route being handled
 *
 * @param {Express.Response} res the response
 * @returns {?string} the controller name or null
 */
function routeType(res) {
  const route = res && res.locals && res.locals.route;

  return route && typeof route.controller === 'string'
    ? route.controller
    : null;
}

/**
 * Sends a JSON body with the negotiated media type and cache headers
 *
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @param {object} body the body
 * @param {number} status the status
 * @returns {Express.Response} the response
 */
function send(req, res, body, status) {
  res.type(jsonType(req));
  noStore(req, res);

  return res.status(status).json(body);
}

/**
 * `res.resource(record, options)`: one HAL resource
 *
 * @param {Henri} henri the henri instance
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @param {*} record a model instance or a plain object
 * @param {object} [options={}] options
 * @param {string} [options.type] controller name (defaults to the route's)
 * @param {object} [options.links] extra links (`{ rel: href }` or HAL links)
 * @param {number} [options.status=200] status (201 also sets `Location`)
 * @returns {Express.Response} the response
 * @throws {TypeError} when the record is not an object or the type is unknown
 */
function resource(henri, req, res, record, { type, links, status = 200 } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(
      'res.resource() needs a record (a model instance or a plain object); use res.collection() for lists'
    );
  }

  const kind = type || routeType(res);

  if (!kind) {
    throw new TypeError(
      'res.resource() needs a type outside of a route: res.resource(record, { type: "tasks" })'
    );
  }

  const plain = toPlain(record);
  const paths = henri.router.pathForRoles(req.user);
  const merged = Object.assign(
    resourceLinks({
      id: identify(plain),
      params: req.params,
      paths,
      type: kind,
    }),
    normalizeLinks(links)
  );

  if (!merged.self && req.method === 'GET') {
    merged.self = { href: req.originalUrl || req.url };
  }

  if (status === 201 && merged.self) {
    res.set('Location', merged.self.href);
  }

  const body = Object.assign({ _links: null }, plain, { _links: merged });

  return send(req, res, body, status);
}

/**
 * `res.collection(records, options)`: a HAL collection
 *
 * Pagination links and numbers appear when the controller paginated
 * (`req.pagination()` was called or `page`/`perPage`/`total` are given);
 * an unpaginated list only gets `self`, `count` and `total`.
 *
 * @param {Henri} henri the henri instance
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @param {Array} records model instances or plain objects
 * @param {object} [options={}] options
 * @param {string} [options.type] controller name (defaults to the route's)
 * @param {number} [options.page] current page
 * @param {number} [options.perPage] page size
 * @param {number} [options.total] total number of records
 * @param {object} [options.links] extra links
 * @param {number} [options.status=200] status
 * @returns {Express.Response} the response
 * @throws {TypeError} when records is not an array or the type is unknown
 */
function collection(
  henri,
  req,
  res,
  records,
  { type, page, perPage, total, links, status = 200 } = {}
) {
  if (!Array.isArray(records)) {
    throw new TypeError(
      'res.collection() needs an array of records; use res.resource() for one record'
    );
  }

  const kind = type || routeType(res);

  if (!kind) {
    throw new TypeError(
      'res.collection() needs a type outside of a route: res.collection(records, { type: "tasks" })'
    );
  }

  const paths = henri.router.pathForRoles(req.user);
  const items = records.map((record) => {
    const plain = toPlain(record);

    return Object.assign({ _links: null }, plain, {
      _links: resourceLinks({
        id: identify(plain),
        params: req.params,
        paths,
        type: kind,
      }),
    });
  });
  const url = req.originalUrl || req.url || '/';
  const count = items.length;
  const known = Number.isFinite(total) ? total : null;
  const paginated =
    Boolean(req._pagination) ||
    [page, perPage, total].some((value) => typeof value !== 'undefined');
  const body = {
    _embedded: { [kind.split('/').pop()]: items },
    _links: { self: { href: url } },
    count,
  };

  if (paginated) {
    const paging =
      req._pagination || paginate(req, henri.api.settings.pagination);
    const current = {
      page: Number.isFinite(page) ? page : paging.page,
      perPage: Number.isFinite(perPage) ? perPage : paging.perPage,
    };
    const pages = pageLinks(url, {
      count,
      page: current.page,
      perPage: current.perPage,
      total: known,
    });
    const header = linkHeader(pages);

    body._links = normalizeLinks(pages);
    body.page = current.page;
    body.perPage = current.perPage;

    if (header) {
      res.set('Link', header);
    }
  }

  if (known !== null) {
    body.total = known;
    res.set('X-Total-Count', String(known));
  } else if (!paginated) {
    body.total = count;
    res.set('X-Total-Count', String(count));
  }

  Object.assign(
    body._links,
    collectionLinks({ params: req.params, paths, type: kind }),
    normalizeLinks(links)
  );

  return send(req, res, body, status);
}

/**
 * Is this answer an Inertia page object rather than an API answer?
 *
 * The Inertia view engine answers a visit with `{ component, props, url,
 * version }`, a protocol of its own with no room for `_links`, and marks it
 * with the `X-Inertia` header. Such an answer is a rendered page, not JSON
 * the API guard below has anything to say about.
 *
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @returns {boolean} true for an Inertia page object
 */
function isInertiaPage(req, res) {
  return Boolean(
    (typeof res.getHeader === 'function' && res.getHeader('X-Inertia')) ||
    (typeof req.get === 'function' && req.get('x-inertia'))
  );
}

/**
 * Per-route middleware enforcing HAL on the routes expanded from
 * `resources`/`crud`: a successful JSON answer without `_links` is reported
 * once per route (`pen.warn`), and refused with a 500 when
 * `config.api.strict` is true. Inertia page objects are not API answers and
 * are left alone.
 *
 * @param {Henri} henri the henri instance
 * @param {string} name the route name (`get /tasks`)
 * @returns {function} middleware
 */
function halGuard(henri, name) {
  return (req, res, next) => {
    const json = res.json.bind(res);

    res.json = (body) => {
      const status = res.statusCode || 200;
      const isObject = body !== null && typeof body === 'object';
      const missing =
        status < 400 &&
        !isInertiaPage(req, res) &&
        (!isObject || Array.isArray(body) || !('_links' in body));

      if (!missing) {
        return json(body);
      }

      const { api, pen } = henri;
      const message = `${name} answered JSON without _links: use res.resource() or res.collection()`;

      if (!api.warned.has(name)) {
        api.warned.add(name);
        pen.warn('api', message);
      }

      if (api.settings.strict !== true) {
        return json(body);
      }

      pen.error('api', name, 'refused by config.api.strict');

      return res.status(500).json({
        error: 'Internal Server Error',
        message: `${message} (config.api.strict)`,
        statusCode: 500,
      });
    };

    next();
  };
}

module.exports = {
  collection,
  collectionLinks,
  fill,
  halGuard,
  identify,
  isInertiaPage,
  normalizeLinks,
  resource,
  resourceLinks,
  routeType,
  toPlain,
};
