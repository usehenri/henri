/**
 * The OpenAPI 3.1 description of what an application exposes, built from
 * what henri already knows about itself.
 *
 * Three things feed it, and nothing else: `config/routes.js` expanded the
 * way the router expands it (`base/routes.js`), the model files with the
 * columns the adapters add (`externalId`, the timestamps, the user's
 * `email`/`password`/`roles`), and the configuration -- which says whether
 * `_links` are enforced, what a policy refusal answers, how large a page
 * may be, and which account endpoints henri mounted.
 *
 * ## What it describes, and what it refuses to
 *
 * A framework can only describe the answers it produces itself. henri
 * produces a lot of them:
 *
 * - what an action declared it accepts (`params`, base/params-schema.js) is
 *   checked by henri itself, on every verb: the fields become the query, the
 *   path and the body parameters of the operation, with the types and the
 *   bounds the declaration wrote, and the operation answers 422 when a
 *   request does not match. That check is registered next to the guards
 *   regardless of the verb, so a `GET` with a declaration answers 422 too --
 *   which is the whole reason this document reads the declarations rather
 *   than tying 422 to the idempotency of a mutating route.
 * - the routes expanded from `resources` and `crud` are HAL-guarded
 *   (`base/hateoas.js`): a successful JSON answer carries `_links`, and
 *   with `config.api.strict` one that does not is refused with a 500. That
 *   is what henri enforces, and all it enforces, so such a response names
 *   the two answers henri itself produces with `_links` -- the HAL envelope
 *   of `res.resource()` and `res.collection()`, and the page options of
 *   `res.render()` and of the implicit render -- rather than promising one
 *   and letting an application answer the other. `_links` is `required`
 *   exactly when the application turned strict on.
 * - every failure henri answers itself -- the role guard, the policy gate,
 *   the version guard, the idempotency replay, the rate limit, the error
 *   handler -- is the boom envelope of `base/boom.js`, with the henri
 *   error code when henri raised it on its own behalf.
 * - `POST /login`, `POST /logout`, the account flows of `base/accounts.js`
 *   and the health endpoints are henri's own handlers, so their bodies are
 *   described exactly.
 *
 * And it cannot describe:
 *
 * - **what an action answers**, unless henri wrapped it. A controller may
 *   `res.render()` a page, `res.resource()` a record, `res.boom.conflict()`
 *   or write its own body. A hand-written route (`get /about`), a `member`
 *   or `collection` route, a namespace root: the operation lists the
 *   failures henri owns, says so in its description, and declares no
 *   success status at all. An honest absence beats an invented `object`.
 * - **which fields an answer carries.** An action may present its records
 *   before sending them (the showcase does), so a model schema lists the
 *   columns with their types and marks *nothing* required: what is there is
 *   right, what is missing is the application's business. Every schema is
 *   open (`additionalProperties`).
 * - **what a request body accepts, when the action declared nothing.**
 *   `req.permit('title')` names the fields and henri never sees that list,
 *   and a required column may well be set by the server (the speaker of a
 *   proposal is the session, never the body). Without a declaration the
 *   input schema is the model's writable columns, all optional, and a
 *   foreign key gets no type at all: what a form posts for it is the
 *   application's to say. With one, the body is the declaration -- what
 *   henri itself checks -- and it stays open, because an undeclared key is
 *   dropped rather than refused and the action may still permit one by name.
 * - **the status of a success.** `res.resource()` defaults to 200 and takes
 *   any other; the document enumerates the statuses henri can produce and
 *   leaves the rest to the `default` response.
 *
 * Every operation carries an `x-henri` object saying which of the two it
 * is (`answer: 'collection' | 'resource' | 'page' | 'unknown'`, `known`)
 * and what henri actually checks on it (`enforced`, a list), so a reader --
 * a person or an agent -- never has to guess how much of the document was
 * derived and how much was assumed.
 *
 * ## The declarations, and the two paths that read them
 *
 * The `params` block lives in a controller file, which is code, and this
 * builder is handed the compiled rules rather than reading any: a booted
 * application passes what `henri.controllers.accepts()` already holds, and
 * `henri openapi` passes what it compiled from the controllers it could
 * load, through the same `declarations()` of base/params-schema.js. Same
 * compiler, same answer.
 *
 * A controller the command could not load -- one that reaches for a model
 * global at import time, or whose declaration would fail the boot -- is the
 * one case where the two paths differ, so it is **said in the document**
 * rather than quietly dropped: the operation carries
 * `x-henri.params.read: false`, it declares no parameters of its own and no
 * 422 for them, and `info.x-henri.params.unread` lists every such action.
 * Nothing is invented in its place.
 *
 * ## Why 3.1 and not 3.0
 *
 * 3.1 is JSON Schema 2020-12. A published foreign key is the `externalId`
 * of the row it names *or* `null` (`base/references.js`), which is
 * `type: ['string', 'null']` in 2020-12 and `nullable: true` -- a keyword
 * that is not JSON Schema at all -- in 3.0. The same goes for a schema that
 * means "anything" (`{}`), which is what an unknown answer has to be.
 *
 * GraphQL is out of scope: it has a schema of its own, derived from the
 * same model files by `base/graphql-schema.js` (which borrows `columnsOf()`
 * and `settingsOf()` from here, so the two read a model the same way), and
 * `config.graphql` names where to ask for it.
 */
const { singularize } = require('./routes');
const { accountsConfig } = require('./accounts');
const { userConfig } = require('./auth');
const { mapOf, privacyConfig } = require('./privacy');
const { DEFAULTS: PAGE_DEFAULTS } = require('./pagination');

/** The version of the specification this builder writes */
const OPENAPI_VERSION = '3.1.0';

/** The JSON Schema dialect 3.1 documents are written in */
const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const JSON_MEDIA = 'application/json';
const HAL_MEDIA = 'application/hal+json';
const HTML_MEDIA = 'text/html';

/** The verbs that change something: idempotency and CSRF apply to them */
const MUTATING = new Set(['delete', 'patch', 'post', 'put']);

/**
 * The verbs a Path Item may hold. henri's routes DSL accepts more of them
 * than HTTP has methods (`lock`, `mkcol`, `report`, ... come from WebDAV);
 * OpenAPI has a field for these eight and no others, so a route on another
 * verb is left out of `paths` and named in `info.x-henri.excluded`.
 */
const METHODS = new Set([
  'delete',
  'get',
  'head',
  'options',
  'patch',
  'post',
  'put',
  'trace',
]);

/**
 * The henri schema types and what they serialize as. `json` is deliberately
 * `{}`: a JSON column holds whatever the application put in it.
 */
const TYPES = {
  boolean: { type: 'boolean' },
  date: { format: 'date-time', type: 'string' },
  float: { type: 'number' },
  integer: { type: 'integer' },
  json: {},
  number: { type: 'number' },
  string: { type: 'string' },
  text: { type: 'string' },
  uuid: { format: 'uuid', type: 'string' },
};

/** Columns henri writes itself: they never belong in a request body */
const GENERATED = new Set([
  'confirmedAt',
  'createdAt',
  'deletedAt',
  'externalId',
  'id',
  'passwordChangedAt',
  'updatedAt',
]);

/** The seven actions of a resource, and what each one answers */
const ANSWERS = {
  create: 'resource',
  destroy: 'resource',
  edit: 'page',
  index: 'collection',
  new: 'page',
  show: 'resource',
  update: 'resource',
};

/**
 * A reader for a configuration, whether it is henri's config module or the
 * plain object a command read from `config/<env>.json`
 *
 * @param {*} config the configuration
 * @returns {function(string, *): *} `(key, fallback) => value`
 */
function reader(config) {
  if (
    config &&
    typeof config.has === 'function' &&
    typeof config.get === 'function'
  ) {
    return (key, fallback) => (config.has(key) ? config.get(key) : fallback);
  }

  return (key, fallback) => {
    let current = config;

    for (const part of String(key).split('.')) {
      if (!current || typeof current !== 'object' || !(part in current)) {
        return fallback;
      }

      current = current[part];
    }

    return typeof current === 'undefined' ? fallback : current;
  };
}

/**
 * A `{ has, get }` stand-in for the config module, so the normalizers henri
 * already owns (`userConfig`, `accountsConfig`, `privacyConfig`) answer the
 * same way here as they do at boot
 *
 * @param {function(string, *): *} read the reader
 * @returns {{get: function, has: function}} the shim
 */
function shim(read) {
  const missing = Symbol('missing');

  return {
    get: (key) => read(key, undefined),
    has: (key) => read(key, missing) !== missing,
  };
}

/**
 * A plain object, or an empty one
 *
 * @param {*} value anything
 * @returns {object} a plain object
 */
function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

/**
 * Everything the document needs from the configuration, normalized once
 *
 * @param {*} config henri's config module, or a plain object
 * @returns {object} the settings
 */
function settingsOf(config) {
  const read = reader(config);
  const stub = shim(read);
  const api = objectOf(read('api', {}));
  const rate = read('rateLimit', {});
  const policies = objectOf(read('policies', {}));
  const externalIds = objectOf(read('externalIds', {}));

  return {
    accounts: accountsConfig(stub),
    baseRole: read('baseRole', null),
    csrf: read('csrf', true) !== false,
    graphql: read('graphql', false),
    host: read('host', null),
    idempotency: api.idempotency !== false,
    lookup: externalIds.lookup === 'any' ? 'any' : 'external',
    maxPerPage:
      Number(api.maxPerPage) > 0
        ? Number(api.maxPerPage)
        : PAGE_DEFAULTS.maxPerPage,
    perPage:
      Number(api.perPage) > 0 ? Number(api.perPage) : PAGE_DEFAULTS.perPage,
    policyStatus: policies.status === 403 ? 403 : 404,
    port: Number(read('port', 3000)) || 3000,
    privacy: privacyConfig(stub),
    rateLimit: rate !== false,
    references: externalIds.references !== false,
    strict: api.strict === true,
    url: read('url', null),
    user: userConfig(stub),
  };
}

