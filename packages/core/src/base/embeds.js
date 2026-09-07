/**
 * `_embedded`: a record's relations, in the answer that already holds it.
 *
 * henri answers HAL, and it has always answered half of it. `_links` says
 * where a client may go next (`base/hateoas.js`); `_embedded` is the other
 * half, and without it a client that wants an invoice and its lines makes
 * two requests, and a page of twenty invoices makes twenty one. That is the
 * client-side N+1 `_embedded` exists to prevent.
 *
 * ```js
 * // app/controllers/invoices.js
 * module.exports = {
 *   embeds: {
 *     show: {
 *       customer: 'customerId',
 *       lines: { limit: 200, through: 'Line.invoiceId' },
 *     },
 *     index: { customer: 'customerId' },
 *   },
 *
 *   show: async (req, res) => res.resource(req.invoice, { embed: ['lines'] }),
 * };
 * ```
 *
 * ```json
 * {
 *   "_links": { "self": { "href": "/invoices/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11" } },
 *   "externalId": "0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11",
 *   "amount": "129.90",
 *   "_embedded": {
 *     "lines": [{ "externalId": "0199a5c2-8d21-7b04-9f3e-6c2b0d7a1e55", "label": "Seat" }]
 *   }
 * }
 * ```
 *
 * A relation is written as the foreign key it goes through, because that is
 * the only thing henri can check: `'customerId'` is a key **this** model
 * declared, and the record it names is embedded; `'Line.invoiceId'` is a key
 * another model declared **at** this one, and the records naming it are.
 * Both have to be declared references -- `belongsTo()`, `references: {
 * model }`, Mongoose's `ref` -- and anything else fails the boot, for the
 * reason `base/references.js` gives at length: henri reads no field name to
 * decide what points where.
 *
 * ## The exit gate is the same gate
 *
 * This is the part that had to be got right, and the way it is got right is
 * by refusing to build a second path. An embedded record is **not**
 * serialized on its own: the children are handed to the same `toPublic()`
 * call as the records they hang off, in one list, so
 *
 * - `publish()` walks them like any other record. They are live model
 *   instances, so their own foreign keys leave as the `externalId` of the
 *   row they name and their primary keys do not leave at all
 *   (`base/references.js`);
 * - `henri.privacy.strip()` runs over the whole tree afterwards, so a
 *   column marked `personal: { expose: false }` is no more reachable
 *   through `_embedded` than through the record itself
 *   (`base/privacy.js`);
 * - the `externalId` lookups of the parents and of the children are
 *   **batched together**, one statement per target model for the whole
 *   answer rather than one per record.
 *
 * There is no `embed` that skips either pass, because there is nowhere for
 * such a thing to be written: `_embedded` is assembled out of what
 * `toPublic()` handed back, by index.
 *
 * The one consequence worth stating plainly: an embedded record answers
 * what `res.resource()` of that record would answer. Embedding the user
 * model hands over the user row as the model left it, not the
 * `publicUser()` shape -- because a second, stricter rule for one model
 * would be a *different* gate, and the promise here is that it is the same
 * one. A field that must not leave says so on the model, where every other
 * answer already reads it.
 *
 * ## The policy is asked per record
 *
 * Twenty embedded lines are twenty more records, each with an answer of its
 * own. Each one is asked `show` against **its own model's policy**, by the
 * rule `_links` already follows (`3.policies.js`, `links()`): a model with
 * a policy is asked about every record; a model with no policy at all is
 * not asked, because that application has not opted into record-level
 * authorization for it and `res.collection(await Line.find())` would have
 * answered the same rows.
 *
 * **A record the policy refuses is absent.** Not a stub, not a `null`, not
 * a `_links` skeleton: absent. `_embedded` is a cache of the request the
 * client would otherwise have made; that request would have been a 404
 * (`config.policies.status`), and a 404 carries nothing -- so nothing is
 * what a refused record contributes. A stub would say "there is a record
 * here you may not read", which is the existence oracle `findById()` was
 * made strict to close.
 *
 * ## What a client may ask, and what stops it
 *
 * `?embed=lines,customer`, and nothing else. The list is the action's
 * declaration and there is no wildcard: a name the action did not declare
 * is a **422 before the action runs**, through the same answer a filter
 * gets (`base/filters.js`). That is the position `params`, `answers` and
 * `filters` all take -- what is not declared does not happen -- and it is
 * what stops a client embedding its way from a table it may read to one it
 * may not: there is no path from `?embed=` to a relation nobody wrote down,
 * and the relations that were written down are checked one record at a time
 * by the policy of the model they belong to.
 *
 * An action that declares **no** embeds has no such surface at all: the
 * middleware is not mounted, so `?embed=` there is a query parameter
 * nothing reads, exactly like a `?filter[...]` on an action with no
 * `filters`. Nothing is embedded either way, and the cost of saying so
 * would be a middleware on every route of the application.
 *
 * The caller's word wins over the client's, because `embed` is the caller's
 * word: `res.resource(record, { embed: ['lines'] })` sends those relations
 * whatever the query string said, and `embed: []` is the explicit "none".
 * Without the option, the answer carries what the client asked for.
 *
 * ## What it costs
 *
 * **One statement per embedded relation per answer**, whatever the page
 * size -- the shape `base/references.js` uses for its own lookups. Twenty
 * invoices embedding their lines is one query for the twenty, not twenty:
 * the parents' keys are collected, deduplicated and asked for once, then
 * the rows are grouped in memory. On the three adapters that is
 * `findAll({ where: { invoiceId: [...] } })` (Sequelize),
 * `find({ invoiceId: { $in: [...] } })` (Mongoose) and the same condition
 * through the relation api (Drizzle); the condition and the order are
 * built by `base/filters.js`, which already spells all three and is tested
 * against all three.
 *
 * henri does **not** reuse an association the controller eager loaded
 * (`include('lines')`, `populate('lines')`). It looks like free rows and it
 * is not: an eager loaded list honours neither the `limit` this module
 * promises nor the order it promises, and the identity check
 * `base/references.js` makes for a single key does not generalise to a set
 * -- a presenter that put the wrong rows under `lines` would have them
 * published as the record's own. So the relation is loaded here, once, and
 * a controller that eager loaded it as well pays for both.
 *
 * ## The bound, and what happens at it
 *
 * A to-many relation is capped per parent: `limit` on the declaration, or
 * `config.api.maxEmbedded` (25) when it names none. The rows come back
 * ordered by the foreign key and then by the target's `externalId` -- a
 * uuid v7, so that is creation order and the prefix a client gets is the
 * same prefix twice -- and the query asks for one row more than the whole
 * answer may hold, so a relation bigger than what was promised cannot make
 * the read unbounded. Which records went past their own limit is then
 * exact, because the rows are grouped by the key they carry; a query that
 * reached its own ceiling is reported too, because a record at the end of
 * the page may have been starved of rows henri never read.
 *
 * `limit` is a promise the application makes about its data: *this relation
 * has at most this many rows per record*. A relation that breaks it is
 * reported once per route (`pen.warn`) and the client is served the prefix.
 * It is deliberately **not** refused, even under `config.api.strict`: the
 * answer is already built by then, and a request that fails because a
 * customer has twenty six invoices instead of twenty five turns a cosmetic
 * mistake into an outage -- the reason `base/answers.js` gives for checking
 * shapes on the way out and never values.
 *
 * A relation that genuinely needs paging is a collection, and a collection
 * has an endpoint of its own.
 *
 * ## Deliberately not here
 *
 * - **`_links` on an embedded record.** henri builds a link out of a route
 *   helper it can name, and nothing declares which controller serves a
 *   model -- the router maps controllers to routes, not models to routes. A
 *   guessed href is worse than none, so an embedded record carries its
 *   `externalId` and the client composes the url it already knows.
 * - **Nesting.** `?embed=lines.product` is one more query per level and one
 *   more policy question per record per level, and depth is where a client
 *   turns a cheap answer into an expensive one. One level.
 * - **`res.render()`.** `_embedded` is a HAL word. A page gets its records
 *   from the controller, which puts them where the view wants them.
 * - **Filtering or ordering an embedded relation from the query string.**
 *   That is `base/filters.js`, on the relation's own endpoint.
 *
 * @module base/embeds
 */

