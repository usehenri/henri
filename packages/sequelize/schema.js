const { DataTypes } = require('sequelize');
const TYPES = require('./types');
const { coded } = require('./utils');

// Dialects with a native ENUM column type
const ENUM_DIALECTS = new Set(['mariadb', 'mysql', 'postgres']);

// Keys of the henri model format (Mongoose style) and their Sequelize meaning
const HENRI_KEYS = {
  default: 'defaultValue',
  enum: 'DataTypes.ENUM or validate.isIn',
  index: 'options.indexes',
  // Metadata, not a column: henri reads it back through the model file
  // (base/privacy.js), so the attribute never carries it
  personal: 'henri.privacy',
  required: 'allowNull: false',
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
    `Unsupported type ${describe(type)} for field '${field}'`
  );
};

/**
 * Normalizes one field definition
 *
 * @param {string} field The field name
 * @param {*} definition The definition from the model file
 * @param {string} dialect The Sequelize dialect (for ENUM support)
 * @param {Array<object>} indexes Collector for `index: true` fields
 * @returns {object} A Sequelize attribute
 * @throws {Error} On unknown keys or types
 */
const normalizeField = (field, definition, dialect, indexes) => {
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
    } else if (key === 'personal') {
      // A mark for henri, and nothing Sequelize has to know about
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
 * @returns {{ attributes: object, indexes: Array<object> }} Sequelize
 * attributes and the indexes requested with `index: true`
 * @throws {Error} On unknown keys or types
 */
const normalizeSchema = (schema = {}, { dialect } = {}) => {
  const indexes = [];
  const attributes = {};

  for (const field of Object.keys(schema)) {
    attributes[field] = normalizeField(field, schema[field], dialect, indexes);
  }

  return { attributes, indexes };
};

module.exports = { isDataType, normalizeField, normalizeSchema, resolveType };