/**
 * The base url the description is served from
 *
 * @param {object} settings the settings
 * @returns {Array<object>} the `servers` array
 */
function serversOf(settings) {
  if (typeof settings.url === 'string' && settings.url.length > 0) {
    return [{ description: 'config.url', url: settings.url }];
  }

  return [
    {
      description: 'config.port (the development server)',
      url: `http://localhost:${settings.port}`,
    },
  ];
}

/**
 * The model a controller is about, by henri's own convention: the singular
 * of the last segment of the controller name (`admin/proposals` ->
 * `proposal`), matched against the identity of a model file. No match means
 * no schema, which is the honest answer.
 *
 * @param {Array<object>} models the model files
 * @returns {function(string): ?object} `(controller) => model | null`
 */
function modelFinder(models) {
  const byIdentity = new Map();

  for (const model of models) {
    byIdentity.set(
      String(model.identity || model.globalId).toLowerCase(),
      model
    );
  }

  return (controller) => {
    const last = String(controller || '')
      .split('/')
      .pop();

    return (
      byIdentity.get(singularize(last).toLowerCase()) ||
      byIdentity.get(last.toLowerCase()) ||
      null
    );
  };
}

/**
 * The policy a route asks for, resolved the way `3.policies.js` resolves it:
 * the name as written, then the singular of its last segment. Without the
 * list of the files that exist, the name as written is the best answer.
 *
 * @param {?Array<string>} policies the names of `app/policies`, or null
 * @returns {function(string): ?string} `(wanted) => name | null`
 */
function policyFinder(policies) {
  if (!Array.isArray(policies)) {
    return (wanted) => String(wanted).toLowerCase();
  }

  const known = new Set(policies.map((name) => String(name).toLowerCase()));

  return (wanted) => {
    const bare = String(wanted).toLowerCase();

    if (known.has(bare)) {
      return bare;
    }

    const parts = bare.split('/');

    parts[parts.length - 1] = singularize(parts[parts.length - 1]);

    return known.has(parts.join('/')) ? parts.join('/') : null;
  };
}

/**
 * The columns of a model as they exist once the adapter is done with it:
 * what the file declares, plus `externalId`, the timestamps, `deletedAt`
 * and, on the user model, `email`, `password`, `roles`, `confirmedAt` and
 * `passwordChangedAt`. All three adapters add exactly these.
 *
 * @param {object} model a model file
 * @param {object} settings the settings
 * @returns {object} the fields, by name
 */
function columnsOf(model, settings) {
  const options = objectOf(model.options);
  const fields = Object.assign({}, objectOf(model.schema));
  const isUser =
    String(model.identity || '').toLowerCase() ===
    String(settings.user.model || '').toLowerCase();

  if (isUser) {
    fields.email = fields.email || {
      required: true,
      type: 'string',
      unique: true,
    };
    fields.password = fields.password || {
      required: true,
      select: false,
      type: 'string',
    };
    fields.roles = fields.roles || { type: 'json' };
    fields.confirmedAt = fields.confirmedAt || { type: 'date' };
    fields.passwordChangedAt = fields.passwordChangedAt || { type: 'date' };
  }

  if (options.externalId !== false) {
    fields.externalId = fields.externalId || {
      required: true,
      type: 'uuid',
      unique: true,
    };
  }

  if (options.timestamps !== false) {
    fields.createdAt = fields.createdAt || { required: true, type: 'date' };
    fields.updatedAt = fields.updatedAt || { required: true, type: 'date' };
  }

  if (options.paranoid === true) {
    fields.deletedAt = fields.deletedAt || { index: true, type: 'date' };
  }

  return fields;
}

/**
 * The model a field points at, when it says so (`references: { model }` on
 * the SQL adapters, `ref` on Mongoose). henri never reads a field name for
 * this: an undeclared column is an opaque value (see base/references.js).
 *
 * @param {*} field a field definition
 * @returns {?string} the model name, or null
 */
function referenceOf(field) {
  if (!field || typeof field !== 'object') {
    return null;
  }

  if (typeof field.ref === 'string' && field.ref.length > 0) {
    return field.ref;
  }

  const references = objectOf(field.references).model;

  return typeof references === 'string' && references.length > 0
    ? references
    : null;
}

/**
 * A default worth writing down: a scalar, never a generator function
 *
 * @param {*} value what the field declares as its default
 * @returns {boolean} true when it can be published
 */
