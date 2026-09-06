/**
 * The public identifier of a record.
 *
 * Every model carries an `externalId` (a uuid, see the adapters'
 * `external-id.js`) unless it opts out with `options: { externalId: false }`.
 * The primary key is internal: it is what joins and indexes are made of and
 * it never leaves the server, so nothing outside can see or guess a
 * sequential number.
 *
 * The adapters take care of what they serialize themselves; this is the last
 * gate on the way out, for the plain objects an application hands to
 * `res.render()`, `res.resource()` or `res.collection()` without going
 * through a model instance (a `.lean()` query, a hand-built object, a row
 * from `henri.model.stores.default.query()`).
 */

/** The field the public identifier lives in */
const EXTERNAL_ID = 'externalId';

// Any RFC 4122/9562 uuid. Neither a number nor a 24 character ObjectId can
// match it, which is what tells the two kinds of identifier apart.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Is the value a uuid (a public identifier rather than a primary key)?
 *
 * @param {*} value anything
 * @returns {boolean} true for a uuid
 */
function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Does this object carry a public identifier?
 *
 * @param {*} value anything
 * @returns {boolean} true when it has a non empty `externalId`
 */
function hasExternalId(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value[EXTERNAL_ID] === 'string' &&
    value[EXTERNAL_ID] !== ''
  );
}

/**
 * Is the value a plain object (a record, not a Date or a class instance)?
 *
 * @param {*} value anything
 * @returns {boolean} true for plain objects
 */
function isPlain(value) {
  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/**
 * A copy of a value without the internal ids: every object carrying an
 * `externalId` loses its `id` and `_id`, at any depth. Model instances are
 * serialized through their own `toJSON()` first, so the schema options
 * (hidden fields, virtuals) apply. Objects without a public identifier are
 * left untouched, which is what `options: { externalId: false }` relies on.
 *
 * @param {*} value a record, a list of records, or anything else
 * @param {WeakMap} [seen] the copy of each object already visited, so that
 *   a record appearing twice is copied once and a cycle terminates
 * @returns {*} the value, without the internal ids
 */
function stripInternalIds(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') {
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
    value.forEach((entry) => copy.push(stripInternalIds(entry, seen)));

    return copy;
  }

  // A model instance (Mongoose, Sequelize, Drizzle) knows how to serialize
  // itself; an ObjectId answers with its string
  const plain = typeof value.toJSON === 'function' ? value.toJSON() : value;

  if (!plain || typeof plain !== 'object' || !isPlain(plain)) {
    seen.set(value, plain);

    return plain;
  }

  const copy = {};

  seen.set(value, copy);

  for (const key of Object.keys(plain)) {
    copy[key] = stripInternalIds(plain[key], seen);
  }

  if (hasExternalId(copy)) {
    delete copy.id;
    delete copy._id;
  }

  return copy;
}

module.exports = { EXTERNAL_ID, hasExternalId, isUuid, stripInternalIds };
