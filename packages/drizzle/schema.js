const TYPES = require('./types');
const { DETERMINISTIC_LENGTH, encryptionOf } = require('./encrypted');
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
  'primaryKey',
  'references',
  'required',
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

// Sequelize data type names accepted for compatibility with existing models
const SEQUELIZE_TYPES = {
  BIGINT: 'integer',
  BOOLEAN: 'boolean',
  DATE: 'date',
  DATEONLY: 'date',
  DECIMAL: 'number',
  DOUBLE: 'number',
  FLOAT: 'float',
  INTEGER: 'integer',
  JSON: 'json',
  JSONB: 'json',
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
    `Unsupported type ${describe(type)} for field '${field}'`
  );
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
        `Field '${field}' has '${option}' but no type`
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
      `Field '${field}': 'enum' must be an array`
    );
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