const { conditionFor, orderFor } = require('./filters');
const { EXTERNAL_ID } = require('./external-id');
const { fail } = require('./errors');
const {
  findRecords,
  hasColumn,
  ormFor: modelFor,
  primaryOf,
} = require('./records');
const { refuse } = require('./params-schema');

/** The code the failures of this module carry when a model cannot be read */
const ADAPTER = 'HENRI_EMBED_ADAPTER_UNSUPPORTED';

/** The controller exports that are never actions (see base/hooks.js) */
const RESERVED = new Set(['embeds']);

/** The failure a request gets when it asks for something undeclared */
const CODE = 'HENRI_EMBED_INVALID';

/** What that answer says before the per-name messages */
const MESSAGE = 'the embeds are invalid';

/** The query parameter carrying what a client wants embedded */
const PARAM = 'embed';

/** Every key the object form of a relation may hold */
const KEYS = ['limit', 'one', 'through'];

/** What `config.api` says about embeds when the application says nothing */
const DEFAULTS = Object.freeze({ maxEmbedded: 25, maxEmbeds: 3 });

/**
 * Is this a plain object (a declaration, a relation)?
 *
 * @param {*} value anything
 * @returns {boolean} true for a plain object
 */
function isObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/**
 * The failure a wrong declaration raises, naming where it is
 *
 * @param {string} where the controller, or the controller and action
 * @param {string} what what is wrong
 * @param {?string} [hint=null] what to do about it
 * @returns {Error} the error to throw
 */
