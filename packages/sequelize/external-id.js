const { randomFillSync } = require('node:crypto');

/**
 * The public identifier every record carries: `externalId` in the model
 * API, `external_id` in the database.
 *
 * The primary key stays what it always was (a bigint on SQL, an ObjectId on
 * MongoDB) and never leaves the server; the external id is the only
 * identifier routes, links and payloads carry, so nothing outside can see or
 * guess a sequential number.
 *
 * The values are UUID version 7 (RFC 9562): 48 bits of Unix time in
 * milliseconds, then a 12 bit counter, then randomness. Version 4 would do
 * as an identifier, but this column is unique, indexed and written on every
 * insert, and a random uuid lands in a different page of the b-tree every
 * time; a time ordered one appends to the right edge like the bigint it
 * hides. Node only generates version 4 (`crypto.randomUUID()`), and the
 * generator below is small enough that a dependency is not worth it.
 */

// The name of the field in the model API, and of the column in the database
const EXTERNAL_ID = 'externalId';
const EXTERNAL_ID_COLUMN = 'external_id';

// Any RFC 4122/9562 uuid, whoever generated it. A number, a bigint written
// as a string and a 24 character MongoDB ObjectId all fail this test, which
// is what tells the two kinds of identifier apart on a lookup.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bytes = new Uint8Array(16);
// The millisecond the last uuid was stamped with, and the counter inside it.
// The counter is what keeps two uuids of the same millisecond ordered; when
// it overflows the stamp borrows the next millisecond (RFC 9562 6.2, method
// 1: a fixed length dedicated counter).
let stamp = 0;
let counter = 0;

/**
 * Is the value a uuid (and therefore an external id rather than a primary
 * key)?
 *
 * @param {*} value Anything
 * @returns {boolean} true for a uuid
 */
const isUuid = (value) => typeof value === 'string' && UUID.test(value);

/**
 * Normalizes an external id the way it is stored (lowercase)
 *
 * @param {*} value An external id
 * @returns {*} The lowercased uuid (other values untouched)
 */
const normalizeExternalId = (value) =>
  isUuid(value) ? value.toLowerCase() : value;

/**
 * A UUID version 7 (RFC 9562), monotonic within a millisecond
 *
 * @returns {string} The uuid, lowercase, with its dashes
 */
const uuidv7 = () => {
  const now = Date.now();

  randomFillSync(bytes);

  if (now > stamp) {
    stamp = now;
    // Seeded in the lower half so the counter has room to grow without
    // borrowing a millisecond it does not own
    counter = ((bytes[6] << 8) | bytes[7]) & 0x7ff;
  } else if (counter >= 0xfff) {
    // 4096 uuids in the same millisecond: take the next one
    stamp += 1;
    counter = 0;
  } else {
    counter += 1;
  }

  bytes[0] = Math.floor(stamp / 0x10000000000) & 0xff;
  bytes[1] = Math.floor(stamp / 0x100000000) & 0xff;
  bytes[2] = Math.floor(stamp / 0x1000000) & 0xff;
  bytes[3] = Math.floor(stamp / 0x10000) & 0xff;
  bytes[4] = Math.floor(stamp / 0x100) & 0xff;
  bytes[5] = stamp & 0xff;
  // Version 7 in the high nibble, the counter in the twelve bits after it
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  // Variant 10xx, the remaining 62 bits stay random
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = Buffer.from(bytes).toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Does this model file want an external id? Every model does, unless it
 * opts out with `options: { externalId: false }`.
 *
 * @param {object} [model={}] A model file
 * @returns {boolean} true when the model gets an external id
 */
const wantsExternalId = (model = {}) =>
  ((model && model.options) || {}).externalId !== false;

/**
 * Is the value a plain object (a record, as opposed to a Date or a class)?
 *
 * @param {*} value Anything
 * @returns {boolean} true for plain objects
 */
const isPlain = (value) => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
};

/**
 * Removes the internal id from a serialized record and from every record
 * nested in it: an object carrying a public identifier has no business
 * carrying the primary key too. Objects without one are left alone, which
 * is what `options: { externalId: false }` relies on.
 *
 * @param {*} value A serialized record, a list of them, or anything else
 * @returns {*} The value without its internal ids
 */
const withoutInternalIds = (value) => {
  if (Array.isArray(value)) {
    return value.map(withoutInternalIds);
  }

  if (!isPlain(value)) {
    return value;
  }

  const copy = {};

  for (const key of Object.keys(value)) {
    copy[key] = withoutInternalIds(value[key]);
  }

  if (typeof copy[EXTERNAL_ID] === 'string' && copy[EXTERNAL_ID] !== '') {
    delete copy.id;
    delete copy._id;
  }

  return copy;
};

module.exports = {
  EXTERNAL_ID,
  EXTERNAL_ID_COLUMN,
  isUuid,
  normalizeExternalId,
  uuidv7,
  wantsExternalId,
  withoutInternalIds,
};
