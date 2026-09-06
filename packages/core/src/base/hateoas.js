const { EXTERNAL_ID, hasExternalId } = require('./external-id');
const { publish } = require('./references');
const { stamp } = require('./errors');
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
 *
 * The roles are the first filter and the policies are the second: where the
 * record is in hand -- and here it always is -- `edit`, `update` and
 * `destroy` are asked about that record, and `collection`, `create` and
 * `new` about the collection (see 3.policies.js). `self` is left alone: it
 * names the representation the client is already holding. A model with no
 * policy is not asked about at all.
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
 * Gives a published copy its public identifier back when it has no
 * `externalId` of its own (a model that opted out, a hand-built object)
 *
 * @param {*} plain a published record
 * @returns {*} the record
 */
function withId(plain) {
  if (!plain || typeof plain !== 'object' || hasExternalId(plain)) {
    return plain;
  }

  const id = identify(plain);

  if (id !== null && (typeof plain.id === 'undefined' || plain.id === null)) {
    plain.id = id;
  }

  return plain;
}

/**
 * A record as a plain object with its public identifier
 *
 * Model instances are serialized through their own `toJSON()` (Mongoose,
 * Sequelize, Drizzle) so the schema options (hidden fields, virtuals)
 * apply, the internal ids are dropped at every depth (a `.lean()` query or
 * a hand-built object never went through a model's own toJSON) and the
 * foreign keys leave as the public identifier of the row they name.
 *
 * One call covers one whole answer: `records` is published together so the
 * lookups behind the foreign keys are batched once for the page rather
 * than once per record (see base/references.js).
 *
 * The privacy strip runs after, never before: publishing resolves a foreign
 * key into the public identifier of the row it names, and a field marked
 * `personal: { expose: false }` must not leave carrying whatever it
 * resolved to (see base/privacy.js).
 *
 * @param {Henri} henri the henri instance
 * @param {*} records a model instance, a plain object, or a list of either
 * @param {Array<string>} [include=[]] the personal fields this answer asked
 *   for by name, which the strip keeps
 * @returns {Promise<*>} the copy
 */