function invalid(where, what, hint = null) {
  return fail(
    'HENRI_EMBED_DECLARATION_INVALID',
    `${where} ${what}`,
    hint ? { hint } : {}
  );
}

/**
 * The action names a selector key stands for: the selectors `before`,
 * `params`, `answers` and `filters` already use
 *
 * @param {string} key the key of the `embeds` block
 * @returns {?Array<string>} the actions, or null for every action
 */
function selects(key) {
  const names = String(key)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  if (names.length === 1 && (names[0] === 'all' || names[0] === '*')) {
    return null;
  }

  return names;
}

/**
 * The `Model.field` a `through` names, split rather than matched.
 *
 * A declaration is written by hand and read at boot, and there is no
 * pattern here worth a regular expression (see base/exact.js).
 *
 * @param {string} written what `through` holds
 * @returns {?{field: string, model: string}} the column, or null
 */
function columnOf(written) {
  const parts = String(written).split('.');

  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    return null;
  }

  return { field: parts[1].trim(), model: parts[0].trim() };
}

/**
 * Normalizes and checks one relation, without the models (they load later)
 *
 * @param {*} written what the controller wrote
 * @param {string} where the controller and action (`invoices#show`)
 * @param {string} name the relation name
 * @returns {object} the compiled relation
 * @throws {Error} HENRI_EMBED_DECLARATION_INVALID
 */
