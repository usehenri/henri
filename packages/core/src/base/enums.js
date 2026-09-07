/**
 * What an `enum` column already said, spelled as methods.
 *
 * A model declares the domain of a column and then the application writes
 * the same three strings by hand, everywhere, forever:
 *
 * ```js
 * if (post.status === 'draft') { … }
 * const live = await Post.find({ status: 'live' });
 * ```
 *
 * Rails answers that with `post.draft?`, `Post.live`, `post.archived!` and
 * `Post.statuses`. The declaration is already in the model file, so this is
 * generated behaviour rather than a new concept -- but four methods per
 * value on every model is a real cost, and each of the four has to earn its
 * place separately. Three did not.
 *
 * ## The predicate: `post.isDraft()`
 *
 * The one with no substitute. `post.status === 'darft'` is **silently false
 * for the life of the application**: no adapter, no validation and no test
 * that does not already know the answer will ever say otherwise, because a
 * comparison against a wrong string is a legal comparison. `post.isDarft()`
 * is a `TypeError` on the first run.
 *
 * That asymmetry is the whole argument, and it is worth stating because it
 * is also what kills the bang below: henri already refuses a wrong value
 * where a value is *written*, on every adapter and every write path, since
 * the validations tranche (`base/validations.js`). What it cannot refuse is
 * a wrong value in a *comparison*. So the comparison is the half that gets
 * a method.
 *
 * ## The scope: `Post.live()`, which answers a condition
 *
 * A Rails scope is a relation, and it composes because ActiveRecord has one
 * query object. henri has three -- a Mongoose `Query`, a Sequelize promise,
 * a Drizzle `Relation` -- and the models guide says so on purpose: the
 * global is the ORM model and nothing is wrapped. So a `Post.live()` that
 * answered *records* would have to pick one of those three shapes under one
 * name, which is the thing this tranche exists to prevent, or answer a plain
 * array and lose `.sort()`, `.limit()` and `.paginate()` on the two adapters
 * that have them.
 *
 * It answers the one value all three read identically: **a condition**. It
 * is what `find`, `findAll`, `where`, `count` and `paginate` all take; it is
 * the same kind of value `policy.scope(user)` and the tenant mark already
 * are; and it is what `req.filters()` hands a controller. Which means it
 * composes with them instead of replacing them:
 *
 * ```js
 * const { order, where } = await req.filters();
 * const page = await Post.paginate({ ...req.pagination(), order,
 *   where: Post.live(where) });
 * ```
 *
 * The intersection is `narrow()` from `base/filters.js` and deliberately
 * nothing else: an `and` spelled for the adapter, never a merge of keys, so
 * a scope and a filter on the same column both hold rather than one
 * replacing the other. A filter narrows a list and can never widen it, and
 * neither can this.
 *
 * ## The value list: `Post.enums`
 *
 * `{ status: ['draft', 'live', 'archived'] }`, frozen. A `<select>`, a
 * filter declaration, a seed and a test all want the list, and reading it
 * back from three ORMs is three different pieces of code. One property per
 * *model* rather than one per value, which is what makes it cheap enough to
 * keep.
 *
 * ## What was dropped: the bang
 *
 * `post.archived!` has no spelling in JavaScript, so the name would have
 * been invented (`post.toArchived()`, `post.makeArchived()`) rather than
 * transcribed -- and once it is invented it has to be better than the line
 * it replaces:
 *
 * ```js
 * await post.update({ status: 'archived' });
 * ```
 *
 * which is already one call, already says what it does, and already refuses
 * a value outside the enum on every adapter. What would be left is a second
 * way to write a one-field update, plus the expectations a method named
 * after a transition brings with it -- guards, a legal-transition table,
 * callbacks -- none of which henri has and none of which it would be
 * honouring. A state machine is a decision an application makes; this file
 * only knows what the column may hold.
 *
 * ## Where a name comes from
 *
 * `draft` -> `isDraft` / `Post.draft()`. `in_review`, `in-review`,
 * `IN_REVIEW` and `InReview` are all values people write, and all four give
 * `inReview`: the value is split on everything that is not a letter or a
 * digit and at every lower-to-upper boundary, and the parts are camel
 * cased. Two values of one model that come out the same name are refused,
 * because they would be the same method.
 *
 * `names()` in `packages/cli/scripts/utils.js` is the other place that
 * turns a word into a name and it is not this one: it lowercases a whole
 * word and pluralises it for a *resource* name (`Post` -> `posts`), it
 * would answer `inreview` here, and it lives in `@usehenri/cli`, which core
 * cannot require -- core is that package's dependency and not the other way
 * around. `base/graphql-schema.js` is the closer neighbour: it derives an
 * enum *type* from the same declaration and refuses a value that is not
 * already a GraphQL name, because it has a schema to print and no freedom
 * to rename. This has neither, so it renames.
 *
 * A value that cannot become a name at all -- `2fa`, `application/pdf` is
 * fine but `''` and `---` are not -- gets no predicate and no scope. It is
 * still in `Post.enums`, still validated, still queryable: nothing was
 * shadowed and nothing is silently wrong, there is simply no method, which
 * is what a value that is not a name deserves.
 *
 * ## Collisions, which are refused
 *
 * The two namespaces are not equally crowded, and the measurement is what
 * decided the policy rather than a principle:
 *
 * - **The record's** is nearly empty. Eight names shaped like `is<Name>`
 *   exist across the three ORMs (`isNew`, `isModified`, `isSelected`,
 *   `isDirectModified`, `isDirectSelected`, `isInit`, `isSoftDeleted`,
 *   `isPrototypeOf`), and exactly one of them is a plausible enum value:
 *   **`new`**. `status: ['new', 'open', 'closed']` is an ordinary ticket,
 *   and `isNew` is the flag Mongoose and the Drizzle model use to decide
 *   between an insert and an update. Shadowing it would break saving.
 * - **The model's** is crowded: `find`, `create`, `update`, `count`,
 *   `exists`, `build`, `all`, `first`, `last`, `where`, and `name` and
 *   `length`, which every function has.
 *
 * So a generated name that is already something else is a **boot failure**
 * naming the model, the field, the value, the name and who owns it
 * (`HENRI_MODEL_ENUM_NAME_TAKEN`) -- henri's habit, and the only safe
 * answer: skipping the name silently would leave `Post.find` answering
 * records to a caller who asked for a condition, and `ticket.isNew()`
 * calling a boolean.
 *
 * A refusal that fires on a reasonable model is its own problem, though,
 * and `new` is a reasonable value that nobody can rename once it is in a
 * database. So the field says what it wants, next to the `enum` it is
 * about:
 *
 * ```js
 * status: { type: 'string', enum: ['new', 'open'], predicates: 'status' },
 * // ticket.isStatusNew(), Ticket.statusNew()
 * status: { type: 'string', enum: ['new', 'open'], predicates: false },
 * // no methods for this column; Ticket.enums.status is still the list
 * ```
 *
 * ## What is checked against what
 *
 * Two lists and one operator, and the split is deliberate:
 *
 * - `MODEL_API` and `RECORD_API` are **henri's own** model surface, held
 *   here as data. They are what makes the answer the same on all three
 *   adapters: `first()` and `last()` exist on the Drizzle model and not on
 *   the Mongoose one, and a model that boots on one store has to boot on
 *   the next.
 * - `name in Model` catches the rest -- everything the ORM itself defines,
 *   including whatever the next version of it adds, plus `name`, `length`
 *   and `constructor`, which are the function's. That half is exact and
 *   needs no maintenance.
 *
 * What it does not catch is an association: `associate()` runs in the
 * adapter's `start()`, after the models are built, so a `hasMany` named
 * after an enum value would win. The two namespaces barely overlap (an
 * association is a plural noun, a state is an adjective) and the guide says
 * it rather than henri pretending to check it.
 */

