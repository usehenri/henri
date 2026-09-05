/**
 * One shape for the validation errors of every adapter.
 *
 * Mongoose, Sequelize and Drizzle all reject an invalid write differently:
 * a `ValidationError` with an `errors` object keyed by field (Mongoose,
 * Drizzle), an array of `{ path, message }` (Sequelize), a driver error
 * with a `keyPattern` (a duplicate key on MongoDB) or a
 * `SequelizeUniqueConstraintError`. `henri.model.errors(error)` turns any
 * of them into `{ field: message }`, and answers `null` for anything that
 * is not a validation failure, so a controller can tell a 422 from a bug:
 *
 * ```js
 * try {
 *   post = await Post.create(req.permit(...FIELDS));
 * } catch (error) {
 *   const errors = henri.model.errors(error);
 *
 *   if (!errors) {
 *     throw error;
 *   }
 *
 *   return res.boom.badData(error.message, { errors });
 * }
 * ```
 */

// Errors of the ORMs that always mean "the attributes are invalid"
const VALIDATION_NAMES = new Set([
  'SequelizeUniqueConstraintError',
  'SequelizeValidationError',
  'ValidationError',
]);

// The MongoDB duplicate key error, whatever the driver calls it
const DUPLICATE_KEY = 11000;

// Where an error with no field of its own is filed (Rails' errors[:base])
const BASE = 'base';

/**
 * The message of one entry, whatever the ORM put in it
 *
 * @param {*} detail The entry (an object, or the message itself)
 * @param {string} field The field it belongs to
 * @returns {string} The message
 */
const messageOf = (detail, field) => {
  if (typeof detail === 'string') {
    return detail;
  }

  if (detail && typeof detail.message === 'string') {
    return detail.message;
  }

  return `${field} is invalid`;
};

/**
 * The `{ field: message }` of a list of entries (Sequelize)
 *
 * @param {Array<object>} entries The entries
 * @returns {object} The messages by field
 */
const fromArray = (entries) =>
  entries.reduce((errors, detail) => {
    const field = (detail && (detail.path || detail.field)) || BASE;

    errors[field] = messageOf(detail, field);

    return errors;
  }, {});

/**
 * The `{ field: message }` of an object of entries (Mongoose, Drizzle)
 *
 * @param {object} entries The entries, keyed by field
 * @returns {object} The messages by field
 */
const fromObject = (entries) =>
  Object.keys(entries).reduce((errors, field) => {
    errors[field] = messageOf(entries[field], field);

    return errors;
  }, {});

/**
 * The fields of a duplicate key error, from whichever key the driver set
 *
 * @param {Error} error The error
 * @returns {Array<string>} The field names
 */
const duplicateFields = (error) => {
  const { keyPattern, keyValue } = error;

  if (keyPattern && typeof keyPattern === 'object') {
    return Object.keys(keyPattern);
  }

  if (keyValue && typeof keyValue === 'object') {
    return Object.keys(keyValue);
  }

  const match = /index:\s+(\S+?)_\d+/.exec(error.message || '');

  return match ? [match[1]] : [];
};

/**
 * Is the error a duplicate key rejected by MongoDB?
 *
 * @param {Error} error The error
 * @returns {boolean} true for the 11000 code
 */
const isDuplicateKey = (error) =>
  error.code === DUPLICATE_KEY ||
  (error.cause && error.cause.code === DUPLICATE_KEY);

/**
 * The validation messages of an error, one shape for every adapter
 *
 * @param {*} error What the model threw
 * @returns {?object} `{ field: message }`, or null when the error is not a
 *   validation failure and should be rethrown
 */
const modelErrors = (error) => {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const { errors } = error;

  if (VALIDATION_NAMES.has(error.name)) {
    if (Array.isArray(errors)) {
      return fromArray(errors);
    }

    if (errors && typeof errors === 'object' && Object.keys(errors).length) {
      return fromObject(errors);
    }

    return { [BASE]: error.message };
  }

  if (isDuplicateKey(error)) {
    const fields = duplicateFields(error);

    return fields.length > 0
      ? Object.fromEntries(fields.map((field) => [field, 'must be unique']))
      : { [BASE]: 'must be unique' };
  }

  return null;
};

module.exports = { BASE, modelErrors };