function relation(written, where, name) {
  if (typeof written !== 'string' && !isObject(written)) {
    throw invalid(
      where,
      `embeds "${name}" as ${written === null ? 'null' : typeof written}: a ` +
        'relation is the foreign key it goes through, or an object holding one',
      "customer: 'customerId' embeds the record a key names; lines: { through: 'Line.invoiceId' } embeds the records naming this one"
    );
  }

  const source = typeof written === 'string' ? { through: written } : written;
  const compiled = {};

  for (const [key, value] of Object.entries(source)) {
    if (!KEYS.includes(key)) {
      throw invalid(
        where,
        `embeds "${name}" with the unknown key "${key}": a relation takes ${KEYS.join(', ')}`
      );
    }

    compiled[key] = value;
  }

  if (typeof compiled.through !== 'string' || compiled.through.trim() === '') {
    throw invalid(
      where,
      `embeds "${name}" without saying what it goes through`,
      "A relation names a declared foreign key: 'customerId' for the record it points at, 'Line.invoiceId' for the records pointing back"
    );
  }

  return finish(compiled, where, name);
}

/**
 * The checks a compiled relation goes through before the models are read
 *
 * @param {object} compiled the relation
 * @param {string} where the controller and action
 * @param {string} name the relation name
 * @returns {object} the relation, frozen
 * @throws {Error} HENRI_EMBED_DECLARATION_INVALID
 */
function finish(compiled, where, name) {
  const through = compiled.through.trim();
  const column = through.includes('.') ? columnOf(through) : null;

  if (through.includes('.') && !column) {
    throw invalid(
      where,
      `embeds "${name}" through ${JSON.stringify(through)}, which is not \`Model.field\``
    );
  }

  if ('one' in compiled && typeof compiled.one !== 'boolean') {
    throw invalid(where, `embeds "${name}" with a "one" that is not a boolean`);
  }

  if (!column && compiled.one === false) {
    throw invalid(
      where,
      `embeds "${name}" through a foreign key of its own with \`one: false\`: a key names one row`
    );
  }

  const many = Boolean(column) && compiled.one !== true;

  if ('limit' in compiled) {
    if (!Number.isInteger(compiled.limit) || compiled.limit < 1 || !many) {
      throw invalid(
        where,
        `embeds "${name}" with a "limit" of ${JSON.stringify(compiled.limit)}`,
        'A limit is a whole number above zero, and only the many side of a relation takes one'
      );
    }
  }

  return Object.freeze({
    // The column the rows are grouped by: a key of this model when it names
    // one row, a key of the other model when it names many
    field: column ? column.field : through,
    kind: many ? 'many' : 'one',
    limit: typeof compiled.limit === 'number' ? compiled.limit : null,
    name,
    // The model holding the key, or null when this one does
    owner: column ? column.model : null,
    through,
  });
}

/**
 * The declarations of a controller, action by action.
 *
 * A selector naming something that is not an action of the controller is a
 * typo that would embed nothing: it fails here instead.
 *
 * @param {object} controller the controller module
 * @param {string} name the controller name (`invoices`, `admin/invoices`)
 * @param {Array<string>} actions the action names of the controller
 * @returns {object} the compiled relations, keyed by action
 * @throws {Error} HENRI_EMBED_DECLARATION_INVALID
 */
function declarations(controller, name, actions) {
  const block = controller && controller.embeds;

  if (typeof block === 'undefined' || block === null) {
    return {};
  }

  if (!isObject(block)) {
    throw invalid(name, 'declares `embeds` as something other than an object');
  }

  for (const [key, relations] of Object.entries(block)) {
    if (!isObject(relations)) {
      throw invalid(
        name,
        `embeds "${key}" with something other than a list of relations`
      );
    }

    for (const action of selects(key) || []) {
      if (!actions.includes(action)) {
        throw invalid(
          name,
          `declares embeds for "${action}", which is not one of its actions (${
            actions.join(', ') || 'it has none'
          })`
        );
      }
    }
  }

  const compiled = {};

  for (const action of actions) {
    let found = null;

    for (const [key, relations] of Object.entries(block)) {
      const only = selects(key);

      if (only === null || only.includes(action)) {
        found = Object.assign({}, found, relations);
      }
    }

    if (!found || Object.keys(found).length === 0) {
      continue;
    }

    compiled[action] = Object.freeze(
      Object.fromEntries(
        Object.entries(found).map(([relationName, written]) => [
          relationName,
          relation(written, `${name}#${action}`, relationName),
        ])
      )
    );
  }

  return compiled;
}