function publishableDefault(value) {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * The sentence describing one column: what it is, and what the model asks
 * of it. It says "required by the model" rather than making the property
 * required, because a controller may present a record before sending it.
 *
 * @param {string} name the field name
 * @param {*} field the field definition
 * @param {?string} reference the model it points at, when it declares one
 * @returns {string} the description
 */
function fieldDescription(name, field, reference) {
  const parts = [];

  if (reference) {
    parts.push(
      `A reference to ${reference}: henri publishes it as that row's externalId, and null when there is no such row.`
    );
  }

  if (field && field.required === true) {
    parts.push('Required by the model.');
  }

  if (field && field.unique === true) {
    parts.push('Unique.');
  }

  if (name === 'deletedAt') {
    parts.push('The soft delete stamp (options.paranoid).');
  }

  if (name === 'externalId') {
    parts.push(
      'The public identifier of the record: the only identifier that leaves the server.'
    );
  }

  return parts.join(' ');
}

/**
 * One column as a JSON Schema.
 *
 * Two shapes, and the split is read against write. **Reading**, the schema
 * says what the column *is*: its type, whether it can be null, and the
 * values an enum allows. **Writing**, it also says what the model validates
 * -- the lengths, the ranges, the pattern, the default -- because that is
 * what a client can act on before it sends anything.
 *
 * A column the model does not require can be null in the database and
 * therefore null in an answer, so its type carries `null` and its enum
 * carries `null` with it. Widening is the safe direction here: a response
 * schema narrower than reality makes a client reject an answer that was
 * perfectly good.
 *
 * @param {string} name the field name
 * @param {*} field the field definition
 * @param {object} context `{ resolves, settings, write }`
 * @returns {object} the schema
 */
function fieldSchema(name, field, { resolves, settings, write = false }) {
  const definition =
    typeof field === 'string' ? { type: field } : objectOf(field);
  const reference = referenceOf(definition);
  const published = reference && settings.references && resolves(reference);
  const nullable = definition.required !== true;
  const known = TYPES[definition.type];
  const schema = {};
  const description = fieldDescription(
    name,
    definition,
    published ? reference : null
  );

  if (published) {
    schema.format = 'uuid';
    schema.type = ['string', 'null'];
  } else if (known && known.type) {
    schema.type = nullable ? [known.type, 'null'] : known.type;

    if (known.format) {
      schema.format = known.format;
    }
  }

  if (
    !published &&
    Array.isArray(definition.enum) &&
    definition.enum.length > 0
  ) {
    schema.enum = nullable
      ? definition.enum.concat(null)
      : definition.enum.slice();
  }

  if (!write) {
    return description.length > 0
      ? Object.assign(schema, { description })
      : schema;
  }

  if (publishableDefault(definition.default) && !published) {
    schema.default = definition.default;
  }

  if (
    !published &&
    (definition.type === 'string' || definition.type === 'text')
  ) {
    if (Number.isFinite(definition.minLength)) {
      schema.minLength = definition.minLength;
    }

    if (Number.isFinite(definition.maxLength)) {
      schema.maxLength = definition.maxLength;
    }

    const pattern = Array.isArray(definition.match)
      ? definition.match[0]
      : definition.match;

    if (pattern instanceof RegExp) {
      schema.pattern = pattern.source;
    }
  }

  if (!published && Number.isFinite(definition.min)) {
    schema.minimum = definition.min;
  }

  if (!published && Number.isFinite(definition.max)) {
    schema.maximum = definition.max;
  }

  return description.length > 0
    ? Object.assign(schema, { description })
    : schema;
}

/**
 * One rule of a `params` declaration as a JSON Schema.
 *
 * The vocabulary is the models' (`type`, `enum`, `default`) plus the bounds
 * a request needs, so most of it maps across unchanged. Two things do not:
 * `minLength`/`maxLength` are the items of a list when the rule is a list
 * (henri has one word for one meaning; JSON Schema has two keywords), and
 * nothing is nullable -- `null` is an absent field to the checker, never a
 * value it keeps.
 *
 * @param {object} compiled a compiled rule (base/params-schema.js)
 * @returns {object} the schema
 */
function ruleSchema(compiled) {
  const written = objectOf(compiled);
  const list = written.type === 'array';
  const known = TYPES[written.type];
  const schema = {};

  if (list) {
    schema.type = 'array';
    schema.items = ruleSchema(written.of);
  } else if (known && known.type) {
    schema.type = known.type;

    if (known.format) {
      schema.format = known.format;
    }
  }

  if (Array.isArray(written.enum) && written.enum.length > 0) {
    schema.enum = written.enum.slice();
  }

  if (publishableDefault(written.default)) {
    schema.default = written.default;
  }

  if (Number.isFinite(written.min)) {
    schema.minimum = written.min;
  }

  if (Number.isFinite(written.max)) {
    schema.maximum = written.max;
  }

  if (Number.isFinite(written.minLength)) {
    schema[list ? 'minItems' : 'minLength'] = written.minLength;
  }

  if (Number.isFinite(written.maxLength)) {
    schema[list ? 'maxItems' : 'maxLength'] = written.maxLength;
  }

  if (written.pattern instanceof RegExp) {
    schema.pattern = written.pattern.source;
  }

  return schema;
}

/**
 * Where every declared field of an action is described.
 *
 * henri reads a field from the query string, the body and the path
 * parameters, a later source winning; the document has to put each one
 * somewhere, so it follows what the request can actually carry. A name the
 * route templates is a path parameter. On a verb with no body, everything
 * else is a query parameter. On a mutating verb, everything else is the
 * request body -- which is where a form posts it and where henri writes a
 * default -- and the description says the query string is read as well.
 *
 * @param {object} rules the compiled rules, by field
 * @param {object} context `{ names, verb }`
 * @returns {{body: object, path: object, query: object}} the three groups
 */
function splitDeclaration(rules, { names, verb }) {
  const body = {};
  const path = {};
  const query = {};

  for (const field of Object.keys(rules).sort()) {
    if (names.includes(field)) {
      path[field] = rules[field];
    } else if (MUTATING.has(verb)) {
      body[field] = rules[field];
    } else {
      query[field] = rules[field];
    }
  }

  return { body, path, query };
}

/**
 * What a parameter built from a declaration says about itself
 *
 * @param {string} where `query` or `path`
 * @param {object} context `{ action, controller }`
 * @returns {string} the description
 */
function declaredDescription(where, { action, controller }) {
  return [
    `Declared by \`${controller}#${action}\` (the \`params\` export): henri checks it before the action runs and answers 422 with a message for this field when it does not fit (\`HENRI_PARAMS_INVALID\`).`,
    `The ${where === 'path' ? 'path' : 'query string'} is textual, so the value is parsed into the type above rather than checked against it.`,
  ].join(' ');
}

/**
 * The query parameters an action declared
 *
 * @param {object} rules the declared fields that arrive in the query
 * @param {object} context `{ action, controller }`
 * @returns {Array<object>} the parameter objects
 */
function declaredParameters(rules, context) {
  return Object.keys(rules).map((name) => ({
    name,
    in: 'query',
    required: rules[name].required === true,
    description: declaredDescription('query', context),
    schema: ruleSchema(rules[name]),
  }));
}

/**
 * The request body an action declared.
 *
 * Open, and deliberately: an undeclared key is dropped rather than refused
 * (base/params-schema.js), and `req.permit('title')` can still name a field
 * the declaration says nothing about.
 *
 * @param {object} rules the declared fields that arrive in the body
 * @param {object} context `{ action, controller, model }`
 * @returns {object} the request body object
 */
function declaredBody(rules, { action, controller, model }) {
  const properties = {};
  const required = [];

  for (const name of Object.keys(rules)) {
    properties[name] = ruleSchema(rules[name]);

    if (rules[name].required === true) {
      required.push(name);
    }
  }

  const schema = prune({
    type: 'object',
    description: `The fields \`${controller}#${action}\` declared it accepts. A JSON body is checked and never parsed -- \`{"page": "2"}\` where a number was declared is refused -- while a form body is parsed into the declared type.`,
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: true,
  });

  return {
    description: `What the action declared (\`params\`), which is what henri checks: a request that does not match is refused with a 422 before the action runs.${
      model
        ? ` The columns of the ${model.globalId} model are \`${model.globalId}Input\`, and the action may permit one of them by name.`
        : ''
    } Other properties are allowed, because an undeclared key is dropped rather than refused; henri reads a declared field from the query string as well as from the body.`,
    content: {
      [JSON_MEDIA]: { schema },
      'application/x-www-form-urlencoded': { schema },
    },
    required: required.length > 0,
  };
}

/**
 * The schemas of one model: the record as it leaves, and the columns a
 * request may carry
 *
 * @param {object} model the model file
 * @param {object} context `{ hidden, resolves, settings }`
 * @returns {{input: object, record: object}} the two schemas
 */
function modelSchemas(model, context) {
  const { hidden, settings } = context;
  const fields = columnsOf(model, settings);
  const isUser =
    String(model.identity || '').toLowerCase() ===
    String(settings.user.model || '').toLowerCase();
  const record = {};
  const input = {};

  for (const name of Object.keys(fields).sort()) {
    const field =
      typeof fields[name] === 'string' ? {} : objectOf(fields[name]);

    if (hidden.has(name) || field.select === false) {
      continue;
    }

    record[name] =
      isUser && name === 'roles'
        ? {
            type: ['array', 'null'],
            description:
              'The roles of the account. Stripped from a mass assignment: `setRoles()` and `User.setRoles(id, roles)` are what change them.',
            items: { type: 'string' },
          }
        : fieldSchema(name, fields[name], context);

    if (GENERATED.has(name) || name === 'roles' || name === 'password') {
      continue;
    }

    const reference = referenceOf(field);

    input[name] = reference
      ? {
          description: `A reference to ${reference}. What this endpoint accepts for it -- the row's externalId, its primary key, nothing -- is the controller's decision, so henri states no type.`,
        }
      : fieldSchema(name, fields[name], {
          resolves: () => false,
          settings,
          write: true,
        });
  }

  return {
    input: {
      type: 'object',
      description: `The columns of ${model.globalId} a request could carry. Every property is optional: what an action accepts is what it passes to req.permit(), which henri does not read, and a column the model requires may well be set by the server. Additional properties are allowed for the same reason.`,
      properties: input,
      additionalProperties: true,
    },
    record: {
      type: 'object',
      description: `${model.globalId} as henri serializes it. Nothing is required: an action may present a record before sending it, so a property that is absent is the application's business. The primary key never leaves${
        objectOf(model.options).externalId === false
          ? ''
          : '; externalId is what identifies the record'
      }.`,
      properties: record,
      additionalProperties: true,
    },
  };
}

/**
 * The shared schemas of the document
 *
 * @param {object} context `{ hidden, models, resolves, settings }`
 * @returns {object} `components.schemas`
 */
function schemasOf(context) {
  const { models, settings } = context;
  const schemas = {
    Link: {
      type: 'object',
      description: 'One HAL link.',
      properties: {
        href: { type: 'string', description: 'The path to follow.' },
        method: {
          type: 'string',
          description:
            'The verb to use, when it is not GET (`update` is PATCH, `destroy` is DELETE).',
        },
      },
      required: ['href'],
    },
    Links: {
      type: 'object',
      description:
        'The `_links` of a HAL answer, built from the route helpers and filtered by the roles of the caller and then by the policies (base/hateoas.js). A link that is absent is one this caller may not follow. The relations henri builds are `self`, `collection`, `edit`, `update`, `destroy` on a record, and `self`, `first`, `prev`, `next`, `last`, `create`, `new` on a collection; a controller may add its own.',
      additionalProperties: { $ref: '#/components/schemas/Link' },
    },
    Error: {
      type: 'object',
      description:
        'The error envelope of henri (base/boom.js): what `res.boom.*`, the guards and the 404 and 500 handlers answer.',
      properties: {
        statusCode: { type: 'integer', description: 'The HTTP status.' },
        error: {
          type: 'string',
          description: 'The reason phrase (`Not Found`, `Forbidden`).',
        },
        message: { type: 'string', description: 'What went wrong.' },
        code: {
          type: 'string',
          description:
            'The henri error code, when henri raised the failure on its own behalf (see the error reference).',
        },
        data: {
          description:
            'Whatever the failure carries: the missing roles, the fields that did not validate, the retry delay.',
        },
      },
      required: ['statusCode', 'error', 'message'],
    },
    HalResource: {
      type: 'object',
      description:
        'A HAL resource whose fields henri cannot name: the controller is not one henri wrote, so only `_links` is described.',
      properties: { _links: { $ref: '#/components/schemas/Links' } },
      required: settings.strict ? ['_links'] : undefined,
      additionalProperties: true,
    },
    HalCollection: {
      type: 'object',
      description:
        'A HAL collection whose items henri cannot name. `page`, `perPage` and `total` appear when the controller paginated.',
      properties: {
        _links: { $ref: '#/components/schemas/Links' },
        _embedded: {
          type: 'object',
          description:
            'The items, under the last segment of the controller name.',
          additionalProperties: { type: 'array' },
        },
        count: {
          type: 'integer',
          description: 'How many items this page carries.',
        },
        page: { type: 'integer' },
        perPage: { type: 'integer' },
        total: { type: 'integer' },
      },
      required: settings.strict ? ['_links'] : undefined,
      additionalProperties: true,
    },
    RenderedPage: {
      type: 'object',
      description:
        'What `res.render()` answers to a client asking for JSON: the options the view engine renders the page from (5.router.js). `data` is what the controller handed it, published and stripped of the fields marked `personal: { expose: false }`; `paths` are the route helpers this caller may follow.',
      properties: {
        _links: { $ref: '#/components/schemas/Links' },
        csrf: {
          type: ['string', 'null'],
          description: 'The CSRF token to send back on a mutating request.',
        },
        data: { description: 'The payload of the page.' },
        errors: {
          description:
            'The validation errors of the form, keyed by field, or null.',
        },
        flash: {
          type: 'object',
          description: 'The one-shot messages of the session.',
          additionalProperties: true,
        },
        localUrl: { type: 'string' },
        paths: {
          type: 'object',
          description:
            'The route helpers this caller may follow, keyed by `<action>_<controller>_path`.',
          additionalProperties: true,
        },
        query: { type: 'object', additionalProperties: true },
        user: { $ref: '#/components/schemas/PublicUser' },
        graphql: { type: 'object', additionalProperties: true },
        nonce: {
          type: 'string',
          description: 'The CSP nonce of this response (`csp.nonce` only).',
        },
      },
      required: [
        '_links',
        'csrf',
        'data',
        'errors',
        'flash',
        'localUrl',
        'paths',
        'query',
        'user',
      ],
      additionalProperties: true,
    },
    PublicUser: publicUserSchema(context),
    Health: {
      type: 'object',
      description: 'The answer of the health endpoints (base/health.js).',
      properties: {
        status: { type: 'string', enum: ['ok', 'unavailable'] },
        uptime: { type: 'integer', description: 'Seconds since the boot.' },
        requestId: { type: 'string' },
        reason: {
          type: 'string',
          description: 'Why the process is not ready, when it is not.',
        },
        stores: {
          type: 'object',
          description:
            'One entry per store: its adapter, whether it answered and how long it took.',
          additionalProperties: true,
        },
        shared: {
          type: 'object',
          description: 'The shared backend, when `config.shared` names one.',
          additionalProperties: true,
        },
        version: {
          type: 'string',
          description: 'Absent in production.',
        },
      },
      required: ['status', 'uptime'],
      additionalProperties: true,
    },
  };

  for (const model of models) {
    const built = modelSchemas(model, context);
    const name = String(model.globalId);

    schemas[name] = built.record;
    schemas[`${name}Input`] = built.input;
    schemas[`${name}Resource`] = {
      allOf: [{ $ref: `#/components/schemas/${name}` }],
      type: 'object',
      description: `${name} as a HAL resource: its columns and the links this caller may follow.`,
      properties: { _links: { $ref: '#/components/schemas/Links' } },
      required: settings.strict ? ['_links'] : undefined,
    };
    schemas[`${name}Collection`] = {
      type: 'object',
      description: `A page of ${name}. \`page\`, \`perPage\`, \`total\` and the links around the page are there only when the action paginated (\`req.pagination()\`).`,
      properties: {
        _links: { $ref: '#/components/schemas/Links' },
        _embedded: {
          type: 'object',
          description:
            'The records, under the last segment of the controller name.',
          additionalProperties: {
            type: 'array',
            items: { $ref: `#/components/schemas/${name}Resource` },
          },
        },
        count: {
          type: 'integer',
          description: 'How many records this page carries.',
        },
        page: { type: 'integer' },
        perPage: { type: 'integer' },
        total: { type: 'integer' },
      },
      required: settings.strict ? ['_links'] : undefined,
      additionalProperties: true,
    };
  }

  return prune(schemas);
}

