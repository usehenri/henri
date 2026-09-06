/**
 * The `encrypted` mark, as an adapter reads it.
 *
 * A field says it in the schema, next to its type:
 *
 * ```js
 * schema: {
 *   ssn: { encrypted: true, type: 'string' },
 *   badge: { encrypted: { deterministic: true }, type: 'string', unique: true },
 * }
 * ```
 *
 * The envelope, the keys and the rotation are core's
 * (`@usehenri/core/src/base/encryption.js`, reached at runtime as
 * `henri.encryption`, the way a password reaches `henri.user.encrypt`).
 * This file is the half an adapter needs before there is a runtime: what
 * the mark means, what column it asks for, and which of the things a model
 * file can say about a field stop making sense once it is ciphertext.
 *
 * It is copied verbatim into `@usehenri/sequelize`, `@usehenri/mongoose`
 * and `@usehenri/drizzle`, like `external-id.js`: three adapters that must
 * answer identically, and no fourth package to depend on.
 *
 * ## What it refuses, and why it refuses rather than warns
 *
 * - **a type that is not `string` or `text`.** A ciphertext is a string.
 *   Encrypting a date would mean the column stops being a date, and every
 *   comparison, sort and index on it would change meaning quietly.
 * - **`unique` or `index` on a randomised field.** A randomised
 *   ciphertext is different every time, so the index is an index over
 *   noise and the constraint constrains nothing. Two rows holding the same
 *   value would both be accepted, which is the opposite of what `unique`
 *   was written for.
 * - **a field henri itself queries.** `email`, `password` and `roles` on
 *   the user model belong to the framework: henri looks a person up by
 *   address on every sign-in, and the password is already a hash. A model
 *   that marks one of them gets a refusal naming it.
 * - **`default`.** A default is written by the database, in the clear.
 *
 * Each of those is a boot failure rather than a warning, because every one
 * of them has the same failure mode if it is let through: an application
 * that believes a column is protected and queryable when it is one or the
 * other.
 *
 * @module encrypted
 */

/**
 * The column a deterministic field is stored in.
 *
 * The smallest index key among the four dialects henri speaks is MySQL's
 * 3072 bytes on `utf8mb4`, which is 768 characters -- so a deterministic
 * field, which has to stay indexable, is a `varchar(700)`. A randomised
 * one is `text`: nothing indexes it, so nothing bounds it.
 */
const DETERMINISTIC_LENGTH = 700;

/** The henri schema types that may be encrypted */
const ENCRYPTABLE_TYPES = ['string', 'text'];

/**
 * The fields of the user model henri owns and queries. Encrypting one of
 * them would break the sign-in, and doing it deterministically so that it
 * kept working would put a unique index on a column whose ciphertext
 * changes with the key -- two live keys, and one address could be
 * registered twice.
 */
const RESERVED = ['email', 'password', 'roles'];

/**
 * An Error carrying one of henri's error codes
 *
 * @param {string} code The henri error code
 * @param {string} message What went wrong
 * @param {string} [hint] What to do about it
 * @returns {Error} The error to throw
 */
const coded = (code, message, hint) =>
  Object.assign(new Error(message), hint ? { code, hint } : { code });

/**
 * `<Model>.<field>`: what a value is bound to, and what an error names.
 *
 * The additional authenticated data of every envelope is built from it, so
 * a ciphertext only opens in the field it was written for.
 *
 * @param {string} model The global id of the model
 * @param {string} field The field name
 * @returns {string} The context
 */
const contextOf = (model, field) => `${model}.${field}`;

/**
 * Is the value a plain object?
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
 * The mark of one field, or null when the field is not encrypted
 *
 * @param {string} field The field name
 * @param {*} definition The definition from the model file
 * @param {object} [options={}] `model` (the global id) and `isUser`
 * @returns {?{deterministic: boolean}} The mark, or null
 * @throws HENRI_ENCRYPTION_INVALID_MARK on a mark henri does not understand
 * @throws HENRI_ENCRYPTION_UNSUPPORTED_TYPE on a type henri does not encrypt
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE on `unique` or `index` without
 *   `deterministic`
 */
