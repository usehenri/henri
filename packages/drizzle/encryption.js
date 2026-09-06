const {
  contextOf,
  encryptionOn,
  isPlainObject,
  lookupValues,
  notQueryable,
} = require('./encrypted');

/**
 * Encrypted attributes on a Drizzle model.
 *
 * The mark and what it refuses are in `./encrypted.js`; the envelope and
 * the keys are core's. This is the Drizzle half, and it is the smallest of
 * the three, because this adapter's model layer is henri's own: there is
 * one place a row is turned into an instance (`Model.hydrate`), one place
 * attributes are prepared for a write (`Model.prepare`) and one place a
 * condition becomes SQL (`compileWhere`).
 *
 * ## Reading
 *
 * An `afterLoad` hook, which `hydrate()` runs on the row before the
 * instance is built -- and which the association hydration runs too, so a
 * `Proposal.find({}, { include: ['speaker'] })` decrypts the speaker as
 * well. The instance is built from the plaintext, so `changed()`,
 * `toJSON()` and everything the router serializes see what the
 * application wrote.
 *
 * A value that will not decrypt fails the query rather than the property
 * read, which is where this adapter differs from the Sequelize one and
 * cannot help it: `hydrate()` is eager by construction. The code is the
 * same, and `henri.encryption.tolerate()` is the same way past it.
 *
 * ## Writing
 *
 * `beforeCreate` and `beforeUpdate`, which run after `validate()`, so a
 * `maxLength` still measures the plaintext. `options.encrypted` says the
 * caller is handing over envelopes already -- the shape the rotation
 * writes with, and the one `passwordsHashed` already had.
 *
 * ## Querying
 *
 * `compileWhere` calls `translate()` before it builds a comparison. A
 * deterministic field becomes an `IN` over one envelope per configured
 * key, so a lookup keeps working while a rotation is in flight; a
 * randomised one, an order, or anything that is not an equality is a
 * refusal, never a query that quietly matches nothing.
 *
 * @module encryption
 */

/** The operators an encrypted column can still be compared with */
const EQUALITY = ['eq', 'in'];

/** ... and the negations of those */
const NEGATIONS = ['ne', 'not', 'nin', 'notIn'];

/**
 * The mark of a field, when the model declared one
 *
 * @param {function} Model The model class
 * @param {string} field The field name
 * @returns {?object} `{ deterministic }`, or null
 */
const markOf = (Model, field) => {
  const definition = Model && Model.fields && Model.fields[field];

  return (definition && definition.encrypted) || null;
};

/**
 * Does this model hold anything encrypted?
 *
 * @param {function} Model The model class
 * @returns {boolean} true when at least one field is marked
 */
const hasEncrypted = (Model) =>
  Boolean(
    Model &&
    Model.fields &&
    Object.keys(Model.fields).some((field) => Model.fields[field].encrypted)
  );

/**
 * The stored form of a value a condition is comparing against.
 *
 * Called by `compileWhere` for every field of every condition, so it has
 * to be cheap on the fields that are not encrypted: the mark lookup is
 * one property read.
 *
 * @param {function} Model The model class
 * @param {string} field The field name
 * @param {*} value What the condition compares against
 * @param {?string} [operator=null] The operator, when there is one
 * @returns {*} The value to compare against instead
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE on a randomised field, or on
 *   anything that is not an equality
 */
const translate = (Model, field, value, operator = null) => {
  const mark = markOf(Model, field);

  if (!mark) {
    return value;
  }

  const name = contextOf(Model.modelName, field);

  if (operator !== null && ![...EQUALITY, ...NEGATIONS].includes(operator)) {
    throw notQueryable(
      name,
      `it cannot be compared with ${operator}`,
      mark.deterministic
    );
  }

  if (value === null || typeof value === 'undefined') {
    return value;
  }

  const encryption = encryptionOn(Model.adapter.henri, name);
  const candidates = (wanted) => lookupValues(encryption, name, mark, wanted);

  return Array.isArray(value)
    ? value.flatMap((entry) => candidates(entry))
    : candidates(value);
};