/**
 * Binds one action's relations to the models of the application.
 *
 * This is where a declaration meets what the models actually said. henri
 * reads no field name to decide what a foreign key is, so a relation goes
 * through a key that was **declared** as one, and anything else fails the
 * boot rather than serializing a column nobody said points anywhere.
 *
 * @param {object} relations the compiled relations of one action
 * @param {object} context the context
 * @param {string} context.model the global id of the model the action answers
 * @param {object} context.table the reference table (`henri.model.referenceTable`)
 * @param {string} context.where the controller and action
 * @returns {{model: string, relations: object}} the declaration, bound
 * @throws {Error} HENRI_EMBED_DECLARATION_INVALID
 */
function verify(relations, { model, table, where }) {
  const models = (table && table.models) || {};
  const bound = {};

  for (const [name, compiled] of Object.entries(relations || {})) {
    bound[name] = compiled.owner
      ? backwards(compiled, { entry: models[compiled.owner], model, where })
      : forwards(compiled, { entry: models[model], model, where });
  }

  return Object.freeze({ model, relations: Object.freeze(bound) });
}

/**
 * A relation through a foreign key of this model: the one row it names
 *
 * @param {object} compiled the relation
 * @param {object} context `{ entry, model, where }`
 * @returns {object} the bound relation
 * @throws {Error} HENRI_EMBED_DECLARATION_INVALID
 */
function forwards(compiled, { entry, model, where }) {
  const declared = (entry && entry.references) || {};
  const found = declared[compiled.field];

  if (!found) {
    const names = Object.keys(declared).sort().join(', ');

    throw invalid(
      where,
      `embeds "${compiled.name}" through ${model}.${compiled.field}, which is not a foreign key ${model} declared`,
      names
        ? `${model} declares ${names}`
        : `${model} declares no foreign key: say where the column points (references: { model: 'User' } on a SQL adapter, ref: 'User' on mongoose)`
    );
  }

  return Object.freeze({ ...compiled, target: found.target });
}

/**
 * A relation through a foreign key of another model: the rows naming this
 * one
 *
 * @param {object} compiled the relation
 * @param {object} context `{ entry, model, where }`
 * @returns {object} the bound relation
 * @throws {Error} HENRI_EMBED_DECLARATION_INVALID
 */
function backwards(compiled, { entry, model, where }) {
  if (!entry) {
    throw invalid(
      where,
      `embeds "${compiled.name}" through ${compiled.through}, and ${compiled.owner} is not a model of this application`
    );
  }

  const found = (entry.references || {})[compiled.field];

  if (!found || found.target !== model) {
    throw invalid(
      where,
      `embeds "${compiled.name}" through ${compiled.through}, which does not name ${model}`,
      `A relation goes through a declared foreign key: ${compiled.owner}.${compiled.field} has to point at ${model} (references: { model: '${model}' } on a SQL adapter, ref: '${model}' on mongoose)`
    );
  }

  return Object.freeze({ ...compiled, target: compiled.owner });
}

/**
 * The relation names one request asked for, split rather than matched
 *
 * @param {*} value what `?embed=` carried, or what the caller passed
 * @returns {Array<string>} the names, in order, deduplicated
 */
function asked(value) {
  const raw = Array.isArray(value) ? value : [value];
  const names = [];

  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue;
    }

    for (const name of entry.split(',')) {
      const trimmed = name.trim();

      if (trimmed !== '' && !names.includes(trimmed)) {
        names.push(trimmed);
      }
    }
  }

  return names;
}

/**
 * What one request may embed: the names it asked for, checked against the
 * declaration and against `config.api.maxEmbeds`
 *
 * @param {object} declaration the bound declaration of the action
 * @param {Express.Request} req the request
 * @param {object} limits `{ maxEmbeds }`
 * @returns {{errors: object, names: Array<string>}} the names, and what is wrong
 */
