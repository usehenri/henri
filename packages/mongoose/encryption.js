const {
  contextOf,
  encryptionOn,
  isPlainObject,
  lookupValues,
  notQueryable,
} = require('./encrypted');

/**
 * Encrypted attributes on a Mongoose model.
 *
 * The mark and what it refuses are in `./encrypted.js`; the envelope and
 * the keys are core's. This is the Mongoose half.
 *
 * ## Reading: `post('init')`, not a getter
 *
 * A Mongoose getter runs on `doc.field` and on nothing else:
 * `toObject()`, `toJSON()` and `lean()` all skip it unless the schema
 * turns `getters` on globally, which changes how every other field
 * serializes. So the value is decrypted once, into the document's own
 * `_doc`, as it is hydrated -- which is `post('init')`, and which fires
 * for a `find`, a `populate` and a subdocument alike. Writing to `_doc`
 * rather than through `set()` leaves the path unmodified, so a `save()`
 * that follows does not rewrite a column nobody touched.
 *
 * A `lean()` query never builds a document, so there is no `init` to hook:
 * the same walk runs in a `post` hook over the plain objects, and skips
 * anything that is a document (it has been through `init` already).
 *
 * ## Writing
 *
 * `pre('save')` for a document, `pre` on the update operators for a query,
 * and `pre('insertMany')`, which runs no document middleware of its own.
 * `post('save')` puts the plaintext back into the document, so reading a
 * path after saving it answers what was written and not the envelope --
 * and only the paths this hook encrypted, since every other one is
 * already the plaintext `post('init')` put there.
 *
 * Nothing on the write path looks at the *shape* of a value. A value is
 * encrypted because the caller did not say `{ encrypted: true }`, never
 * because it does not already look like an envelope: whoever can put a
 * string in the field could otherwise put one shaped like an envelope and
 * have it stored in the clear.
 *
 * `bulkWrite` runs no middleware and its operations are a language of
 * their own; a write that touches an encrypted field through it is
 * refused rather than stored in the clear, which is what the password
 * hooks of this adapter already do.
 *
 * ## Querying
 *
 * The filter of every read and every update is translated, into a **copy**:
 * `Query#merge()` shares the values of the object it was given, so
 * translating in place would leave the caller holding a filter full of
 * envelopes, and the next query built from it would encrypt those again
 * and match nothing. A deterministic path becomes an `$in` over one
 * envelope per configured key, so a lookup keeps working while a rotation
 * is in flight. A randomised one, a sort, or anything that is not an
 * equality is a refusal -- never a query that quietly matches nothing.
 *
 * @module encryption
 */

/** The queries whose filter has to be translated before it runs */
const FILTER_HOOKS = [
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];

/** The queries that also carry values to encrypt */
const UPDATE_HOOKS = [
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];

/** The queries whose result may be plain objects (`lean()`) */
const RESULT_HOOKS = [
  'find',
  'findOne',
  'findOneAndReplace',
  'findOneAndUpdate',
];

/** What a logical operator of a filter starts with (`$and`, `$or`, `$nor`) */
const LOGICAL = '$';

/** The operators an encrypted path can still be compared with */
const EQUALITY = ['$eq', '$in'];

/** ... and the negations of those */
const NEGATIONS = ['$ne', '$nin'];

/**
 * Is this a Mongoose document rather than a plain object?
 *
 * @param {*} value Anything
 * @returns {boolean} true for a document
 */
const isDocument = (value) =>
  Boolean(value && typeof value === 'object' && value.$__);

/**
 * Decrypts the encrypted paths of one plain object, in place
 *
 * @param {object} raw The document's `_doc`, or a lean result
 * @param {object} context `{ encrypted, henri, model }`
 * @returns {object} The same object
 */