/**
 * The user as it leaves the server (`publicUser()`): the identifier, the
 * address, the roles and whatever `config.user.public` adds
 *
 * @param {object} context `{ hidden, models, settings }`
 * @returns {object} the schema
 */
function publicUserSchema({ hidden, models, settings }) {
  const model = models.find(
    (entry) =>
      String(entry.identity || '').toLowerCase() ===
      String(settings.user.model || '').toLowerCase()
  );
  const external = !model || objectOf(model.options).externalId !== false;
  const columns = model ? columnsOf(model, settings) : {};
  const properties = {
    roles: {
      type: 'array',
      description: 'The roles of the account.',
      items: { type: 'string' },
    },
  };

  if (external) {
    properties.externalId = { type: 'string', format: 'uuid' };
  } else {
    properties.id = { description: 'The identifier of the account.' };
  }

  if (!hidden.has('email')) {
    properties.email = { type: 'string' };
  }

  for (const field of settings.user.public || []) {
    if (hidden.has(field) || field === 'password') {
      continue;
    }

    properties[field] = columns[field]
      ? fieldSchema(field, columns[field], { resolves: () => false, settings })
      : {};
  }

  const required = [external ? 'externalId' : 'id', 'roles'];

  if (!hidden.has('email')) {
    required.push('email');
  }

  return {
    type: ['object', 'null'],
    description:
      'The representation of a user that leaves the server: never the password, never a column the application did not put in `config.user.public`.',
    properties,
    required: required.sort(),
  };
}

/**
 * Removes the keys whose value is undefined, at every depth, so the
 * document never carries a `required: undefined`
 *
 * @param {*} value anything
 * @returns {*} the same value without the undefined keys
 */
function prune(value) {
  if (Array.isArray(value)) {
    return value.map(prune);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const copy = {};

  for (const key of Object.keys(value)) {
    if (typeof value[key] !== 'undefined') {
      copy[key] = prune(value[key]);
    }
  }

  return copy;
}

/**
 * The reusable responses: every failure henri answers itself
 *
 * @param {object} settings the settings
 * @returns {object} `components.responses`
 */
function responsesOf(settings) {
  const body = {
    content: {
      [JSON_MEDIA]: { schema: { $ref: '#/components/schemas/Error' } },
    },
  };
  const named = (description) => Object.assign({ description }, body);

  return {
    BadRequest: named(
      'The request could not be read. henri answers this for an `Idempotency-Key` longer than 255 characters or not printable ascii, and for an account link that is no longer valid.'
    ),
    Conflict: named(
      'A request with the same `Idempotency-Key` is still running (base/idempotency.js).'
    ),
    Error: named(
      'Any other status. A failure henri answers itself -- a guard, the request timeout, the body limit, the error handler, `res.boom.*` -- uses this envelope, with `code` when henri raised it on its own behalf. A controller may answer something else.'
    ),
    Forbidden: named(
      `The caller is signed in and may not do this: a missing role, a CSRF token that did not check out${
        settings.policyStatus === 403 ? ', or a policy that said no' : ''
      }.`
    ),
    IdempotencyMismatch: named(
      'The `Idempotency-Key` was already used for a different method, url or body (base/idempotency.js). The first answer is not replayed to a request that is not the same one.'
    ),
    InvalidParameters: named(
      'The request does not match what the action declared it accepts (`params`, base/params-schema.js): `code` is `HENRI_PARAMS_INVALID` and `data.errors` holds one message per field. The check runs behind the role and the policy guards and ahead of the action, on every verb -- a `GET` declaring its query string answers this too.'
    ),
    NotAcceptable: named(
      'The client asked for an API version this route does not serve (`Accept: application/vnd.henri.vN+json`).'
    ),
    NotFound: named(
      'Nothing here, or nothing this caller may know about: a policy refuses a signed-in caller with a 404 by default, so a record they may not read reads as one that does not exist (`config.policies.status`).'
    ),
    TooManyRequests: Object.assign(
      {
        description:
          'The rate limit of `config.rateLimit` (600 requests a minute per user or ip by default, 10 a minute on the authentication paths). Not enforced in development.',
        headers: {
          'Retry-After': {
            description: 'Seconds until the window rolls over.',
            schema: { type: 'integer' },
          },
          RateLimit: {
            description: 'The limit, the remainder and the reset (draft 7).',
            schema: { type: 'string' },
          },
        },
      },
      body
    ),
    Unauthorized: named(
      'Nobody is signed in. A browser asking for HTML is redirected to `config.user.loginPath` instead.'
    ),
    UnprocessableEntity: named(
      'Either of the two henri answers on this operation, and `code` says which: the parameter check refused the request (`HENRI_PARAMS_INVALID`, one message per field in `data.errors`), or the `Idempotency-Key` was already used for a different method, url or body.'
    ),
    ValidationFailed: named(
      'A value one of the account handlers henri mounts could not accept: an address that is already registered, a password the user model refused, a form that did not validate. `data.errors` holds one message per field when henri has them.'
    ),
  };
}

/**
 * The reusable parameters
 *
 * @param {object} settings the settings
 * @returns {object} `components.parameters`
 */
function parametersOf(settings) {
  return {
    IdempotencyKey: {
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description:
        'Executes this request once: the first answer is stored for `config.api.idempotency.ttl` (24h) and replayed to any request reusing the key, with `Idempotency-Replayed: true`. Keys are scoped to the caller and tied to a fingerprint of the method, url and body.',
      schema: { type: 'string', maxLength: 255 },
    },
    CsrfToken: {
      name: 'X-CSRF-Token',
      in: 'header',
      required: false,
      description:
        'The value of the `henri.csrf` cookie. Required of a mutating request that carries the session cookie; a client authenticating with a bearer token sends neither (base/csrf.js). `_csrf` in the body does as well.',
      schema: { type: 'string' },
    },
    Page: {
      name: 'page',
      in: 'query',
      required: false,
      description:
        "The page to read, when the action paginates (`req.pagination()`). henri reads it on every request; whether it reaches the query is the controller's decision.",
      schema: { type: 'integer', minimum: 1, default: 1 },
    },
    PerPage: {
      name: 'per_page',
      in: 'query',
      required: false,
      description: `How many records a page holds, when the action paginates. Bounded by \`config.api.maxPerPage\` (${settings.maxPerPage}).`,
      schema: {
        type: 'integer',
        minimum: 1,
        maximum: settings.maxPerPage,
        default: settings.perPage,
      },
    },
  };
}

/**
 * `/tasks/:id` as OpenAPI writes it, and the parameters it declares
 *
 * @param {string} route the express path
 * @returns {{path: string, names: Array<string>}} the template and its names
 */
function template(route) {
  const names = [];
  const path = String(route)
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)\??/gu, (match, name) => {
      names.push(name);

      return `{${name}}`;
    })
    .replace(/\*([A-Za-z_][A-Za-z0-9_]*)?/gu, (match, name) => {
      const wildcard = name || 'wildcard';

      names.push(wildcard);

      return `{${wildcard}}`;
    });

  return { names, path };
}

