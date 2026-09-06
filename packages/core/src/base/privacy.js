/**
 * Personal data: the mark on a field, and the map henri keeps of it.
 *
 * A model says which of its fields are about a person, in the schema, where
 * the rest of the field's shape already lives:
 *
 * ```js
 * schema: {
 *   name: { personal: true, type: 'string' },
 *   phone: { personal: { expose: false }, type: 'string' },
 *   invoicedAt: { personal: { erase: 'retain' }, type: 'date' },
 * }
 * ```
 *
 * `personal: true` is the whole mark most of the time; the object form says
 * more about one field:
 *
 * - `expose` (default `config.privacy.expose`, itself `true`): whether the
 *   field may leave the server in an answer henri serializes. `false` drops
 *   it from `res.resource()`, `res.collection()`, `res.render()` and the
 *   public user, everywhere, at every depth -- a name marked private is
 *   private in every payload, the way a filtered parameter is filtered in
 *   every log line.
 * - `export` (default `true`): whether the field belongs in the export of a
 *   person's data.
 * - `erase` (default: `clear` where the column can hold null, `anonymize`
 *   where it cannot): what an erasure writes over the value.
 *
 * A model says what it is to a person in its options:
 *
 * ```js
 * options: {
 *   personal: { onErase: 'anonymize', subject: 'speakerId' },
 * }
 * ```
 *
 * `subject` names the field pointing at the person (henri infers it from
 * `references`, `ref` and the belongsTo associations, so it is rarely
 * written), or `{ field, matches }` when the record names a person by
 * something other than a key (`{ field: 'email', matches: 'email' }`).
 * `onErase` is what happens to those records when that person is erased; the
 * strategies, and the reasoning behind the default, are in
 * `base/erasure.js`.
 *
 * The person is the user model (`config.user.model`): henri's notion of a
 * person is the one it already authenticates. Its `email` is personal and
 * exposed (it is what `publicUser()` sends, and what half the applications
 * greet people by); its `password` is personal, never exported and never
 * exposed.
 *
 * What the mark does, in one sentence each:
 *
 * - **logs and errors**: every personal field name is masked by `pen` and by
 *   the runtime log, matched exactly, next to the substring filters of
 *   `config.filterParameters` (see `base/redact.js`).
 * - **answers**: nothing changes unless the field says `expose: false`,
 *   because dropping `email` from every payload would break every
 *   application. `expose: false` is the strong form and it is absolute:
 *   `res.resource(record, { include: ['phone'] })` is the way back.
 * - **export and erasure**: `henri privacy:export` and `henri privacy:erase`
 *   are built from this map (see `base/erasure.js`).
 *
 * @module base/privacy
 */

const { fail } = require('./errors');

/** What `personal.erase` accepts, on a field */
const STRATEGIES = ['anonymize', 'clear', 'retain'];

/** What `options.personal.onErase` accepts, on a model */
const ON_ERASE = ['anonymize', 'delete', 'orphan', 'retain'];

/** The default strategy for the records that reference an erased person */
const DEFAULT_ON_ERASE = 'anonymize';

/** Where the erasure receipts are written, unless the configuration says */
const DEFAULT_RECEIPTS = 'privacy';

/**
 * The fields henri adds to the user model itself, marked the way henri
 * would mark them. They are not in the model file -- the adapters add them
 * -- so the map adds them here.
 */
const USER_FIELDS = Object.freeze({
  email: Object.freeze({
    erase: 'anonymize',
    export: true,
    expose: true,
    required: true,
    type: 'string',
    unique: true,
  }),
  password: Object.freeze({
    erase: 'anonymize',
    export: false,
    expose: false,
    required: true,
    type: 'string',
    unique: false,
  }),
});

/**
 * Is the value a plain object?
 *
 * @param {*} value anything
 * @returns {boolean} true for plain objects
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/**
 * Where the receipts go: a directory, or false to write none
 *
 * @param {*} value what `privacy.receipts` holds
 * @returns {(string|boolean)} the directory, or false
 */