const { narrow } = require('./filters');
const { fail } = require('./errors');

/** A declaration henri cannot carry out */
const INVALID = 'HENRI_MODEL_ENUM_INVALID';

/** A generated name that is already something else */
const TAKEN = 'HENRI_MODEL_ENUM_NAME_TAKEN';

/** A scope given something that is not a condition */
const UNMERGEABLE = 'HENRI_MODEL_ENUM_UNMERGEABLE';

/** The name of the value list on a model */
const LIST = 'enums';

/** The name of a field definition's opt-out */
const KEY = 'predicates';

/** What this file already put on a model, so a reload redefines it */
const ATTACHED = Symbol('henri.enums');

/**
 * The names henri itself puts on a model, on at least one adapter.
 *
 * Data, and read as such: it is the Drizzle model class -- which is henri's
 * own, statics and all -- plus the three the Mongoose and Sequelize plugins
 * add that it does not have. `name in Model` covers everything the ORM
 * brought; this list is what keeps the refusal from depending on which
 * store the application happens to be running.
 */
const MODEL_API = new Set([
  'addField',
  'all',
  'applySlug',
  'belongsTo',
  'bindable',
  'build',
  'castId',
  'checkSlugMassWrite',
  'checkValidations',
  'checkValidationsMassWrite',
  'column',
  'count',
  'countDocuments',
  'create',
  'db',
  'deleteMany',
  'destroy',
  'destroyWhere',
  'exists',
  'externalIdsWhere',
  'find',
  'findAll',
  'findByExternalId',
  'findById',
  'findByIdAndDelete',
  'findByIdAndRemove',
  'findByIdAndUpdate',
  'findByKey',
  'findByPk',
  'findBySlug',
  'findOne',
  'findOneAndDelete',
  'findOneAndUpdate',
  'first',
  'hasAssociation',
  'hasMany',
  'hasOne',
  'hydrate',
  'include',
  'insert',
  'internalId',
  'isValidId',
  'last',
  'limit',
  'onlyDeleted',
  'order',
  'paginate',
  'pluck',
  'prepare',
  'publicUser',
  'query',
  'relation',
  'restore',
  'run',
  'runHooks',
  'seedFor',
  'selection',
  'setRoles',
  'setWhere',
  'table',
  'translateError',
  'update',
  'updateById',
  'updateMany',
  'updateWhere',
  'where',
  'withDeleted',
  'withHidden',
]);

