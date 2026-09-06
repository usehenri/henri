const TYPES = require('./types');
const { DETERMINISTIC_LENGTH, encryptionOf } = require('./encrypted');
const {
  canonical,
  canonicalInteger,
  checkSettings,
  isExact,
  settingsOf,
} = require('./exact');
const { coded, isPlainObject, snakeCase } = require('./utils');

// Keys of the henri model format understood by this adapter
const KNOWN_KEYS = new Set([
  'default',
  // The column type, and the hooks of encryption.js
  'encrypted',
  'enum',
  'index',
  'length',
  'lowercase',
  'match',
  'max',
  'maxLength',
  'min',
  'minLength',
  // Metadata, not a column: what henri redacts, exports and erases
  'personal',
  // The two a `decimal` column carries; see ./exact.js
  'precision',
  'primaryKey',
  'references',
  'required',
  'scale',
  'select',
  'trim',
  'type',
  'unique',
  'validate',
]);

// JavaScript constructors accepted as types (Mongoose style: `name: String`)
const CONSTRUCTORS = new Map([
  [String, 'string'],
  [Number, 'number'],
  [Boolean, 'boolean'],
  [Date, 'date'],
  [Object, 'json'],
  [Array, 'json'],
]);

// Sequelize data type names accepted for compatibility with existing models.
// `BIGINT` and `DECIMAL` used to be downgrades -- a 32-bit integer and a
// double -- so a model asking for money got binary floating point and one
// asking for a big identifier got a column that refused the insert above
// 2,147,483,647. They point at the exact types now.
const SEQUELIZE_TYPES = {
  BIGINT: 'bigint',
  BOOLEAN: 'boolean',
  DATE: 'date',
  DATEONLY: 'date',
  DECIMAL: 'decimal',
  DOUBLE: 'number',
  FLOAT: 'float',
  INTEGER: 'integer',
  JSON: 'json',
  JSONB: 'json',
  NUMERIC: 'decimal',
  REAL: 'float',
  STRING: 'string',
  TEXT: 'text',
  UUID: 'uuid',
};

/**
 * Describes a type for error messages
 *
 * @param {*} type The type given in the model file
 * @returns {string} A readable name
 */
const describe = (type) => {
  if (typeof type === 'function') {
    return type.name || 'function';
  }

  return typeof type === 'string' ? type : JSON.stringify(type);
};

/**
 * Resolves a field type to a henri type name
 *
 * @param {*} type A henri type name, a constructor or a nested definition
 * @param {string} field The field name (for error messages)
 * @returns {string} A key of types.js
 * @throws {Error} When the type is unknown
 */
const resolveType = (type, field) => {
  if (typeof type === 'string') {
    const name = type.toLowerCase();

    if (TYPES[name]) {
      return name;
    }

    if (SEQUELIZE_TYPES[type]) {
      return SEQUELIZE_TYPES[type];
    }

    throw coded(
      'HENRI_MODEL_UNKNOWN_TYPE',
      `Unknown type '${type}' for field '${field}'; use one of ${Object.keys(
        TYPES
      ).join(', ')}`
    );
  }

  if (CONSTRUCTORS.has(type)) {
    return CONSTRUCTORS.get(type);
  }

  // Nested documents and arrays have no SQL equivalent: store them as JSON
  if (Array.isArray(type) || isPlainObject(type)) {
    return 'json';
  }

  throw coded(
    'HENRI_MODEL_UNKNOWN_TYPE',
    `Unsupported type ${describe(type)} for field '${field}'; use one of ${Object.keys(
      TYPES
    ).join(', ')}`
  );
};

// Keys that measure a string, and therefore mean nothing on a `decimal` or
// a `bigint`: the value is a string, so they would quietly count digits
const TEXTUAL_KEYS = [
  'length',
  'lowercase',
  'match',
  'maxLength',
  'minLength',
  'trim',
];

/**
 * One value of an exact field, as the string the column holds
 *
 * @param {string} type `decimal` or `bigint`
 * @param {*} value The value
 * @param {object} settings `{ precision, scale }`
 * @returns {{value: string}|{error: string}} The value, or what is wrong
 */
const exactly = (type, value, settings) =>
  type === 'bigint' ? canonicalInteger(value) : canonical(value, settings);

/**
 * Settles the `precision` and `scale` of an exact field and canonicalizes
 * everything the definition itself holds -- the default, the enum and the
 * bounds -- so nothing downstream compares a literal against a stored
 * value that spells the same number differently
 *
 * @param {string} field The field name
 * @param {object} normalized The normalized field, changed in place
 * @returns {void}
 * @throws {Error} When the definition holds a value the type refuses
 */
