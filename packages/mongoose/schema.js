const TYPES = require('./types');
const { encryptionOf, isPlainObject } = require('./encrypted');
const { checkSettings, isExact, settingsOf } = require('./exact');
const { setter } = require('./exact-paths');
const { coded } = require('./utils');

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
 * @param {string} [field='field'] The field name (for the error messages)
 * @param {object} [context] `{ encrypted, isUser, model }`, the collector
 *   of the fields marked `encrypted`
 * @returns {*} A Mongoose schema definition
 * @throws {Error} On a mark henri does not understand
 */
const normalizeField = (
  definition,
  field = 'field',
  context = { encrypted: {} }
) => {
  if (Array.isArray(definition)) {
    return definition.map((entry) => normalizeField(entry, field, context));
  }

  if (!isPlainObject(definition)) {
    return resolveType(definition);
  }

  if (!('type' in definition)) {
    // A nested document (`address: { street: String }`) or Mixed (`{}`)
    return normalizeSchema(definition);
  }

  // Marks for henri: `personal` for base/privacy.js, `encrypted` for
  // base/encryption.js. Neither is a Mongoose option, and neither are the
  // `precision` and `scale` of a decimal column
  const {
    allowNull,
    defaultValue,
    encrypted,
    personal,
    precision,
    scale,
    type,
    ...rest
  } = definition;
  const mark = encryptionOf(field, definition, context);
  const shaped = { ...rest, type: normalizeField(type, field, context) };
  const name = typeof type === 'string' ? type.toLowerCase() : null;
  const wrong = checkSettings(name, definition);

  if (wrong) {
    throw coded('HENRI_MODEL_INVALID_FIELD', `Field '${field}' ${wrong}`);
  }

  // A `decimal` is padded to its scale on the way in and read back as a
  // string on the way out, so a model file answers the same value here as
  // it does on the SQL adapters (./exact-paths.js)
  if (isExact(name)) {
    const settings = settingsOf(definition);

    shaped.set = setter(field, name, settings);

    if (typeof shaped.default !== 'undefined') {
      shaped.default = shaped.set(shaped.default);
    }
  }

  if (allowNull === false && typeof shaped.required === 'undefined') {
    shaped.required = true;
  }

  if (typeof defaultValue !== 'undefined' && !('default' in shaped)) {
    shaped.default = defaultValue;
  }

  if (mark) {
    context.encrypted[field] = mark;
    // A ciphertext is a string whatever the plaintext was declared as,
    // and nothing about the value survives to be trimmed or lowercased
    shaped.type = String;
    delete shaped.trim;
    delete shaped.lowercase;
    delete shaped.uppercase;
  }

  return shaped;
};

/**
 * Turns a henri model schema into a Mongoose schema definition
 *
 * @param {object} [schema={}] The model schema
 * @param {object} [context] `{ encrypted, isUser, model }`, the collector
 *   of the fields marked `encrypted`
 * @returns {object} The definition for `new Schema()`
 * @throws {Error} On a mark henri does not understand
 */
const normalizeSchema = (schema = {}, context = { encrypted: {} }) =>
  Object.keys(schema).reduce((definition, field) => {
    definition[field] = normalizeField(schema[field], field, context);

    return definition;
  }, {});

/**
 * The same, and the fields the model marked `encrypted` beside it: what
 * `addModel()` needs and what a nested document never has
 *
 * @param {object} [schema={}] The model schema
 * @param {object} [options={}] `isUser` and `model` (the global id)
 * @returns {{definition: object, encrypted: object}} Both
 * @throws {Error} On a mark henri does not understand
 */
const normalizeModel = (schema = {}, options = {}) => {
  const context = {
    encrypted: {},
    isUser: options.isUser === true,
    model: options.model || 'model',
  };

  return {
    definition: normalizeSchema(schema, context),
    encrypted: context.encrypted,
  };
};

module.exports = {
  normalizeField,
  normalizeModel,
  normalizeSchema,
  resolveType,
};
