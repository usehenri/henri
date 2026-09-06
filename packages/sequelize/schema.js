const { DataTypes } = require('sequelize');
const TYPES = require('./types');
const { DETERMINISTIC_LENGTH, encryptionOf } = require('./encrypted');
const {
  canonical,
  canonicalInteger,
  checkSettings,
  isExact,
  settingsOf,
} = require('./exact');
const { coded } = require('./utils');

// Dialects with a native ENUM column type
const ENUM_DIALECTS = new Set(['mariadb', 'mysql', 'postgres']);

// Keys of the henri model format (Mongoose style) and their Sequelize meaning
const HENRI_KEYS = {
  default: 'defaultValue',
  // The column type, and the hooks of index.js; the attribute never
  // carries the mark itself
  encrypted: 'henri.encryption',
  enum: 'DataTypes.ENUM or validate.isIn',
  index: 'options.indexes',
  // Metadata, not a column: henri reads it back through the model file
  // (base/privacy.js), so the attribute never carries it
  personal: 'henri.privacy',
  // The two a `decimal` carries; they build DECIMAL(p, s) below
  precision: 'DataTypes.DECIMAL(precision, scale)',
  required: 'allowNull: false',
  scale: 'DataTypes.DECIMAL(precision, scale)',
  type: 'type',
  unique: 'unique',
};

// Sequelize attribute options accepted as is
const SEQUELIZE_KEYS = [
  'allowNull',
  'autoIncrement',
  'autoIncrementIdentity',
  'comment',
  'defaultValue',
  'field',
  'get',
  'onDelete',
  'onUpdate',
  'primaryKey',
  'references',
  'set',
  'type',
  'unique',
  'validate',
  'values',
];

const KNOWN_KEYS = new Set([...Object.keys(HENRI_KEYS), ...SEQUELIZE_KEYS]);

// JavaScript constructors accepted as types (Mongoose style: `name: String`)
const CONSTRUCTORS = new Map([
  [String, TYPES.string],
  [Number, TYPES.number],
  [Boolean, TYPES.boolean],
  [Date, TYPES.date],
  [Object, TYPES.json],
  [Array, TYPES.json],
  [Buffer, DataTypes.BLOB],
]);

/**
 * Is the value a plain object (a field definition or a nested document)?
 *
 * @param {*} value Any value
 * @returns {boolean} true for plain objects
 */
const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

/**
 * Is the value a Sequelize data type (class or instance)?
 *
 * @param {*} value Any value
 * @returns {boolean} true for `DataTypes.STRING`, `DataTypes.STRING(50)`, ...
 */
const isDataType = (value) =>
  Boolean(value) &&
  ((typeof value === 'function' &&
    value.prototype instanceof DataTypes.ABSTRACT) ||
    value instanceof DataTypes.ABSTRACT);

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
 * Resolves a field type to a Sequelize data type
 *
 * @param {*} type A henri type name, a constructor or a Sequelize data type
 * @param {string} field The field name (for error messages)
 * @returns {object} A Sequelize data type
 * @throws {Error} When the type is unknown
 */
const resolveType = (type, field) => {
  if (isDataType(type)) {
    return type;
  }

  if (typeof type === 'string') {
    const name = type.toLowerCase();

    if (TYPES[name]) {
      return TYPES[name];
    }

    if (type === type.toUpperCase() && isDataType(DataTypes[type])) {
      return DataTypes[type];
    }

    throw coded(
      'HENRI_MODEL_UNKNOWN_TYPE',
      `Unknown type '${type}' for field '${field}'; use one of ${Object.keys(
        TYPES
      ).join(', ')} or a Sequelize data type`
    );
  }

  if (CONSTRUCTORS.has(type)) {
    return CONSTRUCTORS.get(type);
  }

  // Nested documents and arrays have no SQL equivalent: store them as JSON
  if (Array.isArray(type) || isPlainObject(type)) {
    return TYPES.json;
  }

  throw coded(
    'HENRI_MODEL_UNKNOWN_TYPE',
    `Unsupported type ${describe(type)} for field '${field}'; use one of ${Object.keys(
      TYPES
    ).join(', ')} or a Sequelize data type`
  );
};

/**
 * The henri exact type a field asks for, whichever way it was spelled.
 *
 * A Sequelize `DECIMAL(10, 2)` is the same column as
 * `{ type: 'decimal', precision: 10, scale: 2 }`, so it is read as one and
 * gets the same string boundary rather than whatever the driver felt like
 * handing back. A **bare** `DataTypes.DECIMAL` is not: MySQL makes it
 * `DECIMAL(10, 0)`, which stores money as whole units, so it is refused by
 * the caller instead of quietly becoming something else.
 *
 * @param {*} type The type from the model file
 * @returns {?object} `{ bare, precision, scale, type }`, or null
 */