/**
 * The path parameters of a route. `:id` on a resource route is the public
 * identifier of the record when the model carries one, because that is the
 * only identifier `findById()` resolves (`externalIds.lookup`).
 *
 * A name the action also declared in `params` is typed by the declaration
 * instead: that is the rule henri checks, and it is checked on the path like
 * anywhere else.
 *
 * @param {Array<string>} names the parameter names
 * @param {object} context `{ declared, findModel, route, settings }`
 * @returns {Array<object>} the parameter objects
 */
function pathParameters(names, { declared = {}, findModel, route, settings }) {
  const [controller, action] = String(route.controller || '').split('#');

  return names.map((name) => {
    const owner =
      name === 'id'
        ? findModel(controller)
        : findModel(name.replace(/_id$/u, ''));
    const external = owner && objectOf(owner.options).externalId !== false;
    const rule = Object.prototype.hasOwnProperty.call(declared, name)
      ? declared[name]
      : null;
    const schema =
      external && settings.lookup === 'external'
        ? { type: 'string', format: 'uuid' }
        : { type: 'string' };
    const description = owner
      ? `The externalId of the ${owner.globalId}${
          external && settings.lookup === 'external'
            ? ': the primary key does not resolve (base/references.js)'
            : ''
        }.`
      : 'A path parameter henri knows the name of and nothing else.';

    return {
      name,
      in: 'path',
      required: true,
      description: rule
        ? `${description} ${declaredDescription('path', { action, controller })}`
        : description,
      schema: rule ? ruleSchema(rule) : schema,
    };
  });
}

/**
 * What the operation is called. Two routes may share a controller and an
 * action (PATCH and PUT both reach `update`), so the verb settles a tie.
 *
 * @param {object} route the route
 * @param {Set<string>} taken the identifiers already used
 * @returns {string} the operation id
 */
function operationId(route, taken) {
  const base = String(route.controller).replace(/[#/]/gu, '.');
  const name = taken.has(base) ? `${base}.${route.verb}` : base;

  taken.add(name);

  return name;
}

/**
 * The failures henri answers on this route, from its own options and from
 * what the action declared it accepts.
 *
 * The 422 is the one status two of them can produce, and which of the two it
 * is matters to whoever reads this: an idempotency replay and a parameter
 * refused are not the same failure and are not fixed the same way. So the
 * status names the cause it can have here, and the shared component only
 * when it can have both.
 *
 * @param {object} route the route
 * @param {object} settings the settings
 * @param {?object} rules what the action declared, or null
 * @returns {object} the responses, by status
 */
function guardResponses(route, settings, rules) {
  const responses = {};
  const reference = (name) => ({ $ref: `#/components/responses/${name}` });
  const roles = route.roles ? [].concat(route.roles) : null;
  const mutating = MUTATING.has(route.verb);
  const idempotent =
    mutating && settings.idempotency && route.idempotent !== false;

  if (roles || route.policy) {
    responses['401'] = reference('Unauthorized');
  }

  if (roles || (route.policy && settings.policyStatus === 403)) {
    responses['403'] = reference('Forbidden');
  }

  if (mutating && settings.csrf) {
    responses['403'] = reference('Forbidden');
  }

  if (route.policy && settings.policyStatus === 404) {
    responses['404'] = reference('NotFound');
  }

  if (route.version) {
    responses['406'] = reference('NotAcceptable');
  }

  if (idempotent) {
    responses['400'] = reference('BadRequest');
    responses['409'] = reference('Conflict');
  }

  if (idempotent && rules) {
    responses['422'] = reference('UnprocessableEntity');
  } else if (idempotent) {
    responses['422'] = reference('IdempotencyMismatch');
  } else if (rules) {
    responses['422'] = reference('InvalidParameters');
  }

  if (settings.rateLimit) {
    responses['429'] = reference('TooManyRequests');
  }

  return responses;
}

/**
 * The sentences that say what henri knows about this route and what it does
 * not
 *
 * @param {object} route the route
 * @param {object} context `{ answer, known, model, params, policy, settings }`
 * @returns {string} the description
 */
function operationDescription(
  route,
  { answer, known, model, params, policy, settings }
) {
  const [controller, action] = String(route.controller).split('#');
  const lines = [
    `\`${controller}#${action}\`, from the \`${route.verb} ${route.route}\` route of config/routes.js. Path helper: \`${route.path}\`.`,
  ];

  if (known === false) {
    lines.push(
      `**No such action.** \`app/controllers/${controller}.js\` exports no \`${action}\`: in development the route answers 501 Not Implemented, and in production it is never registered, so the path answers 404.`
    );
  }

  if (route.roles) {
    lines.push(
      `Roles: ${[]
        .concat(route.roles)
        .map((role) => `\`${role}\``)
        .join(
          ', '
        )}. Anyone else gets a 401 (anonymous) or a 403 (signed in, missing the role); a browser is redirected to \`${settings.user.loginPath}\`.`
    );
  }

  if (route.policy) {
    lines.push(
      policy
        ? `Policy: \`app/policies/${policy}.js\`. A refusal answers ${settings.policyStatus}, or 401 when nobody is signed in; the rules that need the record are answered by the action rather than by the gate.`
        : `Policy: the route asks for \`${route.policy === true ? controller : route.policy}\`, and there is no such file in app/policies. henri fails closed: every request to this route is refused with a ${settings.policyStatus}.`
    );
  }

  if (route.version) {
    lines.push(
      `Version: \`${route.version}\`. A client asking for another \`application/vnd.henri.vN+json\` gets a 406; one asking for none is served this version.`
    );
  }

  if (params.rules) {
    lines.push(
      `Parameters: \`${controller}#${action}\` declares ${Object.keys(
        params.rules
      )
        .sort()
        .map((field) => `\`${field}\``)
        .join(
          ', '
        )} (\`params\`). henri checks them behind the guards and ahead of the action, and answers 422 with one message per field when a request does not match; what it accepts is coerced, so the action reads the declared type.`
    );
  }

  if (params.read === false) {
    lines.push(
      `Parameters: henri could not read the \`params\` export of \`app/controllers/${controller}.js\` -- the file did not load outside a booted application, or its declaration would fail the boot. If the action declares any, they are checked at runtime and are **not** in this operation; nothing was guessed in their place.`
    );
  }

  if (answer === 'collection') {
    lines.push(
      `Answers a HAL collection${
        model ? ` of ${model.globalId}` : ''
      } when the action calls \`res.collection()\`; the paging numbers and the \`first\`/\`prev\`/\`next\`/\`last\` links are there only when it paginated. An action that instead renders a page -- \`res.render()\`, or returning an object without answering -- answers this same route with the options the page is built from (\`RenderedPage\`), which is the other shape below: \`_embedded\` is what tells the two apart. What henri enforces here, and all it enforces, is that a successful JSON answer carries \`_links\`: one that does not is ${
        settings.strict
          ? 'refused with a 500 (config.api.strict)'
          : 'reported in the log'
      }.`
    );
  }

  if (answer === 'resource') {
    lines.push(
      `Answers a HAL resource${
        model ? ` of ${model.globalId}` : ''
      } when the action calls \`res.resource()\`, and the status is the action's to choose (200 is what \`res.resource()\` sends unless told otherwise). An action that instead renders a page -- \`res.render()\`, or returning an object without answering -- answers this same route with the options the page is built from (\`RenderedPage\`), which is the other shape below. What henri enforces here, and all it enforces, is that a successful JSON answer carries \`_links\`: one that does not is ${
        settings.strict
          ? 'refused with a 500 (config.api.strict)'
          : 'reported in the log'
      }.`
    );
  }

  if (answer === 'page') {
    lines.push(
      `A form page, and one of the two answers henri does not write. To a browser it is HTML. To a client asking for JSON it is whatever the action sent -- the options the page is rendered from (\`res.render()\`), or the record (\`res.resource()\`) -- and the only thing henri enforces is that it carries \`_links\`${
        settings.strict ? ' (config.api.strict refuses one that does not)' : ''
      }.`
    );
  }

  if (answer === 'unknown') {
    lines.push(
      'henri does not know what this action answers: it is not one of the seven actions expanded from `resources`, so nothing wraps it and the controller writes the body. The statuses below are the ones henri produces before the action runs, or in place of it.'
    );
  }

  lines.push(
    'JSON is served to a client asking for it (`Accept: application/json`, `application/hal+json`, or the versioned vendor type); anything else gets the page.'
  );

  return lines.join('\n\n');
}

/**
 * The successful answers of a resource route
 *
 * @param {string} action the action
 * @param {object} context `{ model, settings }`
 * @returns {object} the responses
 */