const normalizeExact = (field, normalized) => {
  const settings = settingsOf(normalized);
  const textual = TEXTUAL_KEYS.filter((key) => key in normalized);

  if (textual.length > 0) {
    throw coded(
      'HENRI_MODEL_INVALID_FIELD',
      `Field '${field}' has '${textual[0]}', which measures text: a ${normalized.type} is a number, and its bounds are 'min' and 'max'`
    );
  }

  for (const key of ['default', 'max', 'min']) {
    const value = normalized[key];

    if (!(key in normalized) || value === null || typeof value === 'function') {
      continue;
    }

    const answer = exactly(normalized.type, value, settings);

    if (answer.error) {
      throw coded(
        'HENRI_MODEL_INVALID_FIELD',
        `Field '${field}' has a '${key}' of ${JSON.stringify(String(value))}, which ${answer.error}`
      );
    }

    normalized[key] = answer.value;
  }

  if (Array.isArray(normalized.enum)) {
    normalized.enum = normalized.enum.map((entry) => {
      const answer = exactly(normalized.type, entry, settings);

      if (answer.error) {
        throw coded(
          'HENRI_MODEL_INVALID_FIELD',
          `Field '${field}' has the enum value ${JSON.stringify(String(entry))}, which ${answer.error}`
        );
      }

      return answer.value;
    });
  }

  if (normalized.type === 'decimal') {
    Object.assign(normalized, settings);
  }
};

/**
 * Normalizes one field definition
 *
 * @param {string} field The field name
 * @param {*} definition The definition from the model file
 * @param {object} [context] `{ isUser, model }`, what an error names the
 *   field by and whether henri owns it
 * @returns {object} The normalized field: `type` plus the options given
 * @throws {Error} On unknown keys, types or marks
 */
const normalizeField = (field, definition, context = {}) => {
  if (!isPlainObject(definition)) {
    return { type: resolveType(definition, field) };
  }

  if (!('type' in definition)) {
    const option = Object.keys(definition).find((key) => KNOWN_KEYS.has(key));

    if (option) {
      throw coded(
        'HENRI_MODEL_FIELD_INCOMPLETE',
        `Field '${field}' has '${option}' but no type: write ${field}: { type: 'string', ${option}: ... }, or the short form ${field}: 'string'`
      );
    }

    // A nested document (`address: { street: String }` or `{}`)
    return { type: 'json' };
  }

  const normalized = {};

  for (const key of Object.keys(definition)) {
    const value = definition[key];

    if (key === 'type') {
      normalized.type = resolveType(value, field);
    } else if (key === 'select') {
      normalized.hidden = value === false;
    } else if (key === 'references') {
      normalized.references =
        typeof value === 'string' ? { model: value } : { ...value };
    } else if (KNOWN_KEYS.has(key)) {
      normalized[key] = value;
    } else {
      throw coded(
        'HENRI_MODEL_INVALID_FIELD',
        `Unknown key '${key}' on field '${field}'; supported keys are ${[
          ...KNOWN_KEYS,
        ].join(', ')}`
      );
    }
  }

  if ('enum' in normalized && !Array.isArray(normalized.enum)) {
    throw coded(
      'HENRI_MODEL_INVALID_FIELD',
      `Field '${field}': 'enum' must be an array of the values the column accepts, as in enum: ['draft', 'sent']`
    );
  }

  const settings = checkSettings(normalized.type, normalized);

  if (settings) {
    throw coded('HENRI_MODEL_INVALID_FIELD', `Field '${field}' ${settings}`);
  }

  if (isExact(normalized.type)) {
    normalizeExact(field, normalized);
  }

  // The column of an encrypted field is the ciphertext's, not the
  // plaintext's: a `string` no longer fits in a varchar(255) once it
  // carries an iv, a tag and base64url. See ./encrypted.js
  const encrypted = encryptionOf(field, definition, context);

  if (encrypted) {
    normalized.encrypted = encrypted;
    normalized.type = encrypted.deterministic ? 'string' : 'text';

    if (encrypted.deterministic) {
      normalized.length = DETERMINISTIC_LENGTH;
    } else {
      delete normalized.length;
    }

    // Bounds and shapes measure the plaintext, in validate(); the column
    // never sees it, and a `lowercase` over base64url would break the tag
    delete normalized.lowercase;
    delete normalized.trim;
  }

  return normalized;
};

/**
 * Turns a henri model schema into normalized fields
 *
 * Accepts the henri format (`{ type: 'string', required: true, default: 'x',
 * enum: [...], unique: true, index: true }`, constructors like `String`) and
 * throws on anything else so a typo never ends up as a silently ignored
 * option.
 *
 * @param {object} [schema={}] The model schema
 * @param {object} [context={}] `{ isUser, model }`, for the marks
 * @returns {object} Normalized fields by name
 * @throws {Error} On unknown keys, types or marks
 */
const normalizeSchema = (schema = {}, context = {}) => {
  const fields = {};

  for (const field of Object.keys(schema)) {
    fields[field] = normalizeField(field, schema[field], context);
  }

  return fields;
};