function receiptsOf(value) {
  if (value === false) {
    return false;
  }

  return typeof value === 'string' && value.length > 0
    ? value
    : DEFAULT_RECEIPTS;
}

/**
 * The `privacy` configuration, normalized
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {{expose: boolean, onErase: string, receipts: (string|boolean)}} the settings
 */
function privacyConfig(config) {
  const has =
    config && typeof config.has === 'function' && config.has('privacy');
  const raw = has ? config.get('privacy') : {};
  const settings = isPlainObject(raw) ? raw : {};

  return {
    expose: settings.expose !== false,
    onErase: ON_ERASE.includes(settings.onErase)
      ? settings.onErase
      : DEFAULT_ON_ERASE,
    receipts: receiptsOf(settings.receipts),
  };
}

/**
 * The pattern a field validates against, when it declares one
 *
 * @param {*} value what `match` holds (a regexp, or `[regexp, message]`)
 * @returns {?RegExp} the pattern, or null
 */
function matchOf(value) {
  const pattern = Array.isArray(value) ? value[0] : value;

  return pattern instanceof RegExp ? pattern : null;
}

/**
 * The mark of one field, or null when the field is not personal
 *
 * @param {string} model the model name (for the error message)
 * @param {string} field the field name
 * @param {*} definition the field definition from the model file
 * @param {object} [defaults={}] `{ expose }` from the configuration
 * @returns {?object} `{ erase, expose, export, required, type, unique }`
 * @throws when the mark is not a boolean or an object henri understands
 */
function markOf(model, field, definition, defaults = {}) {
  if (!isPlainObject(definition) || !('personal' in definition)) {
    return null;
  }

  const mark = definition.personal;

  if (mark === false || mark === null || typeof mark === 'undefined') {
    return null;
  }

  if (mark !== true && !isPlainObject(mark)) {
    throw fail(
      'HENRI_PRIVACY_INVALID_MARK',
      `${model}.${field}: 'personal' must be true, false or an object ({ erase, expose, export })`
    );
  }

  const options = mark === true ? {} : mark;
  const required = definition.required === true;
  const unique = definition.unique === true;

  if (
    typeof options.erase !== 'undefined' &&
    !STRATEGIES.includes(options.erase)
  ) {
    throw fail(
      'HENRI_PRIVACY_INVALID_MARK',
      `${model}.${field}: 'personal.erase' must be one of ${STRATEGIES.join(
        ', '
      )}`
    );
  }

  return {
    // A column that cannot hold null cannot be cleared: erasing it means
    // writing something meaningless over it instead
    erase: options.erase || (required || unique ? 'anonymize' : 'clear'),
    export: options.export !== false,
    expose:
      typeof options.expose === 'boolean'
        ? options.expose
        : defaults.expose !== false,
    // The shape the column asks for, so that what an erasure writes over
    // the value still passes the model's own validation (base/erasure.js)
    match: matchOf(definition.match),
    maxLength: Number.isFinite(definition.maxLength)
      ? definition.maxLength
      : null,
    minLength: Number.isFinite(definition.minLength)
      ? definition.minLength
      : null,
    required,
    type: typeof definition.type === 'string' ? definition.type : 'string',
    unique,
  };
}

/**
 * The personal fields of a model file, by name
 *
 * Nested documents are not walked: a mark applies to a column, and a nested
 * object is one column of JSON. Mark the column itself.
 *
 * @param {object} model a model file (`{ schema, options }`)
 * @param {object} [defaults={}] `{ expose }` from the configuration
 * @returns {object} the marks by field name
 * @throws when a mark is malformed
 */
function fieldsOf(model, defaults = {}) {
  const schema = (model && model.schema) || {};
  const name = (model && model.globalId) || 'model';
  const fields = {};

  for (const field of Object.keys(schema)) {
    const mark = markOf(name, field, schema[field], defaults);

    if (mark) {
      fields[field] = mark;
    }
  }

  return fields;
}