function read(declaration, req, limits) {
  const query = (req && req.query) || {};
  const names = asked(query[PARAM]);
  const relations = (declaration && declaration.relations) || {};
  const errors = {};
  const known = Object.keys(relations);

  if (names.length > limits.maxEmbeds) {
    errors[PARAM] =
      `asks for ${names.length} relations and at most ${limits.maxEmbeds} may be embedded at once`;

    return { errors, names: [] };
  }

  for (const name of names) {
    if (!relations[name]) {
      errors[`${PARAM}[${name}]`] =
        `cannot be embedded (${known.length > 0 ? `this action embeds ${known.slice().sort().join(', ')}` : 'this action embeds nothing'})`;
    }
  }

  return { errors, names };
}

/**
 * The middleware checking one action's embeds.
 *
 * It runs where the parameter and filter checks run -- behind the role and
 * policy guards, ahead of the `before` hooks -- so a request that may not
 * reach the action is never told what it could have embedded.
 *
 * @param {object} declaration the bound declaration
 * @param {function(): object} limits answers `{ maxEmbeds }`
 * @returns {function} express middleware
 */
function guard(declaration, limits) {
  return (req, res, next) => {
    const result = read(declaration, req, limits());

    if (Object.keys(result.errors).length > 0) {
      return refuse(req, res, result.errors, { code: CODE, message: MESSAGE });
    }

    req._embeds = { declaration, names: result.names };

    return next();
  };
}

/**
 * The relations one answer embeds: what the caller named, or what the
 * client asked for when the caller named nothing.
 *
 * @param {Express.Request} req the request
 * @param {*} option the `embed` option of `res.resource()`
 * @param {string} where the call being made (`res.resource`)
 * @returns {{declaration: ?object, names: Array<string>}} the relations
 * @throws {Error} HENRI_EMBED_DECLARATION_INVALID when the caller names
 *   something the action did not declare
 */
function wanted(req, option, where) {
  const state = (req && req._embeds) || null;
  const declaration = state ? state.declaration : null;

  if (typeof option === 'undefined') {
    return { declaration, names: state ? state.names : [] };
  }

  const relations = (declaration && declaration.relations) || {};
  const names = asked(option);
  const unknown = names.filter((name) => !relations[name]);

  if (unknown.length > 0) {
    const known = Object.keys(relations).slice().sort().join(', ');

    throw invalid(
      where,
      `embeds ${unknown.slice().sort().join(', ')}, which this action did not declare`,
      known
        ? `It declares ${known}`
        : "Say what it embeds: embeds: { show: { lines: { through: 'Line.invoiceId' } } }"
    );
  }

  return { declaration, names };
}

/**
 * The key a record is grouped by, as a string.
 *
 * The identity of a row is spelled differently by every adapter -- an
 * ObjectId, a number, a string -- and by both sides of one relation, where
 * a `ref` may be stored as a string next to the ObjectId it names. The only
 * comparison that holds across all of that is the printed one.
 *
 * @param {*} record a record
 * @param {string} field the field
 * @returns {?string} the key, or null when there is none
 */
function keyOf(record, field) {
  const value = record ? record[field] : null;

  return value === null || typeof value === 'undefined' ? null : String(value);
}

/**
 * The order the rows of a relation come back in: the foreign key first, so
 * a page that reaches the cap loses whole records at the end rather than a
 * few rows everywhere, then the target's public identifier -- a uuid v7,
 * which is creation order, and the tiebreaker `base/filters.js` appends to
 * every order it builds for the same reason
 *
 * @param {*} Target the ORM model of the target
 * @param {string} column the foreign key the rows carry
 * @returns {*} the order
 */