/**
 * The names henri itself puts on a record, plus the `is<Name>` ones the
 * three ORMs define. Only a handful can ever collide with a predicate, and
 * `isNew` is the one that matters (see the header).
 */
const RECORD_API = new Set([
  'changed',
  'destroy',
  'dirtyAttributes',
  'get',
  'hasRole',
  'isDirectModified',
  'isDirectSelected',
  'isInit',
  'isModified',
  'isNew',
  'isSelected',
  'isSoftDeleted',
  'merge',
  'previousAttributes',
  'reload',
  'restore',
  'save',
  'set',
  'setRoles',
  'toJSON',
  'toObject',
  'update',
]);

/** A name JavaScript can hold and a person can type */
const NAME = /^[A-Za-z][A-Za-z0-9]*$/u;

/**
 * Is it a plain object?
 *
 * @param {*} value anything
 * @returns {boolean} true when it is
 */
const isObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The first letter of a name, uppercased (`draft` -> `Draft`)
 *
 * @param {string} word the name
 * @returns {string} the name
 */
const upperFirst = (word) => word.charAt(0).toUpperCase() + word.slice(1);
/**
 * The method name one enum value gives, or null when it gives none.
 *
 * `in_review`, `in-review`, `IN_REVIEW` and `InReview` all answer
 * `inReview`: split on everything that is not a letter or a digit, split
 * again at every lower-to-upper boundary, camel case what is left. A value
 * that does not come out a name answers null and gets no method.
 *
 * @param {*} value one value of an `enum`
 * @returns {?string} the name, or null
 */
const nameOf = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const parts = value
    .split(/[^A-Za-z0-9]+/u)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/u))
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  const name = parts
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : upperFirst(part.toLowerCase())
    )
    .join('');

  return NAME.test(name) ? name : null;
};

/**
 * A coded failure carrying what to do about it.
 *
 * `fail()` hands its options to the `Error` constructor, which reads
 * `cause` and nothing else, so a `hint` is set here rather than passed --
 * `@usehenri/cli` prints the one it finds in the chain (`scripts/errors.js`)
 * and falls back to the catalogue's `fix` when there is none.
 *
 * @param {string} code the code
 * @param {string} message what happened
 * @param {string} hint what to do about it
 * @returns {Error} the error to throw
 */
const failing = (code, message, hint) => {
  const error = fail(code, message);

  error.hint = hint;

  return error;
};