/**
 * The belongsTo association of an ORM model pointing at the subject
 *
 * Drizzle keeps an array of `{ as, foreignKey, kind, target }`, Sequelize an
 * object of associations with an `associationType` and a `target`, and
 * Mongoose says it in the schema (`ref`), which `linkOf()` has read already.
 *
 * @param {*} orm the ORM model (may be null)
 * @param {string} subject the global id of the subject model
 * @returns {?{field: string, matches: string, declared: boolean}} the link
 */
function associationOf(orm, subject) {
  const associations = orm && orm.associations;

  if (!associations) {
    return null;
  }

  const entries = Array.isArray(associations)
    ? associations
    : Object.values(associations);

  for (const entry of entries) {
    const kind = String(entry.kind || entry.associationType).toLowerCase();
    const target =
      entry.target && entry.target.name ? entry.target.name : entry.target;

    if (
      kind === 'belongsto' &&
      target === subject &&
      typeof entry.foreignKey === 'string'
    ) {
      return { declared: false, field: entry.foreignKey, matches: 'id' };
    }
  }

  return null;
}

/**
 * The link between a model and the person, when henri can see one.
 *
 * In order: what the model declares, then a field referencing the subject
 * model (`references: { model: 'User' }` on the SQL adapters, `ref: 'User'`
 * on Mongoose), then a belongsTo association pointing at it.
 *
 * @param {object} model a model file
 * @param {string} subject the global id of the subject model
 * @param {*} [orm=null] the ORM model, for its associations
 * @returns {?{field: string, matches: string, declared: boolean}} the link
 */
function linkOf(model, subject, orm = null) {
  const schema = (model && model.schema) || {};
  const options = ((model && model.options) || {}).personal || {};
  const declared = options.subject;

  /**
   * Can the column holding the link be set to null?
   *
   * @param {string} field the field name
   * @returns {boolean} true when the model file says it is required
   */
  const requires = (field) =>
    Boolean(isPlainObject(schema[field]) && schema[field].required === true);

  if (declared === false) {
    return null;
  }

  if (typeof declared === 'string') {
    return {
      declared: true,
      field: declared,
      matches: 'id',
      required: requires(declared),
    };
  }

  if (isPlainObject(declared) && typeof declared.field === 'string') {
    return {
      declared: true,
      field: declared.field,
      matches: declared.matches || 'id',
      required: requires(declared.field),
    };
  }

  for (const field of Object.keys(schema)) {
    const definition = schema[field];

    if (!isPlainObject(definition)) {
      continue;
    }

    const { references } = definition;
    const target =
      (isPlainObject(references) ? references.model : references) ||
      definition.ref ||
      null;

    if (typeof target === 'string' && target === subject) {
      return {
        declared: false,
        field,
        matches: 'id',
        required: requires(field),
      };
    }
  }

  const association = associationOf(orm, subject);

  return association
    ? { ...association, required: requires(association.field) }
    : null;
}

/**
 * The entry of one model in the map
 *
 * @param {object} model a model file
 * @param {object} context the context
 * @param {string} context.subject the global id of the subject model
 * @param {object} context.defaults `{ expose, onErase }`
 * @param {*} [context.orm] the ORM model
 * @returns {object} the entry
 * @throws when a mark or an option is malformed
 */
function entryOf(model, { subject, defaults, orm = null }) {
  const name = model.globalId;
  const options = (model.options || {}).personal || {};
  const isSubject = name === subject;
  const fields = fieldsOf(model, defaults);

  if (
    typeof options.onErase !== 'undefined' &&
    !ON_ERASE.includes(options.onErase)
  ) {
    throw fail(
      'HENRI_PRIVACY_INVALID_MARK',
      `${name}: 'options.personal.onErase' must be one of ${ON_ERASE.join(
        ', '
      )}`
    );
  }

  if (isSubject) {
    for (const field of Object.keys(USER_FIELDS)) {
      const built = USER_FIELDS[field];

      fields[field] = fields[field] || {
        ...built,
        expose: built.expose && defaults.expose !== false,
      };
    }
  }

  return {
    // What the model itself said, which a `--strategy` does not override:
    // a model that decided what happens to its records has decided
    declared: Boolean(options.onErase),
    export: options.export !== false,
    fields,
    identity: model.identity,
    isSubject,
    link: isSubject ? null : linkOf(model, subject, orm),
    name,
    onErase: options.onErase || defaults.onErase || DEFAULT_ON_ERASE,
    paranoid: Boolean((model.options || {}).paranoid),
  };
}

