const {
  canonical,
  canonicalInteger,
  compare,
  isExact,
  settingsOf,
} = require('./exact');

/**
 * `decimal` and `bigint` on a Mongoose model.
 *
 * What the two types mean, and why their value is a string on every
 * adapter, is in `./exact.js`. This is the Mongoose half, and it is two
 * halves of its own:
 *
 * ## Writing: a setter that records, and a `pre('validate')` that refuses
 *
 * MongoDB keeps a `Decimal128` with the exponent it was given, so
 * `'19.99'` and `'19.9900'` are stored differently (they compare equal, but
 * they read back differently). PostgreSQL and MySQL pad to the declared
 * scale, so Mongoose has to as well or the same model file would answer two
 * different strings. The setter is what pads it, and it runs on an
 * assignment, on `create()` and on a query filter alike.
 *
 * The setter is also the only place that still has the value the
 * application passed. By the time a validator runs, Mongoose has cast it:
 * `2 ** 60` is a `BigInt` that looks perfectly whole, and the reason it was
 * refused -- that a JavaScript number does not carry those digits -- is
 * gone. So the setter writes the reason into the document's `$locals` and
 * `pre('validate')` calls `invalidate()` with it, which is Mongoose's own
 * way of saying a field is wrong and puts the sentence a person reads in
 * the ValidationError unchanged. A setter that threw instead would produce
 * a message about casting, which is not what went wrong.
 *
 * ## Reading: `post('init')`, not a getter
 *
 * Exactly the argument `./encryption.js` makes: a getter runs on
 * `doc.field` and on nothing else, so `toObject()`, `toJSON()` and `lean()`
 * would all still hand out a `Decimal128`. The value is written into the
 * document's own `_doc` as it is hydrated, and into the plain objects of a
 * `lean()` query in a `post` hook. `post('save')` does it again because a
 * save leaves the document holding what Mongoose cast, which is the
 * `Decimal128` and not the string the application wrote.
 *
 * @module exact-paths
 */

/** The queries whose result may be plain objects (`lean()`) */
const RESULT_HOOKS = [
  'find',
  'findOne',
  'findOneAndReplace',
  'findOneAndUpdate',
];

/**
 * One value as the string the column holds
 *
 * @param {string} type `decimal` or `bigint`
 * @param {*} value The value
 * @param {object} settings `{ precision, scale }`
 * @returns {{value: string}|{error: string}} The value, or what is wrong
 */
const exactly = (type, value, settings) =>
  type === 'bigint' ? canonicalInteger(value) : canonical(value, settings);

/**
 * Is this a Mongoose document rather than a plain object?
 *
 * @param {*} value Anything
 * @returns {boolean} true for a document
 */
const isDocument = (value) =>
  Boolean(value && typeof value === 'object' && value.$__);

/** Where the setter leaves what it refused, for `pre('validate')` */
const LOCALS = 'henriExact';

/**
 * The setter of an exact path: the canonical string when the value fits the
 * column, and the value untouched with the reason recorded when it does not
 *
 * @param {string} field The path name
 * @param {string} type `decimal` or `bigint`
 * @param {object} settings `{ precision, scale }`
 * @returns {function} A Mongoose setter
 */
const setter = (field, type, settings) =>
  /**
   * `this` is the document when a path is assigned and the query when a
   * filter is cast; only the first one has `$locals` to record into
   *
   * @param {*} value The value being set
   * @returns {*} What to store
   */
  function set(value) {
    if (value === null || typeof value === 'undefined') {
      return value;
    }

    const answer = exactly(type, value, settings);
    const locals = this && this.$locals;

    if (locals) {
      locals[LOCALS] = { ...locals[LOCALS], [field]: answer.error || null };
    }

    return answer.error ? value : answer.value;
  };

/**
 * The exact paths of a normalized schema, with their type and settings
 *
 * @param {object} [schema={}] The model schema, as the model file wrote it
 * @returns {object} `{ [path]: { type, precision, scale } }`
 */
const exactPaths = (schema = {}) => {
  const paths = {};

  for (const field of Object.keys(schema)) {
    const definition = schema[field];
    const type =
      definition && typeof definition === 'object'
        ? definition.type
        : definition;

    if (typeof type === 'string' && isExact(type.toLowerCase())) {
      paths[field] = {
        ...settingsOf(definition),
        // Mongoose has a `min` and a `max`, and it ignores both on a
        // Decimal128 and a BigInt without a word: henri carries them
        // itself so a bound means the same thing on the three adapters
        max: definition.max,
        min: definition.min,
        type: type.toLowerCase(),
      };
    }
  }

  return paths;
};

/**
 * Writes the canonical strings of one plain object, in place
 *
 * @param {object} raw The document's `_doc`, or a lean result
 * @param {object} paths The exact paths
 * @returns {object} The same object
 */
const stringify = (raw, paths) => {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  for (const field of Object.keys(paths)) {
    const value = raw[field];

    if (value !== null && typeof value !== 'undefined') {
      raw[field] = String(value);
    }
  }

  return raw;
};

/**
 * The whole of it on one schema
 *
 * @param {object} schema The Mongoose schema
 * @param {object} paths The exact paths (`exactPaths()`)
 * @returns {object} The schema
 */
const exactness = (schema, paths) => {
  // What the setter could not carry: said in henri's own words, through
  // Mongoose's own way of marking a path wrong
  schema.pre('validate', function preValidate() {
    const refused = (this.$locals || {})[LOCALS] || {};

    for (const field of Object.keys(paths)) {
      const { max, min } = paths[field];
      const value = this.get(field);

      if (refused[field]) {
        this.invalidate(field, refused[field], value);
        continue;
      }

      if (value === null || typeof value === 'undefined') {
        continue;
      }

      // Digit by digit, never through the double the type exists to avoid
      if (typeof min !== 'undefined' && compare(String(value), min) < 0) {
        this.invalidate(field, `must be at least ${min}`, value);
      }

      if (typeof max !== 'undefined' && compare(String(value), max) > 0) {
        this.invalidate(field, `must be at most ${max}`, value);
      }
    }
  });

  schema.post('init', function postInit() {
    stringify(this._doc, paths);
  });

  schema.post(RESULT_HOOKS, function postFind(result) {
    for (const entry of [result].flat().filter(Boolean)) {
      if (!isDocument(entry)) {
        stringify(entry, paths);
      }
    }
  });

  // A save leaves the document holding what Mongoose cast, which is a
  // Decimal128 or a BigInt: read those paths back as the string the
  // application wrote, the way `post('init')` does for a query
  schema.post('save', function postSave(doc) {
    stringify(doc._doc, paths);
  });

  schema.post('insertMany', function postInsertMany(docs) {
    for (const doc of [docs].flat().filter(Boolean)) {
      stringify(isDocument(doc) ? doc._doc : doc, paths);
    }
  });

  return schema;
};

module.exports = { exactPaths, exactness, setter };