async function toPublic(henri, records, include = []) {
  const published = await publish(henri, records);
  // Privacy has the last word: publishing resolves a foreign key into the
  // public identifier of the row it names, and a field the model marked
  // `personal: { expose: false }` must not leave whatever it resolved to
  const kept =
    henri && henri.privacy
      ? henri.privacy.strip(published, include)
      : published;

  if (Array.isArray(kept)) {
    return kept.map((entry) =>
      withId(
        entry && typeof entry === 'object' ? Object.assign({}, entry) : entry
      )
    );
  }

  if (!kept || typeof kept !== 'object') {
    return kept;
  }

  return withId(Object.assign({}, kept));
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
 * What the policy is asked about, for an answer that is not the record
 * itself.
 *
 * A controller that presents its records before sending them hands
 * `res.resource()` a plain object the rules may not be able to read -- the
 * owner column is exactly the kind of thing a presenter drops. `subject`
 * names what to ask about instead: the record, an array parallel to the
 * one being sent, or a function of the item and its index.
 *
 * @param {*} subject the `subject` option (may be undefined)
 * @param {*} item what is being sent
 * @param {number} index its position, for a collection
 * @returns {*} the record the policy is asked about
 */
function subjectOf(subject, item, index = 0) {
  if (typeof subject === 'undefined' || subject === null) {
    return item;
  }

  if (typeof subject === 'function') {
    return subject(item, index);
  }

  return Array.isArray(subject) ? subject[index] : subject;
}

/**
 * The links a policy leaves, or the links themselves when the application
 * has no policies module (a test double, a boot that stopped early)
 *
 * @param {Henri} henri the henri instance
 * @param {*} user the user, or null
 * @param {object} links the HAL links
 * @param {*} record the record they are about (null for a collection)
 * @param {object} options `{ cache, req, type }`
 * @returns {Promise<object>} the links
 */
async function allowed(henri, user, links, record, options) {
  return henri.policies
    ? henri.policies.links(user, links, record, options)
    : links;
}

/**
 * Answers the policy question the route gate could not.
 *
 * A route declaring `policy` whose rule needs the record leaves
 * `req._policy` behind: the record only exists here, so this is where the
 * question is answered. A refusal replaces the body that was about to be
 * sent, and says so through the router rather than throwing -- a controller
 * that did not `return` its `res.resource()` would turn a throw into an
 * unhandled rejection.
 *
 * An action that already asked about this action is trusted and not asked
 * again: it holds the record, and what reaches here may be a presenter's
 * output the rule cannot read. This is the net under an action that forgot,
 * not a second opinion about one that did not.
 *
 * @param {Henri} henri the henri instance
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @param {*} record the record (or the `subject` the caller named)
 * @returns {Promise<boolean>} true when the answer may be sent
 */
async function enforce(henri, req, res, record) {
  const wanted = req._policy;

  if (!wanted || !henri.policies || req._policyAsked.has(wanted.action)) {
    return true;
  }

  const user = req.user || null;

  req._policyAsked.add(wanted.action);

  if (
    await henri.policies.can(user, wanted.action, record, {
      policy: wanted.name,
      req,
    })
  ) {
    return true;
  }

  henri.router.refuse(
    req,
    res,
    henri.policies.refusal(user, wanted.action, record, {
      policy: wanted.name,
    })
  );

  return false;
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
 * @param {*} [options.subject] what the policy is asked about, when the
 *   answer is a presentation of the record rather than the record
 * @param {Array<string>} [options.include] the fields marked
 *   `personal: { expose: false }` this answer is allowed to carry
 * @returns {Express.Response} the response
 * @throws {TypeError} when the record is not an object or the type is unknown
 */
function resource(
  henri,
  req,
  res,
  record,
  { type, links, status = 200, subject, include = [] } = {}
) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw stamp(
      new TypeError(
        'res.resource() needs a record (a model instance or a plain object); use res.collection() for lists'
      ),
      'HENRI_API_INVALID_RESOURCE'
    );
  }

  const kind = type || routeType(res);

  if (!kind) {
    throw stamp(
      new TypeError(
        'res.resource() needs a type outside of a route: res.resource(record, { type: "tasks" })'
      ),
      'HENRI_API_INVALID_RESOURCE'
    );
  }

  return (async () => {
    // The route asked for a policy the gate could not answer without the
    // record; this is the moment the record exists, so it is answered here
    // and a refusal replaces the body it was about to send
    const asked = subjectOf(subject, record);

    if (!(await enforce(henri, req, res, asked))) {
      return res;
    }

    const plain = await toPublic(henri, record, include);

    // The read half of the access trail: one entry naming the model, the
    // record and who asked, and never a value (see base/trail.js). Off
    // unless `config.trail.reads` asks for it.
    //
    // `asked` is here for the same reason the policies read it: a controller
    // answering with a presentation of a record hands over a plain object,
    // which carries no model, and `subject` is where the record itself is
    henri.trail && (await henri.trail.seen(req, [record, asked]));

    const paths = henri.router.pathForRoles(req.user);
    const merged = await allowed(
      henri,
      req.user || null,
      Object.assign(
        resourceLinks({
          id: identify(plain),
          params: req.params,
          paths,
          type: kind,
        }),
        normalizeLinks(links)
      ),
      asked,
      { req, type: kind }
    );

    if (!merged.self && req.method === 'GET') {
      merged.self = { href: req.originalUrl || req.url };
    }

    if (status === 201 && merged.self) {
      res.set('Location', merged.self.href);
    }

    const body = Object.assign({ _links: null }, plain, { _links: merged });

    return send(req, res, body, status);
  })();
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
 * @param {*} [options.subject] what the policies are asked about: a record,
 *   an array parallel to `records`, or `(item, index) => record`
 * @param {Array<string>} [options.include] the fields marked
 *   `personal: { expose: false }` this answer is allowed to carry
 * @returns {Express.Response} the response
 * @throws {TypeError} when records is not an array or the type is unknown
 */
function collection(
  henri,
  req,
  res,
  records,
  {
    type,
    page,
    perPage,
    total,
    links,
    status = 200,
    subject,
    include = [],
  } = {}
) {
  if (!Array.isArray(records)) {
    throw stamp(
      new TypeError(
        'res.collection() needs an array of records; use res.resource() for one record'
      ),
      'HENRI_API_INVALID_COLLECTION'
    );
  }

  const kind = type || routeType(res);

  if (!kind) {
    throw stamp(
      new TypeError(
        'res.collection() needs a type outside of a route: res.collection(records, { type: "tasks" })'
      ),
      'HENRI_API_INVALID_COLLECTION'
    );
  }

  return (async () => {
    const paths = henri.router.pathForRoles(req.user);
    // One cache for the whole page: the collection questions (`create`,
    // `new`, `collection`) have the same answer for every item
    const cache = new Map();
    const user = req.user || null;
    const items = [];
    // The whole page at once: publishing record by record would make one
    // lookup per foreign key per row (see base/references.js)
    const published = await toPublic(henri, records, include);

    // One entry for the page, not one per row: what was read is the answer.
    // `subject` carries the records themselves when the page is a list of
    // presentations of them (see `resource()` above)
    henri.trail &&
      (await henri.trail.seen(req, [
        records,
        Array.isArray(subject) ? subject : null,
      ]));

    for (const [index, record] of records.entries()) {
      const plain = published[index];

      items.push(
        Object.assign({ _links: null }, plain, {
          _links: await allowed(
            henri,
            user,
            resourceLinks({
              id: identify(plain),
              params: req.params,
              paths,
              type: kind,
            }),
            subjectOf(subject, record, index),
            { cache, req, type: kind }
          ),
        })
      );
    }

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
      await allowed(
        henri,
        user,
        collectionLinks({ params: req.params, paths, type: kind }),
        null,
        { cache, req, type: kind }
      ),
      normalizeLinks(links)
    );

    return send(req, res, body, status);
  })();
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
  toPublic,
};