function orderOf(Target, column) {
  return orderFor(
    Target,
    [{ column, descending: false, name: column }],
    hasColumn(Target, EXTERNAL_ID) ? EXTERNAL_ID : null
  );
}

/**
 * The most rows of one relation one record may carry
 *
 * @param {object} bound the bound relation
 * @param {object} limits `{ maxEmbedded }`
 * @returns {number} the cap
 */
function capOf(bound, limits) {
  if (bound.kind === 'one') {
    return 1;
  }

  return bound.limit || limits.maxEmbedded;
}

/**
 * Loads one relation for a whole answer: one statement, whatever the number
 * of records it is loading for.
 *
 * @param {Henri} henri the henri instance
 * @param {object} bound the bound relation
 * @param {object} context `{ column, limits, sources }`
 * @returns {Promise<{capped: boolean, rows: Map<string, Array>}>} the rows,
 *   grouped by the key of the record they belong to
 */
async function loadOne(henri, bound, { column, limits, sources }) {
  const Target = modelFor(henri, bound.target, ADAPTER);
  const forward = bound.owner === null;
  const rows = new Map();
  const values = [];
  const seen = new Set();

  for (const source of sources) {
    const value = source ? source[column] : null;

    if (
      value === null ||
      typeof value === 'undefined' ||
      seen.has(String(value))
    ) {
      continue;
    }

    seen.add(String(value));
    values.push(value);
  }

  if (values.length === 0) {
    return { capped: false, rows };
  }

  const matched = forward ? primaryOf(Target) : bound.field;
  const cap = capOf(bound, limits);
  // One row more than the whole answer may hold, so a relation bigger than
  // what the declaration promised cannot make this read unbounded. The
  // forward side needs none: a key names one row
  const limit = forward ? null : values.length * cap + 1;
  const found = await findRecords(
    Target,
    conditionFor(Target, [{ column: matched, operator: 'in', value: values }]),
    { code: ADAPTER, limit, order: forward ? null : orderOf(Target, matched) }
  );

  for (const record of found) {
    const key = keyOf(record, matched);

    if (key === null) {
      continue;
    }

    rows.has(key) || rows.set(key, []);
    rows.get(key).push(record);
  }

  // Two ways the promise was broken, and one warning: a record with more
  // rows than its `limit` (which the grouping says exactly), or a query
  // that reached its own ceiling, where a record at the end of the page may
  // have been starved of rows henri never read
  const capped =
    (limit !== null && found.length >= limit) ||
    [...rows.values()].some((list) => list.length > cap);

  return { capped, rows };
}

/**
 * May this user read these embedded records?
 *
 * The rule `_links` follows, one level down: a model with a policy is asked
 * about every record, a model with none is not asked at all, and a record
 * the policy refuses is absent rather than hinted at.
 *
 * @param {Henri} henri the henri instance
 * @param {Express.Request} req the request
 * @param {Array} records the records
 * @returns {Promise<Array>} the ones that may be sent
 */
async function permitted(henri, req, records) {
  const { policies } = henri;

  if (!policies || records.length === 0) {
    return records;
  }

  const name = policies.nameFor(records[0], {});

  if (!name) {
    return records;
  }

  const user = (req && req.user) || null;
  const kept = [];

  for (const record of records) {
    // Sequential on purpose: a rule is a function of this process, and the
    // list it walks is bounded by the cap above
    const allowed = await policies.answer(user, 'show', record, {
      policy: name,
      req: req || null,
    });

    allowed && kept.push(record);
  }

  return kept;
}

/**
 * Says that a relation held more rows than the declaration promised, once
 * per route and relation
 *
 * @param {Henri} henri the henri instance
 * @param {string} route the route name (`get /invoices`)
 * @param {object} bound the relation
 * @param {number} cap the cap it went past
 * @returns {void}
 */