/**
 * What a field's `predicates` key asks for
 *
 * @param {string} model the model name
 * @param {string} field the field name
 * @param {*} written what the field declared
 * @returns {?string} the prefix (`''` for none), or null for no methods
 * @throws {Error} HENRI_MODEL_ENUM_INVALID on a key henri cannot read
 */
const prefixOf = (model, field, written) => {
  if (typeof written === 'undefined' || written === true) {
    return '';
  }

  if (written === false) {
    return null;
  }

  const prefix = typeof written === 'string' ? nameOf(written) : null;

  if (!prefix) {
    const named = nameOf(field) || field;

    throw failing(
      INVALID,
      `${model}.${field} declares \`${KEY}: ${
        typeof written === 'string' ? JSON.stringify(written) : typeof written
      }\`, which is not a name`,
      `\`${KEY}\` is true (the default), false (no methods for this column), or the name to prefix them with -- ${KEY}: '${field}' gives is${upperFirst(
        named
      )}Draft() and Model.${named}Draft()`
    );
  }

  return prefix;
};

/**
 * The enum columns of a model file, compiled.
 *
 * Read from the **schema**, never from the `validates` block: the schema
 * says what the column may hold, which is what a record read back from the
 * database can be. A `validates` entry may bound what a write accepts more
 * tightly than that, and a row written before it did is still in the table.
 *
 * @param {object} [model] the model file (`globalId`, `schema`)
 * @returns {?Array<object>} one entry per enum column, or null
 * @throws {Error} HENRI_MODEL_ENUM_INVALID on a `predicates` key henri
 *   cannot read
 */
const enumsOf = (model = {}) => {
  const name = model.globalId || model.identity || 'the model';
  const schema = isObject(model.schema) ? model.schema : {};
  const columns = [];

  for (const field of Object.keys(schema)) {
    const definition = schema[field];

    if (!isObject(definition) || !Array.isArray(definition.enum)) {
      continue;
    }

    const prefix = prefixOf(name, field, definition[KEY]);
    const values = definition.enum.slice();
    const methods = [];

    for (const value of prefix === null ? [] : values) {
      const derived = nameOf(value);

      if (!derived) {
        continue;
      }

      const stem = prefix ? `${prefix}${upperFirst(derived)}` : derived;

      methods.push({ predicate: `is${upperFirst(stem)}`, scope: stem, value });
    }

    columns.push({ field, methods, values: Object.freeze(values) });
  }

  return columns.length > 0 ? columns : null;
};

/**
 * The failure a name that is already something else raises
 *
 * @param {string} model the model name
 * @param {object} where `{ field, name, owner, what }`
 * @returns {Error} the error to throw
 */
const taken = (model, { field, name, owner, what }) =>
  failing(
    TAKEN,
    `${model}: ${name}() ${owner}, so ${what} cannot generate it`,
    `Rename the value, or name this column's methods after the field: ${field}: { enum: [...], ${KEY}: '${field}' }. \`${KEY}: false\` turns them off and leaves ${model}.${LIST}.${field} as the list of values`
  );

/**
 * The one name check, run before anything is defined.
 *
 * Three questions in one order, and the header says why the first two are
 * lists and the third is an operator: what this model already generated,
 * what henri puts there on every adapter, and what this ORM defines.
 *
 * @param {object} at `{ name, previous }` -- the model, and what this file
 *   already put on it
 * @param {object} one `{ api, claimed, field, name, owner, target, what }`
 * @returns {void}
 * @throws {Error} HENRI_MODEL_ENUM_NAME_TAKEN
 */
const claim = (at, one) => {
  const { api, claimed, field, name, owner, target, what } = one;

  if (at.previous && at.previous.names.has(name)) {
    claimed.set(name, owner);

    return;
  }

  const held = claimed.get(name);
  const reason =
    (held &&
      `is already the one ${JSON.stringify(held.value)} of ${held.field} generates`) ||
    (api.has(name) && `is part of what henri puts on ${what}`) ||
    (name in target && `already exists on ${what}`) ||
    null;

  if (reason) {
    throw taken(at.name, { field, name, owner: reason, what: owner.about });
  }

  claimed.set(name, owner);
};