/**
 * The map of every model: which fields are personal, and how each model
 * relates to the person
 *
 * @param {Array<object>} models the model files (`henri.model.models`)
 * @param {object} options options
 * @param {string} options.subject the global id of the subject model
 * @param {object} [options.settings={}] the `privacy` settings
 * @param {function} [options.orm] `(globalId) => the ORM model`
 * @returns {{entries: Array<object>, keys: Set<string>, private: Set<string>, subject: ?object}} the map
 * @throws when a mark or an option is malformed
 */
function mapOf(models, { subject, settings = {}, orm = () => null }) {
  const defaults = {
    expose: settings.expose !== false,
    onErase: settings.onErase || DEFAULT_ON_ERASE,
  };
  const entries = [];
  const keys = new Set();
  const hidden = new Set();

  for (const model of models || []) {
    const entry = entryOf(model, {
      defaults,
      orm: orm(model.globalId),
      subject,
    });

    // A model is in the map when it holds something personal, when it is
    // the person, or when it points at one: a proposal with no marked field
    // is still the speaker's, and an export that left it out would not be
    // "everything you hold about me"
    if (
      Object.keys(entry.fields).length === 0 &&
      !entry.isSubject &&
      !entry.link
    ) {
      continue;
    }

    entries.push(entry);

    for (const field of Object.keys(entry.fields)) {
      keys.add(field);

      if (entry.fields[field].expose === false) {
        hidden.add(field);
      }
    }
  }

  return {
    entries,
    keys,
    private: hidden,
    subject: entries.find((entry) => entry.isSubject) || null,
  };
}

/**
 * A copy of a value without the fields marked `expose: false`, at every
 * depth. Nothing is copied when the application marked no such field, which
 * is the case until it says otherwise.
 *
 * @param {*} value a record, a list of records, or anything else
 * @param {Set<string>} names the private field names
 * @param {Array<string>} [keep=[]] names to leave in place (`include`)
 * @param {WeakMap} [seen] the copies already made (cycles, shared records)
 * @returns {*} the value, without the private fields
 */
function stripPersonal(value, names, keep = [], seen = new WeakMap()) {
  if (!names || names.size === 0 || !value || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (Array.isArray(value)) {
    const copy = [];

    seen.set(value, copy);
    value.forEach((item) => copy.push(stripPersonal(item, names, keep, seen)));

    return copy;
  }

  const plain = typeof value.toJSON === 'function' ? value.toJSON() : value;

  if (!plain || typeof plain !== 'object' || !isPlainObject(plain)) {
    seen.set(value, plain);

    return plain;
  }

  const copy = {};

  seen.set(value, copy);

  for (const key of Object.keys(plain)) {
    if (names.has(key) && !keep.includes(key)) {
      continue;
    }

    const entry = stripPersonal(plain[key], names, keep, seen);

    // `copy.__proto__ = x` runs the setter of Object.prototype and replaces
    // the copy's prototype instead of adding a field. This strip is the last
    // thing that touches a payload on its way out, so it is the one that
    // decides: the value is defined rather than assigned, which keeps it a
    // field (see base/references.js, which does the same on the way in)
    if (key === '__proto__') {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: entry,
        writable: true,
      });
      continue;
    }

    copy[key] = entry;
  }

  return copy;
}

module.exports = {
  DEFAULT_ON_ERASE,
  DEFAULT_RECEIPTS,
  ON_ERASE,
  STRATEGIES,
  USER_FIELDS,
  fieldsOf,
  isPlainObject,
  linkOf,
  mapOf,
  markOf,
  matchOf,
  privacyConfig,
  stripPersonal,
};