const exactTypeOf = (type) => {
  if (typeof type === 'string' && isExact(type.toLowerCase())) {
    return { bare: false, type: type.toLowerCase() };
  }

  const key = type === DataTypes.DECIMAL || type === DataTypes.BIGINT;
  const name = key
    ? type.key
    : (type instanceof DataTypes.DECIMAL && 'DECIMAL') ||
      (type instanceof DataTypes.BIGINT && 'BIGINT') ||
      null;

  if (!name) {
    return null;
  }

  if (name === 'BIGINT') {
    return { bare: false, type: 'bigint' };
  }

  const options = (!key && type.options) || {};
  const bare = !Number.isInteger(options.precision);

  return {
    bare,
    precision: options.precision,
    scale: Number.isInteger(options.scale) ? options.scale : 0,
    type: 'decimal',
  };
};

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
 * Turns a field into an exact Sequelize attribute: the parameterized
 * column, a setter that canonicalizes, a validator that says what a value
 * the column will not carry is wrong with, and a getter that answers the
 * decimal string every adapter answers with.
 *
 * @param {object} attribute The Sequelize attribute, changed in place
 * @param {string} field The field name
 * @param {object} exact What `exactTypeOf()` read
 * @param {object} definition The field definition
 * @param {string} dialect The Sequelize dialect
 * @param {object} context `{ model }`, for the messages
 * @returns {void}
 * @throws {Error} On sqlite, on a bare DECIMAL, and on bad settings
 */
const decorateExact = (
  attribute,
  field,
  exact,
  definition,
  dialect,
  context
) => {
  const model = (context && context.model) || 'model';

  // The one downgrade this adapter cannot make quiet. Sequelize reads a
  // sqlite DECIMAL through a double and a BIGINT past 2^53 loses its
  // digits, and there is no seam here to store the value as text and cast
  // for a comparison the way @usehenri/drizzle does
  if (dialect === 'sqlite') {
    throw coded(
      'HENRI_MODEL_TYPE_UNSUPPORTED',
      `Field '${field}' of ${model} is a ${exact.type}, which @usehenri/sequelize cannot carry on sqlite: the driver reads it through a JavaScript number and the value would come back changed. Use @usehenri/drizzle, which stores both exactly on sqlite, or put the store on postgres, mysql or mssql`
    );
  }

  if (exact.bare) {
    throw coded(
      'HENRI_MODEL_TYPE_UNSUPPORTED',
      `Field '${field}' of ${model} is a DECIMAL with no precision, which MySQL makes DECIMAL(10, 0) -- whole units, so money loses its cents. Write { type: 'decimal', precision: 12, scale: 2 } and henri writes the same column on every dialect`
    );
  }

  const wrong = checkSettings(
    exact.type,
    exact.type === 'decimal' && Number.isInteger(exact.precision)
      ? exact
      : definition
  );

  if (wrong) {
    throw coded(
      'HENRI_MODEL_INVALID_FIELD',
      `Field '${field}' of ${model} ${wrong}`
    );
  }

  const settings = settingsOf(
    Number.isInteger(exact.precision) ? exact : definition
  );

  attribute.type =
    exact.type === 'bigint'
      ? DataTypes.BIGINT
      : DataTypes.DECIMAL(settings.precision, settings.scale);

  /**
   * The stored value as the decimal string, whatever the driver gave
   *
   * @returns {?string} The value
   */
  attribute.get = function get() {
    const raw = this.getDataValue(field);

    return raw === null || typeof raw === 'undefined' ? raw : String(raw);
  };

  /**
   * The canonical value when it fits the column, and the value untouched
   * when it does not, so the validator below is what says why
   *
   * @param {*} value The value
   * @returns {void}
   */
  attribute.set = function set(value) {
    if (value === null || typeof value === 'undefined') {
      this.setDataValue(field, value);

      return;
    }

    const answer = exactly(exact.type, value, settings);

    this.setDataValue(field, answer.error ? value : answer.value);
  };

  attribute.validate = {
    ...(attribute.validate || {}),

    /**
     * The bounds of the column, which the dialect would round to instead
     *
     * @param {*} value The stored value
     * @returns {void}
     * @throws {Error} When the value does not fit
     */
    henriExact(value) {
      if (value === null || typeof value === 'undefined') {
        return;
      }

      const answer = exactly(exact.type, value, settings);

      if (answer.error) {
        throw new Error(answer.error);
      }
    },
  };

  if (typeof attribute.defaultValue !== 'undefined') {
    const answer = exactly(exact.type, attribute.defaultValue, settings);

    if (answer.error) {
      throw coded(
        'HENRI_MODEL_INVALID_FIELD',
        `Field '${field}' of ${model} has a default that ${answer.error}`
      );
    }

    attribute.defaultValue = answer.value;
  }
};

