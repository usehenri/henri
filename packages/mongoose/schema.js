const TYPES = require('./types');

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
 * Resolves a henri type name to a Mongoose type; anything else is returned
 * as is (Mongoose knows constructors, 'ObjectId', schemas, ...)
 *
 * @param {*} type The type from the model file
 * @returns {*} The Mongoose type
 */
const resolveType = (type) => {
  if (typeof type === 'string' && TYPES[type.toLowerCase()]) {
    return TYPES[type.toLowerCase()];
  }

  return type;
};

/**
 * Normalizes one field definition, recursively
 *
 * Translates the henri type names and the Sequelize style keys `allowNull`
 * and `defaultValue`; every Mongoose option is passed through.
 *
 * @param {*} definition The definition from the model file
 * @returns {*} A Mongoose schema definition
 */
const normalizeField = (definition) => {
  if (Array.isArray(definition)) {
    return definition.map(normalizeField);
  }

  if (!isPlainObject(definition)) {
    return resolveType(definition);
  }

  if (!('type' in definition)) {
    // A nested document (`address: { street: String }`) or Mixed (`{}`)
    return normalizeSchema(definition);
  }

  const { allowNull, defaultValue, type, ...rest } = definition;
  const field = { ...rest, type: normalizeField(type) };

  if (allowNull === false && typeof field.required === 'undefined') {
    field.required = true;
  }

  if (typeof defaultValue !== 'undefined' && !('default' in field)) {
    field.default = defaultValue;
  }

  return field;
};

/**
 * Turns a henri model schema into a Mongoose schema definition
 *
 * @param {object} [schema={}] The model schema
 * @returns {object} The definition for `new Schema()`
 */
const normalizeSchema = (schema = {}) =>
  Object.keys(schema).reduce((definition, field) => {
    definition[field] = normalizeField(schema[field]);

    return definition;
  }, {});

module.exports = { normalizeField, normalizeSchema, resolveType };