/**
 * The stored form of one equality, as the single value `eq` wants or the
 * list `IN` wants
 *
 * @param {function} Model The model class
 * @param {string} field The field name
 * @param {*} value What the condition compares against
 * @param {?string} [operator=null] The operator
 * @returns {{list: ?Array, value: *}} The list when there is more than one
 *   candidate, the value otherwise
 */
const comparison = (Model, field, value, operator = null) => {
  if (!markOf(Model, field)) {
    return { list: null, value };
  }

  const found = translate(Model, field, value, operator);

  if (!Array.isArray(found)) {
    return { list: null, value: found };
  }

  return found.length === 1
    ? { list: null, value: found[0] }
    : { list: found, value: found };
};

/**
 * Refuses an order on an encrypted column: it would answer, ordered by
 * bytes nobody chose
 *
 * @param {function} Model The model class
 * @param {string} field The field name
 * @returns {void}
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE
 */
const checkOrder = (Model, field) => {
  const mark = markOf(Model, field);

  if (mark) {
    throw notQueryable(
      contextOf(Model.modelName, field),
      'cannot be ordered by',
      mark.deterministic
    );
  }
};

/**
 * Encrypts the values of a write, in place
 *
 * @param {function} Model The model class
 * @param {object} values The attributes about to be written
 * @param {object} [options={}] `encrypted` opts out
 * @returns {object} The values
 * @throws HENRI_ENCRYPTION_NO_KEY, HENRI_ENCRYPTION_TOO_LONG
 */
const encryptValues = (Model, values, options = {}) => {
  if (!isPlainObject(values) || options.encrypted === true) {
    return values;
  }

  for (const field of Object.keys(values)) {
    const mark = markOf(Model, field);
    const value = values[field];

    if (!mark || value === null || typeof value === 'undefined') {
      continue;
    }

    const name = contextOf(Model.modelName, field);

    // No shape check: a value is encrypted because the caller did not say
    // `{ encrypted: true }`, never because it does not look like an
    // envelope already. A request that can put a string in this column
    // could otherwise put one shaped like an envelope and have it stored
    // in the clear
    values[field] = encryptionOn(Model.adapter.henri, name).encrypt(value, {
      context: name,
      deterministic: mark.deterministic,
    });
  }

  return values;
};

/**
 * Decrypts the encrypted columns of a row, in place
 *
 * @param {function} Model The model class
 * @param {object} row The row as the database answered it
 * @returns {object} The row
 * @throws HENRI_ENCRYPTION_KEY_UNKNOWN, HENRI_ENCRYPTION_UNREADABLE,
 *   HENRI_ENCRYPTION_PLAINTEXT
 */
const decryptRow = (Model, row) => {
  if (!row || typeof row !== 'object') {
    return row;
  }

  for (const field of Object.keys(Model.fields)) {
    const mark = Model.fields[field].encrypted;
    const value = row[field];

    if (!mark || value === null || typeof value === 'undefined') {
      continue;
    }

    const name = contextOf(Model.modelName, field);

    row[field] = encryptionOn(Model.adapter.henri, name).read(value, {
      context: name,
      deterministic: mark.deterministic,
    });
  }

  return row;
};

/**
 * The whole of it on one model: the hooks that write and the hook that
 * reads. The query side is `compileWhere`, which calls `translate()`
 * directly.
 *
 * @param {function} Model The model class
 * @returns {function} The model
 */
const decorateModel = (Model) => {
  Model.internalHooks.beforeCreate.push((values, options = {}) =>
    encryptValues(Model, values, options)
  );

  Model.internalHooks.beforeUpdate.push((values, options = {}) =>
    encryptValues(Model, values, options)
  );

  Model.internalHooks.afterLoad.push((row) => decryptRow(Model, row));

  return Model;
};

module.exports = {
  checkOrder,
  comparison,
  decorateModel,
  decryptRow,
  encryptValues,
  hasEncrypted,
  markOf,
  translate,
};