const decryptInto = (raw, { encrypted, henri, model }) => {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  for (const field of Object.keys(encrypted)) {
    const value = raw[field];

    if (value === null || typeof value === 'undefined') {
      continue;
    }

    const name = contextOf(model, field);

    raw[field] = encryptionOn(henri, name).read(value, {
      context: name,
      deterministic: encrypted[field].deterministic,
    });
  }

  return raw;
};

/**
 * Encrypts the encrypted paths of a plain object of values, in place
 *
 * @param {object} values The values being written
 * @param {object} context `{ encrypted, henri, model }`
 * @returns {object} The same object
 */
const encryptInto = (values, { encrypted, henri, model }) => {
  if (!isPlainObject(values)) {
    return values;
  }

  for (const field of Object.keys(encrypted)) {
    const value = values[field];

    if (!(field in values) || value === null || typeof value === 'undefined') {
      continue;
    }

    const name = contextOf(model, field);

    values[field] = encryptionOn(henri, name).encrypt(value, {
      context: name,
      deterministic: encrypted[field].deterministic,
    });
  }

  return values;
};

/**
 * The stored form of one comparison, or the refusal that says why there
 * is none
 *
 * @param {*} value What the filter compares against
 * @param {object} context `{ deterministic, encryption, name }`
 * @returns {*} What to compare against instead
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE on anything but an equality
 */
const translateValue = (value, { deterministic, encryption, name }) => {
  if (value === null || typeof value === 'undefined') {
    return value;
  }

  const candidates = (wanted) =>
    lookupValues(encryption, name, { deterministic }, wanted);

  if (Array.isArray(value)) {
    return { $in: value.flatMap((entry) => candidates(entry)) };
  }

  if (!isPlainObject(value)) {
    const found = candidates(value);

    return found.length === 1 ? found[0] : { $in: found };
  }

  const translated = {};

  for (const operator of Object.keys(value)) {
    const compared = value[operator];

    if (EQUALITY.includes(operator)) {
      translated.$in = [
        ...(translated.$in || []),
        ...[compared].flat().flatMap((entry) => candidates(entry)),
      ];
      continue;
    }

    if (NEGATIONS.includes(operator)) {
      translated.$nin = [
        ...(translated.$nin || []),
        ...[compared].flat().flatMap((entry) => candidates(entry)),
      ];
      continue;
    }

    throw notQueryable(
      name,
      `it cannot be compared with ${operator}`,
      deterministic
    );
  }

  return translated;
};

/**
 * A copy of a filter with every encrypted path replaced by what the
 * collection actually holds
 *
 * @param {*} filter The filter
 * @param {object} context `{ encrypted, henri, model }`
 * @returns {*} The translated copy
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE
 */
const translateFilter = (filter, context) => {
  if (!isPlainObject(filter)) {
    return filter;
  }

  const { encrypted, henri, model } = context;
  const copy = { ...filter };

  for (const key of Object.keys(filter)) {
    const value = filter[key];

    if (key.startsWith(LOGICAL)) {
      copy[key] = Array.isArray(value)
        ? value.map((entry) => translateFilter(entry, context))
        : translateFilter(value, context);
      continue;
    }

    if (!encrypted[key]) {
      continue;
    }

    const name = contextOf(model, key);

    copy[key] = translateValue(value, {
      deterministic: encrypted[key].deterministic,
      encryption: encryptionOn(henri, name),
      name,
    });
  }

  return copy;
};

/**
 * Refuses a sort on an encrypted path: it would answer, ordered by bytes
 * nobody chose
 *
 * @param {*} sort The sort option
 * @param {object} context `{ encrypted, model }`
 * @returns {void}
 * @throws HENRI_ENCRYPTION_NOT_QUERYABLE
 */
const checkSort = (sort, { encrypted, model }) => {
  const names = isPlainObject(sort)
    ? Object.keys(sort)
    : String(sort || '')
        .split(/\s+/u)
        .map((entry) => entry.replace(/^-/u, ''));

  for (const field of names) {
    if (encrypted[field]) {
      throw notQueryable(
        contextOf(model, field),
        'cannot be sorted by',
        encrypted[field].deterministic
      );
    }
  }
};