function report(henri, route, bound, cap) {
  const { api, pen } = henri;
  const key = `embed:${route}:${bound.name}`;

  if (!api || !api.warned || api.warned.has(key)) {
    return;
  }

  api.warned.add(key);
  pen &&
    pen.warn &&
    pen.warn(
      'api',
      `${route} embeds "${bound.name}", which holds more than the ${cap} rows per record it declared: the answer carries the first of them`
    );
}

/**
 * The embed settings of the application
 *
 * @param {Henri} henri the henri instance
 * @returns {{maxEmbedded: number, maxEmbeds: number}} the settings
 */
function settingsOf(henri) {
  const settings = henri && henri.api && henri.api.settings;

  return (settings && settings.embeds) || DEFAULTS;
}

/**
 * Loads and filters everything one answer embeds.
 *
 * What comes back is the live records and a plan: the plan says which of
 * them belongs where, by index, so the caller hands the whole list to one
 * `toPublic()` call and puts the published copies back afterwards. That is
 * what keeps an embedded record on the same path as the record it hangs off
 * -- one publish, one strip, one batch of identifier lookups.
 *
 * @param {Henri} henri the henri instance
 * @param {Express.Request} req the request
 * @param {object} options options
 * @param {object} options.declaration the bound declaration
 * @param {Array<string>} options.names the relations to embed
 * @param {string} options.route the route name, for the report
 * @param {Array} options.sources the records to embed for, in answer order
 * @returns {Promise<{nodes: Array, plans: Array}>} the records and the plan
 */
async function gather(henri, req, { declaration, names, route, sources }) {
  const limits = settingsOf(henri);
  const table = (henri.model && henri.model.referenceTable) || null;
  const classes = (table && table.classes) || new Map();
  // Only a live record of the model the declaration is about: a plain
  // object carries no model and no primary key henri may read, and
  // `subject` is where a controller answering a presentation says which
  // record it is presenting (see base/hateoas.js)
  const records = sources.map((source) =>
    source &&
    typeof source === 'object' &&
    classes.get(source.constructor) === declaration.model
      ? source
      : null
  );
  const nodes = [];
  const plans = sources.map(() => null);
  const primary = primaryOf(modelFor(henri, declaration.model, ADAPTER));

  for (const name of names) {
    const bound = declaration.relations[name];

    if (!bound) {
      continue;
    }

    const column = bound.owner === null ? bound.field : primary;
    // One statement for the whole answer, per relation
    const { capped, rows } = await loadOne(henri, bound, {
      column,
      limits,
      sources: records,
    });
    const cap = capOf(bound, limits);

    capped && report(henri, route, bound, cap);

    for (const [index, source] of records.entries()) {
      if (!source) {
        continue;
      }

      const key = keyOf(source, column);
      const found = (key !== null && rows.get(key)) || [];
      const allowed = await permitted(henri, req, found.slice(0, cap));
      const at = allowed.map((record) => nodes.push(record) - 1);

      plans[index] = plans[index] || {};

      if (bound.kind === 'many') {
        plans[index][name] = at;
      } else if (at.length > 0) {
        plans[index][name] = at[0];
      }
    }
  }

  return { nodes, plans };
}

/**
 * The `_embedded` of one record, from its plan and the published children
 *
 * @param {?object} plan the plan of this record
 * @param {Array} published the published children, in plan order
 * @returns {?object} the `_embedded`, or null when there is nothing in it
 */
function assemble(plan, published) {
  if (!plan) {
    return null;
  }

  const embedded = {};

  for (const [name, at] of Object.entries(plan)) {
    embedded[name] = Array.isArray(at)
      ? at.map((index) => published[index])
      : published[at];
  }

  return Object.keys(embedded).length > 0 ? embedded : null;
}

module.exports = {
  CODE,
  DEFAULTS,
  KEYS,
  MESSAGE,
  PARAM,
  RESERVED,
  asked,
  assemble,
  capOf,
  columnOf,
  declarations,
  gather,
  guard,
  read,
  relation,
  settingsOf,
  verify,
  wanted,
};