/**
 * Normalizes one field definition
 *
 * @param {string} field The field name
 * @param {*} definition The definition from the model file
 * @param {string} dialect The Sequelize dialect (for ENUM support)
 * @param {Array<object>} indexes Collector for `index: true` fields
 * @param {object} [context] `{ encrypted, isUser, model }`, the collector
 *   of the fields marked `encrypted` and what the messages name them by
 * @returns {object} A Sequelize attribute
 * @throws {Error} On unknown keys, types or marks
 */
const normalizeField = (
  field,
  definition,
  dialect,
  indexes,
  context = { encrypted: {} }
) => {
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
    return { type: TYPES.json };
  }

  const attribute = {};

  for (const key of Object.keys(definition)) {
    const value = definition[key];

    if (key === 'type') {
      attribute.type = resolveType(value, field);
    } else if (key === 'required') {
      attribute.allowNull = !value;
    } else if (key === 'default') {
      attribute.defaultValue = value === Date.now ? DataTypes.NOW : value;
    } else if (key === 'enum' || key === 'index') {
      // Handled below, they depend on the resolved type
    } else if (
      key === 'personal' ||
      key === 'encrypted' ||
      key === 'precision' ||
      key === 'scale'
    ) {
      // Marks for henri, and nothing Sequelize has to know about: the
      // encryption one and the decimal column are applied below, once the
      // type has resolved
    } else if (KNOWN_KEYS.has(key)) {
      attribute[key] = value;
    } else {
      throw coded(
        'HENRI_MODEL_INVALID_FIELD',
        `Unknown key '${key}' on field '${field}'; supported keys are ${[
          ...KNOWN_KEYS,
        ].join(', ')}`
      );
    }
  }

  if (Array.isArray(definition.enum)) {
    if (attribute.type === TYPES.string && ENUM_DIALECTS.has(dialect)) {
      attribute.type = DataTypes.ENUM(...definition.enum);
    } else {
      attribute.validate = {
        ...(attribute.validate || {}),
        isIn: [definition.enum],
      };
    }
  }

  if (definition.index && !attribute.unique) {
    indexes.push({ fields: [field] });
  }

  // A `decimal` or a `bigint` is an exact column and a decimal string in
  // JavaScript on every adapter, which is what ./exact.js argues; the two
  // Sequelize spellings of the same thing are read as the henri type
  const exact = exactTypeOf(definition.type);

  if (exact) {
    decorateExact(attribute, field, exact, definition, dialect, context);
  }

  // The column of an encrypted field is the ciphertext's, not the
  // plaintext's: a `string` no longer fits in a varchar(255) once it
  // carries an iv, a tag and base64url. See ./encrypted.js
  const encrypted = encryptionOf(field, definition, context);

  if (encrypted) {
    attribute.type = encrypted.deterministic
      ? DataTypes.STRING(DETERMINISTIC_LENGTH)
      : DataTypes.TEXT;
    context.encrypted[field] = encrypted;
  }

  return attribute;
};

/**
 * Turns a henri model schema into Sequelize attributes
 *
 * Accepts the henri format (`{ type: 'string', required: true, default: 'x',
 * enum: [...], unique: true, index: true }`, constructors like `String`) as
 * well as plain Sequelize attributes, and throws on anything else so a typo
 * never ends up as a silently ignored option.
 *
 * @param {object} [schema={}] The model schema
 * @param {object} [options={}] Options
 * @param {string} [options.dialect] The Sequelize dialect (ENUM support)
 * @param {boolean} [options.isUser] Is this the user model? (reserved fields)
 * @param {string} [options.model] The global id, for the error messages
 * @returns {{ attributes: object, encrypted: object, indexes: Array<object> }}
 *   Sequelize attributes, the fields marked `encrypted` and the indexes
 *   requested with `index: true`
 * @throws {Error} On unknown keys, types or marks
 */
const normalizeSchema = (schema = {}, options = {}) => {
  const { dialect, isUser = false, model = 'model' } = options;
  const indexes = [];
  const attributes = {};
  const context = { encrypted: {}, isUser, model };

  for (const field of Object.keys(schema)) {
    attributes[field] = normalizeField(
      field,
      schema[field],
      dialect,
      indexes,
      context
    );
  }

  return { attributes, encrypted: context.encrypted, indexes };
};

module.exports = { isDataType, normalizeField, normalizeSchema, resolveType };