/**
 * The whole of it on one schema
 *
 * @param {object} schema The Mongoose schema
 * @param {object} encrypted The fields marked `encrypted`
 * @param {object} henri The henri instance
 * @param {string} model The global id of the model
 * @returns {object} The schema
 */
const encryption = (schema, encrypted, henri, model) => {
  const context = { encrypted, henri, model };
  const fields = Object.keys(encrypted);

  schema.post('init', function postInit() {
    decryptInto(this._doc, context);
  });

  schema.post(RESULT_HOOKS, function postFind(result) {
    for (const entry of [result].flat().filter(Boolean)) {
      if (!isDocument(entry)) {
        decryptInto(entry, context);
      }
    }
  });

  schema.pre('save', function preSave() {
    // What this hook encrypted, so that `post('save')` puts back exactly
    // those and not the paths that were already plaintext in the document
    this.$locals.henriEncrypted = [];

    if (this.$locals.encrypted === true) {
      return;
    }

    for (const field of fields) {
      if (!this.isNew && !this.isModified(field)) {
        continue;
      }

      const value = this.get(field);

      if (value === null || typeof value === 'undefined') {
        continue;
      }

      const name = contextOf(model, field);

      this.set(
        field,
        encryptionOn(henri, name).encrypt(value, {
          context: name,
          deterministic: encrypted[field].deterministic,
        })
      );
      this.$locals.henriEncrypted.push(field);
    }
  });

  // The document is left holding what was saved, which is the envelope:
  // read those paths back as what the application wrote. Only those --
  // every other encrypted path in this document is already the plaintext
  // `post('init')` put there, and decrypting it again would fail
  schema.post('save', function postSave(doc) {
    for (const field of doc.$locals.henriEncrypted || []) {
      const name = contextOf(model, field);

      doc._doc[field] = encryptionOn(henri, name).read(doc._doc[field], {
        context: name,
        deterministic: encrypted[field].deterministic,
      });
    }

    doc.$locals.henriEncrypted = [];
  });

  schema.pre(FILTER_HOOKS, function preFilter() {
    this.setQuery(translateFilter(this.getFilter(), context));

    const options = this.getOptions() || {};

    if (options.sort) {
      checkSort(options.sort, context);
    }
  });

  schema.pre(UPDATE_HOOKS, function preUpdate() {
    if (this.getOptions().encrypted === true) {
      return;
    }

    const update = this.getUpdate();

    if (!update || Array.isArray(update)) {
      return;
    }

    for (const target of [update, update.$set, update.$setOnInsert]) {
      encryptInto(target, context);
    }
  });

  schema.pre('insertMany', function preInsertMany(docs) {
    for (const doc of [docs].flat()) {
      encryptInto(doc, context);
    }
  });

  // No middleware runs inside bulkWrite and its operations are a language
  // of their own: a value written through it would land in the clear,
  // which is the one outcome this feature exists to prevent
  schema.pre('bulkWrite', function preBulkWrite(ops = []) {
    for (const operation of [ops].flat().filter(Boolean)) {
      const [name] = Object.keys(operation);
      const body = operation[name] || {};
      const targets = [
        body.document,
        body.replacement,
        body.update,
        (body.update || {}).$set,
        (body.update || {}).$setOnInsert,
        body.filter,
      ];

      for (const target of targets) {
        const touched =
          isPlainObject(target) && fields.find((field) => field in target);

        if (touched) {
          throw notQueryable(
            contextOf(model, touched),
            `cannot be written or matched through ${name}() inside bulkWrite(), which runs no middleware`,
            encrypted[touched].deterministic
          );
        }
      }
    }
  });

  return schema;
};

module.exports = {
  FILTER_HOOKS,
  RESULT_HOOKS,
  UPDATE_HOOKS,
  decryptInto,
  encryptInto,
  encryption,
  translateFilter,
};