function resourceResponses(action, { embed, model }) {
  const resource = model
    ? `#/components/schemas/${model.globalId}Resource`
    : '#/components/schemas/HalResource';
  const collection = model
    ? `#/components/schemas/${model.globalId}Collection`
    : '#/components/schemas/HalCollection';
  // The key the items sit under is the last segment of the controller name,
  // which the component cannot know: it is named here, on top of it
  const page = model
    ? {
        allOf: [{ $ref: collection }],
        type: 'object',
        properties: {
          _embedded: {
            type: 'object',
            properties: {
              [embed]: {
                type: 'array',
                items: { $ref: resource },
              },
            },
          },
        },
      }
    : { $ref: collection };
  // What henri enforces on this route is `_links`, and it produces two
  // answers that carry them: the HAL envelope of `res.resource()` and
  // `res.collection()`, and the page options of `res.render()` and of the
  // implicit render (an action that returns an object without answering).
  // Both are named, HAL first, rather than the document promising one and
  // an application answering the other
  const rendered = { $ref: '#/components/schemas/RenderedPage' };
  const either = (schema) => ({ anyOf: [schema, rendered] });
  const media = (schema) => ({
    [JSON_MEDIA]: { schema: either({ $ref: schema }) },
    [HAL_MEDIA]: { schema: either({ $ref: schema }) },
  });
  const pages = {
    [JSON_MEDIA]: { schema: either(page) },
    [HAL_MEDIA]: { schema: either(page) },
  };
  const headers = {
    'X-Request-Id': {
      description: 'The identifier of this request, in the logs as well.',
      schema: { type: 'string' },
    },
  };

  if (action === 'index') {
    return {
      200: {
        description: `The page of records the action sent, under \`_embedded.${embed}\`.`,
        content: pages,
        headers: Object.assign(
          {
            Link: {
              description:
                'The links around the page (RFC 8288), when the action paginated.',
              schema: { type: 'string' },
            },
            'X-Total-Count': {
              description: 'The total number of records, when it is known.',
              schema: { type: 'integer' },
            },
          },
          headers
        ),
      },
    };
  }

  if (action === 'new' || action === 'edit') {
    // A form page, and henri does not write its body. What it does enforce
    // is `_links`, so the two shapes it can be -- the options `res.render()`
    // sends, or the record itself -- are offered without either being
    // claimed
    const either = {
      anyOf: [
        { $ref: '#/components/schemas/RenderedPage' },
        { $ref: '#/components/schemas/HalResource' },
      ],
    };

    return {
      200: {
        description:
          'The page for a browser. For a client asking for JSON: the options the page is rendered from when the action called `res.render()`, the record when it called `res.resource()`. henri enforces `_links` on this route and nothing else.',
        content: {
          [HTML_MEDIA]: {},
          [JSON_MEDIA]: { schema: either },
          [HAL_MEDIA]: { schema: either },
        },
        headers,
      },
    };
  }

  const responses = {
    200: {
      description: 'The record the action sent.',
      content: media(resource),
      headers,
    },
  };

  if (action === 'create') {
    responses[201] = {
      description:
        'The record, when the action answered `res.resource(record, { status: 201 })`.',
      content: media(resource),
      headers: Object.assign(
        {
          Location: {
            description: 'The `self` link of the new record.',
            schema: { type: 'string' },
          },
        },
        headers
      ),
    };
  }

  if (action === 'destroy') {
    responses[204] = {
      description: 'Nothing, when the action answered without a body.',
    };
  }

  return responses;
}

/**
 * One operation of the description
 *
 * @param {object} route the route
 * @param {object} context the builder context
 * @returns {object} the operation object
 */
function operationFor(route, context) {
  const { findModel, findPolicy, ids, settings } = context;
  const [controller, action] = String(route.controller).split('#');
  const model = findModel(controller);
  const policy = route.policy
    ? findPolicy(route.policy === true ? controller : route.policy)
    : null;
  const isResource = route.resource === true;
  const answer = isResource ? ANSWERS[action] || 'unknown' : 'unknown';
  const known = context.actionKnown(route.controller);
  const params = context.declared(route.controller);
  const { names } = template(route.route);
  const declared = params.rules
    ? splitDeclaration(params.rules, { names, verb: route.verb })
    : { body: {}, path: {}, query: {} };
  const parameters = pathParameters(names, {
    declared: declared.path,
    findModel,
    route,
    settings,
  });
  const responses = {};

  parameters.push(
    ...declaredParameters(declared.query, { action, controller })
  );

  if (answer === 'collection') {
    // The paging parameters, unless the action declared one of them itself:
    // two parameters of the same name in the same place is not a document,
    // and the declaration is the one henri enforces
    for (const [name, id] of [
      ['page', 'Page'],
      ['per_page', 'PerPage'],
    ]) {
      if (!Object.prototype.hasOwnProperty.call(declared.query, name)) {
        parameters.push({ $ref: `#/components/parameters/${id}` });
      }
    }
  }

  if (MUTATING.has(route.verb)) {
    if (settings.idempotency && route.idempotent !== false) {
      parameters.push({ $ref: '#/components/parameters/IdempotencyKey' });
    }

    if (settings.csrf) {
      parameters.push({ $ref: '#/components/parameters/CsrfToken' });
    }
  }

  if (answer !== 'unknown' && known !== false) {
    Object.assign(
      responses,
      resourceResponses(action, {
        embed: controller.split('/').pop(),
        model,
      })
    );
  }

  Object.assign(responses, guardResponses(route, settings, params.rules));

  if (answer === 'unknown' || known === false) {
    responses.default = {
      description:
        known === false
          ? 'The controller has no such action: 501 in development, 404 in production.'
          : "Not described: what this action answers is the controller's own. A failure henri answers itself uses the error envelope; anything else is this application's.",
      content: { [JSON_MEDIA]: { schema: {} } },
    };
  } else {
    responses.default = { $ref: '#/components/responses/Error' };
  }

  // A form page is a route henri guards and an answer it does not write:
  // it counts with the ones henri cannot describe
  const described = answer === 'collection' || answer === 'resource';
  // What henri itself checks on this route, and nothing an application does
  const enforced = []
    .concat(described || answer === 'page' ? ['_links'] : [])
    .concat(params.rules ? ['params'] : []);
  const marks = prune({
    fields: params.rules ? Object.keys(params.rules).sort() : undefined,
    read: params.read === false ? false : undefined,
  });
  const operation = {
    operationId: operationId(route, ids),
    summary: `${controller}#${action}`,
    description: operationDescription(route, {
      answer,
      known,
      model,
      params,
      policy,
      settings,
    }),
    tags: [controller],
    parameters,
    responses,
    'x-henri': prune({
      action,
      answer: known === false ? 'unknown' : answer,
      controller,
      enforced: enforced.length > 0 ? enforced : undefined,
      known: known !== false && described,
      model: answer !== 'unknown' && model ? model.globalId : undefined,
      params: Object.keys(marks).length > 0 ? marks : undefined,
      pathHelper: route.path,
      policy: route.policy ? policy || false : undefined,
      roles: route.roles ? [].concat(route.roles) : undefined,
      source: isResource ? 'resources' : 'route',
      version: route.version || undefined,
    }),
  };

  if (Object.keys(declared.body).length > 0) {
    operation.requestBody = declaredBody(declared.body, {
      action,
      controller,
      model,
    });
  } else if (
    MUTATING.has(route.verb) &&
    model &&
    (action === 'create' || action === 'update')
  ) {
    const schema = { $ref: `#/components/schemas/${model.globalId}Input` };

    operation.requestBody = {
      description: `The attributes to write. henri derives them from the ${model.globalId} model; the action decides which of them it permits.`,
      content: {
        [JSON_MEDIA]: { schema },
        'application/x-www-form-urlencoded': { schema },
      },
      required: false,
    };
  } else if (MUTATING.has(route.verb)) {
    operation.requestBody = {
      description:
        'henri does not know what this action reads: `req.permit()` names the fields and henri does not see the list.',
      content: { [JSON_MEDIA]: { schema: {} } },
      required: false,
    };
  }

  if (route.roles) {
    operation.security = context.securitySchemes
      ? [{ session: [] }, { bearer: [] }]
      : [];
  }

  return operation;
}

/**
 * The endpoints henri mounts itself: the session, the account flows of
 * `config.user` and the health probes. Their bodies are henri's own
 * handlers, so they are described exactly.
 *
 * @param {object} context the builder context
 * @returns {Array<object>} `[{ verb, route, operation }]`
 */