/**
 * The fields a normalized schema marked `encrypted`, by name
 *
 * @param {object} fields The normalized fields
 * @returns {object} `{ [field]: { deterministic } }`
 */
const encryptedFields = (fields) =>
  Object.fromEntries(
    Object.keys(fields || {})
      .filter((field) => fields[field].encrypted)
      .map((field) => [field, fields[field].encrypted])
  );

/**
 * Applies `required`, `default`, `unique` and `references` to a column
 *
 * @param {object} column A column builder
 * @param {object} field The normalized field
 * @param {object} context The compile context
 * @returns {object} The column builder
 */
const decorate = (column, field, context) => {
  let builder = column;

  if (field.primaryKey) {
    builder = builder.primaryKey();
  }

  if (field.required || field.primaryKey) {
    builder = builder.notNull();
  }

  if (typeof field.default !== 'undefined') {
    if (field.default === Date.now) {
      builder = builder.$defaultFn(() => new Date());
    } else if (typeof field.default === 'function') {
      builder = builder.$defaultFn(field.default);
    } else if (field.default !== null && typeof field.default === 'object') {
      // JSON defaults live in JavaScript: every dialect stores them the same
      builder = builder.$defaultFn(() => structuredClone(field.default));
    } else {
      builder = builder.default(field.default);
    }
  }

  // On sqlite a column unique() is introspected as an index and pushed
  // again on every boot; a named unique index round-trips
  if (field.unique && context.dialect !== 'sqlite') {
    builder = builder.unique();
  }

  if (field.references && context.resolveColumn) {
    const {
      model,
      field: target = 'id',
      onDelete,
      onUpdate,
    } = field.references;
    const actions = {};

    if (onDelete) {
      actions.onDelete = onDelete;
    }
    if (onUpdate) {
      actions.onUpdate = onUpdate;
    }

    builder = builder.references(
      () => context.resolveColumn(model, target),
      actions
    );
  }

  return builder;
};

/**
 * Compiles normalized fields into a Drizzle table for a dialect
 *
 * @param {object} spec The table specification
 * @param {string} spec.key The schema key (the model global id)
 * @param {string} spec.tableName The table name
 * @param {object} spec.fields Normalized fields by name
 * @param {boolean} [spec.id=true] Add the `id` primary key
 * @param {boolean} [spec.timestamps=false] Add `createdAt` and `updatedAt`
 * @param {object} dialect A dialect (dialects.js)
 * @param {object} [context={}] `resolveColumn(model, field)` for references
 * @returns {{ table: object, columns: object, enums: object }} The table,
 *   the column name of each field and the pg enums it needs
 */
const compileTable = (spec, dialect, context = {}) => {
  const core = dialect.core();
  const fields = { ...spec.fields };
  const hasId = spec.id !== false && !fields.id;
  const columns = {};
  const names = {};
  const enums = {};
  const compile = {
    ...context,
    dialect: dialect.name,
    enums,
    key: spec.key,
    tableName: spec.tableName,
  };

  if (hasId) {
    columns.id = dialect.id(core);
    names.id = 'id';
  }

  if (spec.timestamps) {
    fields.createdAt = fields.createdAt || {
      default: Date.now,
      required: true,
      type: 'date',
    };
    fields.updatedAt = fields.updatedAt || {
      default: Date.now,
      required: true,
      type: 'date',
    };
  }

  for (const name of Object.keys(fields)) {
    const field = fields[name];
    const column = snakeCase(name);

    columns[name] = decorate(
      dialect.type(core, column, field, compile),
      field,
      compile
    );
    names[name] = column;
  }

  /**
   * Indexes and check constraints
   *
   * @param {object} table The table columns
   * @returns {Array<object>} Extra table configuration
   */
  const extras = (table) => {
    const list = [];

    for (const name of Object.keys(fields)) {
      const field = fields[name];
      const column = names[name];

      if (field.unique && dialect.name === 'sqlite') {
        list.push(
          core.uniqueIndex(`${spec.tableName}_${column}_unique`).on(table[name])
        );
      } else if (field.index && !field.unique && !field.primaryKey) {
        list.push(
          core.index(`${spec.tableName}_${column}_idx`).on(table[name])
        );
      }

      // No CHECK constraint for enums on sqlite: drizzle-kit 0.31 shares one
      // checkConstraints object across the tables it introspects, so every
      // table after the first check gets recreated on each push. Enums are
      // validated in JavaScript on every dialect anyway.
    }

    return list;
  };

  const factory = {
    mysql: core.mysqlTable,
    postgres: core.pgTable,
    sqlite: core.sqliteTable,
  }[dialect.name];

  return {
    columns: names,
    enums,
    fields,
    table: factory(spec.tableName, columns, extras),
  };
};

module.exports = {
  KNOWN_KEYS,
  compileTable,
  encryptedFields,
  normalizeField,
  normalizeSchema,
  resolveType,
};