const encryptionOf = (field, definition, options = {}) => {
  if (!isPlainObject(definition) || !('encrypted' in definition)) {
    return null;
  }

  const { model = 'model' } = options;
  const name = contextOf(model, field);
  const mark = definition.encrypted;

  if (mark === false || mark === null || typeof mark === 'undefined') {
    return null;
  }

  if (mark !== true && !isPlainObject(mark)) {
    throw coded(
      'HENRI_ENCRYPTION_INVALID_MARK',
      `${name}: 'encrypted' must be true or { deterministic: true }`,
      'true encrypts randomised (different bytes every time, not queryable); { deterministic: true } encrypts so that an equality and a unique index still work, and leaks which rows share a value'
    );
  }

  const settings = mark === true ? {} : mark;
  const unknown = Object.keys(settings).filter(
    (key) => key !== 'deterministic'
  );

  if (unknown.length > 0) {
    throw coded(
      'HENRI_ENCRYPTION_INVALID_MARK',
      `${name}: 'encrypted' has no option named ${unknown.join(', ')}`,
      "The object form takes one key: { deterministic: true }. The key itself is config.encryption.keys, and it is the application's, not the field's"
    );
  }

  if (
    typeof settings.deterministic !== 'undefined' &&
    typeof settings.deterministic !== 'boolean'
  ) {
    throw coded(
      'HENRI_ENCRYPTION_INVALID_MARK',
      `${name}: 'encrypted.deterministic' must be true or false`,
      'It is the choice between a ciphertext that can be looked up and one that gives nothing away; there is no third value'
    );
  }

  const deterministic = settings.deterministic === true;
  const type =
    typeof definition.type === 'string' ? definition.type.toLowerCase() : null;

  if (!ENCRYPTABLE_TYPES.includes(type)) {
    throw coded(
      'HENRI_ENCRYPTION_UNSUPPORTED_TYPE',
      `${name}: only ${ENCRYPTABLE_TYPES.join(' and ')} fields may be encrypted, and this one is ${definition.type ? `'${definition.type}'` : 'untyped'}`,
      'A ciphertext is a string. Store the value as text and encrypt that, or leave the column in the clear'
    );
  }

  if (options.isUser && RESERVED.includes(field)) {
    throw coded(
      'HENRI_ENCRYPTION_INVALID_MARK',
      `${name}: henri owns ${field} on the user model and queries it, so it cannot be encrypted`,
      'The sign-in looks a person up by address on every request, and a unique index over a ciphertext stops being unique the moment a second key is live. Encrypt the fields the application owns instead'
    );
  }

  if (typeof definition.default !== 'undefined') {
    throw coded(
      'HENRI_ENCRYPTION_INVALID_MARK',
      `${name}: an encrypted field cannot have a default`,
      'A default is written by the database, which has no key: the column would hold that one value in the clear. Set it in a beforeCreate hook, or in the controller'
    );
  }

  if (!deterministic && (definition.unique === true || definition.index)) {
    throw coded(
      'HENRI_ENCRYPTION_NOT_QUERYABLE',
      `${name} is ${definition.unique === true ? 'unique' : 'indexed'} and encrypted randomised, which indexes nothing`,
      'A randomised ciphertext is different every time, so the index never matches and the constraint never fires. Mark it { encrypted: { deterministic: true } } and accept that equal values have equal ciphertexts, or drop the index'
    );
  }

  return { deterministic };
};

/**
 * The failure raised when a query reaches for a column that is ciphertext
 *
 * @param {string} context `<Model>.<field>`
 * @param {string} what What the query tried to do
 * @param {boolean} deterministic Is the field deterministic?
 * @returns {Error} The error to throw
 */
const notQueryable = (context, what, deterministic) =>
  coded(
    'HENRI_ENCRYPTION_NOT_QUERYABLE',
    `${context} is encrypted and ${what}`,
    deterministic
      ? 'A deterministic field can be compared for equality and nothing else: the database sees ciphertext, so a range, a pattern and an order are over bytes that carry no order. Read the rows and filter in the application, or keep a separate column for what has to be searched'
      : 'A randomised ciphertext is different every time, so this would match nothing rather than fail. Mark the field { encrypted: { deterministic: true } } if it has to be looked up by value, and accept that equal values have equal ciphertexts'
  );

/**
 * The stored forms of a value being looked up: one envelope per configured
 * key, so a lookup keeps working while a rotation is in flight.
 *
 * @param {object} encryption `henri.encryption`
 * @param {string} context `<Model>.<field>`
 * @param {object} mark The mark of the field
 * @param {*} value What the query is looking for
 * @returns {Array<string>} The envelopes to compare against
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE on a randomised field
 */
const lookupValues = (encryption, context, mark, value) => {
  if (!mark.deterministic) {
    throw notQueryable(context, 'cannot be looked up by value', false);
  }

  if (value === null || typeof value === 'undefined') {
    return [];
  }

  return encryption.candidates(value, { context, deterministic: true });
};

/**
 * `henri.encryption`, refusing to go on without it.
 *
 * An adapter running against a core too old to have the module, or a test
 * double that only implements half of it, must not quietly write the
 * column in the clear.
 *
 * @param {object} henri The henri instance
 * @param {string} context `<Model>.<field>`, for the message
 * @returns {object} The encryption module
 * @throws HENRI_ENCRYPTION_NO_KEY when there is nothing to encrypt with
 */
const encryptionOn = (henri, context) => {
  const encryption = henri && henri.encryption;

  if (
    !encryption ||
    typeof encryption.encrypt !== 'function' ||
    typeof encryption.read !== 'function'
  ) {
    throw coded(
      'HENRI_ENCRYPTION_NO_KEY',
      `${context} is marked encrypted and this henri has no encryption module`,
      'Encrypted attributes need @usehenri/core 1.3 or later; the adapter refuses rather than writing the column in the clear'
    );
  }

  return encryption;
};

module.exports = {
  DETERMINISTIC_LENGTH,
  ENCRYPTABLE_TYPES,
  RESERVED,
  coded,
  contextOf,
  encryptionOf,
  encryptionOn,
  isPlainObject,
  lookupValues,
  notQueryable,
};