function builtins(context) {
  const { settings } = context;
  const { accounts, user } = settings;
  const found = [];
  const errors = { $ref: '#/components/responses/Error' };
  const json = (schema, description) => ({
    description,
    content: { [JSON_MEDIA]: { schema } },
  });
  const publicUser = { $ref: '#/components/schemas/PublicUser' };
  const csrf = settings.csrf
    ? [{ $ref: '#/components/parameters/CsrfToken' }]
    : [];
  const add = (verb, route, operation) =>
    found.push({
      operation: Object.assign({ tags: ['henri'] }, operation),
      route,
      verb,
    });

  if (!context.hasUserModel) {
    return healthEndpoints(add, found);
  }

  add('post', user.loginPath, {
    operationId: 'henri.login',
    summary: 'Sign in',
    description:
      'Opens a session (passport `local`). A browser is redirected to `config.user.afterLogin`; a client asking for JSON gets the user. Failures are counted per address and the account locks out (`config.user.lockout`).',
    parameters: csrf,
    requestBody: {
      required: true,
      content: {
        [JSON_MEDIA]: { schema: { $ref: '#/components/schemas/Credentials' } },
        'application/x-www-form-urlencoded': {
          schema: { $ref: '#/components/schemas/Credentials' },
        },
      },
    },
    responses: {
      200: json(
        {
          type: 'object',
          properties: { user: publicUser },
          required: ['user'],
        },
        'The session is open.'
      ),
      400: { $ref: '#/components/responses/BadRequest' },
      401: { $ref: '#/components/responses/Unauthorized' },
      403: json(
        { $ref: '#/components/schemas/Error' },
        'The address has not been confirmed (`config.user.confirmation.required`); `data.reason` is `unconfirmed`.'
      ),
      429: { $ref: '#/components/responses/TooManyRequests' },
      default: errors,
    },
    'x-henri': { answer: 'session', known: true, source: 'built-in' },
  });

  add('post', '/logout', {
    operationId: 'henri.logout',
    summary: 'Sign out',
    description:
      'Destroys the session and clears the cookie. A browser is redirected to `/`.',
    parameters: csrf,
    responses: {
      200: json(
        {
          type: 'object',
          properties: { ok: { const: true } },
          required: ['ok'],
        },
        'The session is gone.'
      ),
      default: errors,
    },
    'x-henri': { answer: 'session', known: true, source: 'built-in' },
  });

  add('get', '/logout', {
    operationId: 'henri.logout.get',
    summary: 'Sign out (deprecated)',
    description:
      'Deprecated and inert: it answers 405 and destroys nothing, because a link, a prefetch or an image tag would otherwise sign a person out. Use `POST /logout`.',
    responses: {
      405: Object.assign(
        json(
          { $ref: '#/components/schemas/Error' },
          'Always. The `Allow` header names the method to use.'
        ),
        {
          headers: {
            Allow: { description: '`POST`.', schema: { type: 'string' } },
          },
        }
      ),
      default: errors,
    },
    'x-henri': { answer: 'error', known: true, source: 'built-in' },
  });

  if (accounts.signup.enabled) {
    add('post', accounts.signup.path, {
      operationId: 'henri.signup',
      summary: 'Register',
      description: `Creates an account and, unless \`login\` is off, opens a session. The fields it reads are \`email\`, \`password\` and \`config.user.signup.fields\`${
        accounts.signup.fields.length > 0
          ? ` (${accounts.signup.fields.map((field) => `\`${field}\``).join(', ')})`
          : ''
      }.`,
      parameters: csrf,
      requestBody: {
        required: true,
        content: {
          [JSON_MEDIA]: {
            schema: { $ref: '#/components/schemas/Registration' },
          },
          'application/x-www-form-urlencoded': {
            schema: { $ref: '#/components/schemas/Registration' },
          },
        },
      },
      responses: {
        201: json(
          {
            type: 'object',
            properties: { user: publicUser },
            required: ['user'],
          },
          'The account was created.'
        ),
        422: { $ref: '#/components/responses/ValidationFailed' },
        429: { $ref: '#/components/responses/TooManyRequests' },
        default: errors,
      },
      'x-henri': { answer: 'session', known: true, source: 'built-in' },
    });
  }

  if (accounts.passwordReset.enabled) {
    const base = accounts.passwordReset.path;

    add('post', `${base}/forgot`, {
      operationId: 'henri.password.forgot',
      summary: 'Ask for a password reset',
      description:
        'Always answers the same sentence, whether or not the address has an account, and mails the link afterwards: nothing a client can measure says who is registered.',
      parameters: csrf,
      requestBody: {
        required: true,
        content: {
          [JSON_MEDIA]: {
            schema: {
              type: 'object',
              properties: { email: { type: 'string', format: 'email' } },
              required: ['email'],
            },
          },
        },
      },
      responses: {
        202: json(
          {
            type: 'object',
            properties: { message: { type: 'string' }, ok: { const: true } },
            required: ['ok', 'message'],
          },
          'Accepted, whatever the address was.'
        ),
        422: { $ref: '#/components/responses/ValidationFailed' },
        429: { $ref: '#/components/responses/TooManyRequests' },
        default: errors,
      },
      'x-henri': { answer: 'acknowledgement', known: true, source: 'built-in' },
    });

    add('get', `${base}/reset/:token`, {
      operationId: 'henri.password.open',
      summary: 'Open a password reset link',
      description:
        'Checks the token and moves it out of the url into the session, so the form posts without it. A browser is redirected to the form.',
      responses: {
        200: json(
          {
            type: 'object',
            properties: { ok: { const: true } },
            required: ['ok'],
          },
          'The link is valid.'
        ),
        400: { $ref: '#/components/responses/BadRequest' },
        default: errors,
      },
      'x-henri': { answer: 'acknowledgement', known: true, source: 'built-in' },
    });

    add('post', `${base}/reset`, {
      operationId: 'henri.password.reset',
      summary: 'Set a new password',
      description:
        'Uses the token of the session, or the one in the body. Every other session of that account is retired.',
      parameters: csrf,
      requestBody: {
        required: true,
        content: {
          [JSON_MEDIA]: {
            schema: {
              type: 'object',
              properties: {
                password: { type: 'string' },
                token: { type: 'string' },
              },
              required: ['password'],
            },
          },
        },
      },
      responses: {
        200: json(
          {
            type: 'object',
            properties: { ok: { const: true }, user: publicUser },
            required: ['ok'],
          },
          'The password was changed.'
        ),
        400: { $ref: '#/components/responses/BadRequest' },
        422: { $ref: '#/components/responses/ValidationFailed' },
        default: errors,
      },
      'x-henri': { answer: 'session', known: true, source: 'built-in' },
    });
  }

  if (accounts.confirmation.enabled) {
    const base = accounts.confirmation.path;

    add('get', `${base}/:token`, {
      operationId: 'henri.confirm',
      summary: 'Confirm an address',
      description: 'Consumes the confirmation token of a mail link.',
      responses: {
        200: json(
          {
            type: 'object',
            properties: { ok: { const: true }, user: publicUser },
            required: ['ok'],
          },
          'The address is confirmed.'
        ),
        400: { $ref: '#/components/responses/BadRequest' },
        default: errors,
      },
      'x-henri': { answer: 'acknowledgement', known: true, source: 'built-in' },
    });

    add('post', base, {
      operationId: 'henri.confirm.resend',
      summary: 'Ask for a confirmation link',
      description:
        'The same sentence whatever the address, for the same reason as the password reset.',
      parameters: csrf,
      requestBody: {
        required: false,
        content: {
          [JSON_MEDIA]: {
            schema: {
              type: 'object',
              properties: { email: { type: 'string', format: 'email' } },
            },
          },
        },
      },
      responses: {
        202: json(
          {
            type: 'object',
            properties: { message: { type: 'string' }, ok: { const: true } },
            required: ['ok', 'message'],
          },
          'Accepted, whatever the address was.'
        ),
        422: { $ref: '#/components/responses/ValidationFailed' },
        default: errors,
      },
      'x-henri': { answer: 'acknowledgement', known: true, source: 'built-in' },
    });

    add('post', accounts.confirmation.emailPath, {
      operationId: 'henri.account.email',
      summary: 'Change the address of the account',
      description:
        'Sends a confirmation link to the new address; the account keeps the old one until the link is followed. The current password is asked for unless `requirePassword` is off.',
      parameters: csrf,
      requestBody: {
        required: true,
        content: {
          [JSON_MEDIA]: {
            schema: {
              type: 'object',
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string' },
              },
              required: ['email'],
            },
          },
        },
      },
      responses: {
        202: json(
          {
            type: 'object',
            properties: { message: { type: 'string' }, ok: { const: true } },
            required: ['ok'],
          },
          'The link is on its way to the new address.'
        ),
        401: { $ref: '#/components/responses/Unauthorized' },
        422: { $ref: '#/components/responses/ValidationFailed' },
        default: errors,
      },
      security: [{ session: [] }, { bearer: [] }],
      'x-henri': { answer: 'acknowledgement', known: true, source: 'built-in' },
    });
  }

  return healthEndpoints(add, found);
}

/**
 * The liveness and readiness probes, which every application answers
 *
 * @param {function} add pushes an endpoint
 * @param {Array<object>} found the endpoints so far
 * @returns {Array<object>} the endpoints
 */
function healthEndpoints(add, found) {
  const health = { $ref: '#/components/schemas/Health' };
  const probe = (id, route, summary, description, ready) =>
    add('get', route, {
      operationId: id,
      summary,
      description,
      responses: Object.assign(
        {
          200: {
            description: ready
              ? 'The process can serve traffic.'
              : 'The process answers.',
            content: { [JSON_MEDIA]: { schema: health } },
          },
        },
        ready
          ? {
              503: {
                description:
                  'The boot is not finished, the process is draining, or a store did not answer.',
                content: { [JSON_MEDIA]: { schema: health } },
              },
            }
          : {},
        { default: { $ref: '#/components/responses/Error' } }
      ),
      'x-henri': { answer: 'health', known: true, source: 'built-in' },
    });

  probe(
    'henri.health.live',
    '/livez',
    'Liveness',
    'Answers 200 as long as the process can answer at all. It never touches a store: a failed liveness probe restarts the container, which fixes nothing when the database is what is down.',
    false
  );
  probe(
    'henri.health.ready',
    '/readyz',
    'Readiness',
    'Pings every store. 503 while the boot is running, while the process drains, and when a store does not answer.',
    true
  );
  probe(
    'henri.health.healthz',
    '/healthz',
    'Readiness (older name)',
    'The same answer as `/readyz`. The name is the ambiguous one -- it says "health" without saying which of the two questions it answers -- so henri answers readiness here and leaves it to whatever cannot be configured.',
    true
  );
  probe(
    'henri.health.henri',
    '/_henri/health',
    'Readiness (the name henri answered before)',
    'The same answer as `/readyz`, under the name henri had before it had two, so a deployment already pointing here keeps working.',
    true
  );

  return found;
}