/**
 * The condition one scope answers, intersected with what it was given.
 *
 * A fresh object every call: the value is handed to an ORM as a filter, and
 * Mongoose casts a filter in place, so two calls may never share one.
 *
 * @param {*} Model the ORM model
 * @param {string} field the column
 * @param {*} value the value
 * @param {*} given what the caller wants it intersected with
 * @returns {*} the condition
 * @throws {Error} HENRI_MODEL_ENUM_UNMERGEABLE on an argument that is not
 *   a condition
 */
const conditionOf = (Model, field, value, given) => {
  const mine = { [field]: value };

  if (typeof given === 'undefined' || given === null) {
    return mine;
  }

  if (!isObject(given)) {
    throw failing(
      UNMERGEABLE,
      `${(Model && Model.modelName) || 'a model'}: the ${field} scope was given ${
        Array.isArray(given) ? 'an array' : typeof given
      } to narrow, which is not a condition`,
      'A scope answers a condition and takes one, so Model.live(where) is `where AND the value`: pass a plain object, or nothing'
    );
  }

  return narrow(Model, given, mine);
};

/**
 * Puts the predicates, the scopes and the value list on a model.
 *
 * Called once per model as the store builds it (`3.model.js`), with the
 * model *file* next to the ORM model, because the declaration is in the file
 * and the methods go on the object. Every name is checked before any is
 * defined, so a model that is refused is left exactly as the adapter built
 * it.
 *
 * @param {*} Model the ORM model the adapter answered
 * @param {object} [model] the model file (`globalId`, `schema`)
 * @returns {?Array<object>} what it generated, or null when the model
 *   declares no enum column
 * @throws {Error} HENRI_MODEL_ENUM_INVALID, HENRI_MODEL_ENUM_NAME_TAKEN
 */
const attach = (Model, model = {}) => {
  const columns = enumsOf(model);

  if (!Model || !columns) {
    return null;
  }

  const schema = isObject(model.schema) ? model.schema : {};
  const record = Model.prototype || {};
  const at = {
    name: model.globalId || model.identity || Model.modelName || 'a model',
    // A reload rebuilds the model, but nothing promises it is a new object:
    // what this file put there last time is not a collision with itself
    previous: Model[ATTACHED] || null,
  };
  const scopes = new Map();
  const predicates = new Map();

  claim(at, {
    api: MODEL_API,
    claimed: scopes,
    field: columns[0].field,
    name: LIST,
    owner: { about: 'the list of values', field: null, value: LIST },
    target: Model,
    what: 'a model',
  });

  for (const { field, methods } of columns) {
    for (const { predicate, scope, value } of methods) {
      const owner = {
        about: `the value ${JSON.stringify(value)} of ${field}`,
        field,
        value,
      };

      claim(at, {
        api: RECORD_API,
        claimed: predicates,
        field,
        name: predicate,
        owner,
        target: record,
        what: 'a record',
      });

      // A column is on the record too, and on the drizzle adapter it is an
      // own property of the instance rather than a path on the prototype,
      // so the `in` above cannot see it
      if (predicate in schema) {
        throw taken(at.name, {
          field,
          name: predicate,
          owner: 'is a column of this model',
          what: owner.about,
        });
      }

      claim(at, {
        api: MODEL_API,
        claimed: scopes,
        field,
        name: scope,
        owner,
        target: Model,
        what: 'a model',
      });
    }
  }

  const names = new Set([LIST]);
  const define = (target, key, value) =>
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      value,
      writable: true,
    });

  for (const { field, methods } of columns) {
    for (const { predicate, scope, value } of methods) {
      define(record, predicate, function is() {
        return this[field] === value;
      });

      define(Model, scope, function where(given) {
        return conditionOf(Model, field, value, given);
      });

      names.add(predicate);
      names.add(scope);
    }
  }

  define(
    Model,
    LIST,
    Object.freeze(
      Object.fromEntries(columns.map(({ field, values }) => [field, values]))
    )
  );
  define(Model, ATTACHED, { columns, names });

  return columns;
};

module.exports = {
  ATTACHED,
  INVALID,
  KEY,
  LIST,
  MODEL_API,
  RECORD_API,
  TAKEN,
  UNMERGEABLE,
  attach,
  conditionOf,
  enumsOf,
  nameOf,
};