/**
 * The schemas the built-in endpoints need
 *
 * @param {object} context the builder context
 * @returns {object} the schemas
 */
function builtinSchemas(context) {
  const { settings } = context;

  if (!context.hasUserModel) {
    return {};
  }

  const fields = {};

  for (const field of settings.accounts.signup.fields) {
    fields[field] = {};
  }

  return {
    Credentials: {
      type: 'object',
      description: 'What `POST /login` reads.',
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
      },
      required: ['email', 'password'],
    },
    Registration: {
      type: 'object',
      description:
        'What `POST` on the signup path reads: the address, the password and the fields `config.user.signup.fields` names. Anything else is dropped.',
      properties: Object.assign(
        {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
        fields
      ),
      required: ['email', 'password'],
    },
  };
}

/**
 * What the description says about itself, in `info.description`
 *
 * @param {object} settings the settings
 * @returns {string} the text
 */
function overview(settings) {
  return [
    'Generated by `henri openapi` from the routes, the models and the configuration of this application. It is not hand-written and it is not a contract: it describes the answers henri produces itself and says so, in plain words, wherever it cannot.',
    'The same routes serve the pages and the JSON API. A client gets JSON by asking for it: `Accept: application/json`, `application/hal+json`, or `application/vnd.henri.v1+json` for a route that declares a version. Anything else -- a browser, `*/*` -- gets the page.',
    `Every answer carries \`X-Request-Id\`. Every mutating route honours \`Idempotency-Key\` unless it opted out. Requests are rate limited (${
      settings.rateLimit
        ? 'on, not enforced in development'
        : 'off by configuration'
    }) and time out. A failure henri answers itself uses one envelope, \`Error\`, with a henri error code when henri raised it.`,
    'Identifiers are public: a record leaves the server with its `externalId` (a uuid), never its primary key, and a declared foreign key leaves as the `externalId` of the row it names (`base/references.js`).',
    settings.graphql
      ? `GraphQL is served at \`${settings.graphql}\` and is not described here: it has a schema of its own.`
      : 'GraphQL is not described here: it has a schema of its own.',
  ].join('\n\n');
}

/**
 * The OpenAPI 3.1 description of an application
 *
 * @param {object} input what to describe
 * @param {?object} [input.accepts=null] what each action declared it accepts,
 *   compiled, as `{ 'tasks#index': rules }` -- `henri.controllers.accepts()`
 *   on a booted application, `declarations()` over the controller files
 *   otherwise. An entry that is `null` is a controller whose declaration
 *   could not be read; a missing entry is one that declares nothing; `null`
 *   for the whole map is a caller that could not find out at all
 * @param {*} [input.config={}] henri's config module, or the plain object a
 *   command read from `config/<env>.json`
 * @param {Array<object>} [input.models=[]] the model files, with `globalId`
 *   and `identity` set (what `henri.model.models` holds)
 * @param {Array<object>} [input.routes=[]] the expanded routes (base/routes.js)
 * @param {?object} [input.actions=null] which `controller#action` exist, as
 *   `{ 'tasks#index': true }`; null when the caller could not find out
 * @param {?Array<string>} [input.policies=null] the names of `app/policies`,
 *   so a route asking for one that does not exist is reported; null when the
 *   caller could not find out
 * @param {object} [input.info={}] `title`, `version` and `description`
 * @param {Array<object>} [input.servers] the servers, when the caller knows
 *   better than the configuration
 * @returns {object} the document
 */
function build({
  accepts = null,
  actions = null,
  config = {},
  info = {},
  models = [],
  policies = null,
  routes = [],
  servers = null,
} = {}) {
  const settings = settingsOf(config);
  const files = Array.isArray(models) ? models.filter(Boolean) : [];
  const findModel = modelFinder(files);
  const userModel = files.find(
    (model) =>
      String(model.identity || '').toLowerCase() ===
      String(settings.user.model || '').toLowerCase()
  );
  const findPolicy = policyFinder(policies);
  const privacy = mapOf(files, {
    settings: settings.privacy,
    subject: userModel ? userModel.globalId : null,
  });
  const hidden = new Set(privacy.private);
  const unread = new Set();
  const context = {
    actionKnown: (controller) =>
      actions === null ? null : Boolean(actions[controller]),
    /**
     * What an action declared it accepts, and whether henri got to read it
     *
     * @param {string} controller the `controller#action` key
     * @returns {{read: boolean, rules: ?object}} the declaration
     */
    declared: (controller) => {
      if (!accepts || typeof accepts !== 'object') {
        unread.add(controller);

        return { read: false, rules: null };
      }

      if (!Object.prototype.hasOwnProperty.call(accepts, controller)) {
        return { read: true, rules: null };
      }

      const written = accepts[controller];

      if (!written || typeof written !== 'object') {
        unread.add(controller);

        return { read: false, rules: null };
      }

      const rules = objectOf(written);

      return {
        read: true,
        rules: Object.keys(rules).length > 0 ? rules : null,
      };
    },
    findModel,
    findPolicy,
    hasUserModel: Boolean(userModel),
    hidden,
    ids: new Set(),
    models: files,
    resolves: (name) => {
      const target = files.find(
        (model) => String(model.globalId) === String(name)
      );

      return Boolean(target && objectOf(target.options).externalId !== false);
    },
    securitySchemes: Boolean(userModel),
    settings,
  };
  const paths = {};
  const tags = [];
  const coverage = { described: 0, operations: 0, unknown: 0 };
  const excluded = [];

  /**
   * Files one operation under its path
   *
   * @param {string} verb the http verb
   * @param {string} route the express path
   * @param {object} operation the operation object
   * @returns {void}
   */
  const file = (verb, route, operation) => {
    const { names, path } = template(route);
    const declared = new Set(
      (operation.parameters || [])
        .filter((parameter) => parameter && parameter.in === 'path')
        .map((parameter) => parameter.name)
    );

    // A path template names a variable, so the operation has to declare it:
    // a built-in endpoint carrying a `:token` gets its parameter here
    for (const name of names) {
      if (!declared.has(name)) {
        operation.parameters = (operation.parameters || []).concat({
          name,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        });
        declared.add(name);
      }
    }

    paths[path] = paths[path] || {};
    paths[path][verb] = operation;
    coverage.operations += 1;

    if (operation['x-henri'] && operation['x-henri'].known === true) {
      coverage.described += 1;
    } else {
      coverage.unknown += 1;
    }

    for (const tag of operation.tags || []) {
      if (!tags.some((entry) => entry.name === tag)) {
        tags.push({
          description:
            tag === 'henri'
              ? 'The endpoints henri mounts itself: the session, the account flows and the health probes.'
              : `app/controllers/${tag}.js`,
          name: tag,
        });
      }
    }
  };

  for (const route of routes) {
    if (!route || typeof route.controller !== 'string') {
      continue;
    }

    if (!METHODS.has(route.verb)) {
      excluded.push({
        reason: 'OpenAPI has no path item field for this verb',
        route: `${route.verb} ${route.route}`,
      });

      continue;
    }

    file(route.verb, route.route, operationFor(route, context));
  }

  for (const endpoint of builtins(context)) {
    const { path } = template(endpoint.route);

    if (paths[path] && paths[path][endpoint.verb]) {
      // The application declared this path itself: what it wrote wins, the
      // way express takes the first handler that answers
      continue;
    }

    file(endpoint.verb, endpoint.route, endpoint.operation);
  }

  const components = {
    schemas: Object.assign(schemasOf(context), builtinSchemas(context)),
    responses: responsesOf(settings),
    parameters: parametersOf(settings),
  };

  if (context.securitySchemes) {
    components.securitySchemes = {
      session: {
        type: 'apiKey',
        in: 'cookie',
        name: 'henri.sid',
        description:
          'The session cookie of `POST /login`. A mutating request carrying it must also send the CSRF token.',
      },
      bearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'A token the application signed, read by the passport `jwt` strategy. A request authenticated this way carries no cookie, so the CSRF check does not apply to it.',
      },
    };
  }

  return prune({
    openapi: OPENAPI_VERSION,
    jsonSchemaDialect: DIALECT,
    info: {
      title: info.title || 'henri application',
      version: info.version || '0.0.0',
      description: [info.description, overview(settings)]
        .filter(Boolean)
        .join('\n\n'),
      'x-henri': prune({
        coverage,
        excluded: excluded.length > 0 ? excluded : undefined,
        generator: 'henri openapi',
        models: files.map((model) => String(model.globalId)).sort(),
        // The one place the two ways of building this document can differ:
        // an action whose controller could not be read declares whatever it
        // declares, and this document does not say so anywhere else
        params:
          unread.size > 0 ? { unread: Array.from(unread).sort() } : undefined,
      }),
    },
    servers: servers || serversOf(settings),
    tags,
    security: [],
    paths,
    components,
  });
}

module.exports = {
  DIALECT,
  GENERATED,
  OPENAPI_VERSION,
  build,
  columnsOf,
  referenceOf,
  ruleSchema,
  settingsOf,
  template,
};
