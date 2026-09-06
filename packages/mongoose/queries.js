/**
 * What this adapter reports to `henri.queries`.
 *
 * The seam is core's (`packages/core/src/base/queries.js` has the design and
 * the argument); this file is only the mapping. Nothing here runs unless
 * `henri.queries.enabled`: `index.js` asks once, per model, while it is
 * building the schema, and an application that is not counting gets a schema
 * with no hook on it.
 *
 * ## Why this one is middleware and the others are wrappers
 *
 * The Drizzle adapter wraps the statics of its model class, because those
 * return promises. **Mongoose's do not.** `Model.find()` answers a `Query`,
 * which is lazy and chainable and only runs when it is awaited:
 * `Model.find().sort('-createdAt').limit(5)` is three calls and one
 * statement. A wrapper around `find` would either measure the wrong thing
 * (the time it took to build a query object) or -- because a `Query` is
 * thenable, so core's wrapper would happily `.then()` it -- **execute the
 * query early and hand the caller a promise where a chainable query
 * belonged**, breaking every `find().sort()` in every henri application.
 *
 * So Mongoose is instrumented where Mongoose says to: schema middleware.
 * `pre` stamps the start on the query, the document or the aggregate, `post`
 * reads it back with the result, and the operation names come from Mongoose's
 * own `constants.js` rather than a list of guesses. The cost is that the
 * reported `method` is Mongoose's word (`findOne`) rather than henri's
 * (`findById`), which is the honest name for what ran here.
 *
 * ## The exception, and why it is one
 *
 * `paginate()` is a henri static that answers a real promise, and it is a
 * page plus its count -- two Mongoose operations for one decision. It is
 * wrapped, so that it reports one event named `paginate` the way it does on
 * the other two adapters, and core's nesting rule keeps the `find` and the
 * `countDocuments` inside it from being counted again. `create()` is wrapped
 * for the same reason: it answers a promise and its `save` would otherwise
 * be the name in the report.
 *
 * ## The one place this adapter counts operations rather than calls
 *
 * Core's rule is one event per model call, and the two wrapped statics keep
 * it. Middleware cannot: `pre` and `post` are two callbacks, so there is no
 * scope to hold open between them, and an operation that **fans out** is
 * therefore reported once per operation. In practice that is `populate()`:
 * `Book.find().populate('author')` is one model call and reports a `find` for
 * the books and a `find` for the authors.
 *
 * It is worth being plain about, because it is the one place the vocabulary
 * bends. It does not mislead the detector -- a `populate` in a loop shows up
 * as two findings for one problem, with the same advice on both, which is
 * noisier than it should be and never wrong -- and the alternative was
 * wrapping the statics, which would have broken every `find().sort()` in
 * every henri application. The guide says so too.
 *
 * ## What is not here
 *
 * `adapter.query()` and the collections the queue, the trail and the call log
 * reach directly. Those go around the models on purpose (they own their
 * tables and no model describes them), so no schema middleware can see them;
 * core instruments the raw path itself in `3.model.js`.
 */

/** Where the start time is parked between `pre` and `post` */
const STARTED = Symbol('henri.queries.started');

/** Where the captured call site is parked between `pre` and `post` */
const SITE = Symbol('henri.queries.at');

/**
 * Mongoose's query operations, in henri's vocabulary.
 *
 * The names are `queryOperations` from `mongoose/lib/constants.js`; keeping
 * them written out rather than filtered from that file is deliberate, since
 * it is a private module, and `__tests__/queries.spec.js` compares the two
 * lists so a Mongoose release that adds one is a failing test rather than a
 * silent gap.
 */
const QUERIES = {
  countDocuments: 'count',
  deleteMany: 'delete',
  deleteOne: 'delete',
  distinct: 'other',
  estimatedDocumentCount: 'count',
  find: 'select',
  findOne: 'select',
  findOneAndDelete: 'delete',
  findOneAndReplace: 'update',
  findOneAndUpdate: 'update',
  replaceOne: 'update',
  updateMany: 'update',
  updateOne: 'update',
};

/** The document operations worth an event: a write per record is an N+1 too */
const DOCUMENTS = { deleteOne: 'delete', save: 'insert', updateOne: 'update' };

/** The model operations that go straight to the driver */
const MODELS = { bulkWrite: 'other', insertMany: 'insert' };

/** The statics that answer a promise, so they can be wrapped like Drizzle's */
const STATICS = {
  create: { operation: 'insert' },
  paginate: { operation: 'select' },
};

/**
 * How many documents an answer holds, for the shapes Mongoose returns.
 *
 * A write answers `{ acknowledged, modifiedCount, ... }`, which is a count
 * and not a document; core's own `rowsOf()` would call that one row.
 *
 * @param {*} value What the operation answered
 * @returns {?number} The count, or null when it cannot be told
 */
const documentsIn = (value) => {
  if (value === null || typeof value === 'undefined') {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'object') {
    for (const key of ['modifiedCount', 'deletedCount', 'insertedCount']) {
      if (typeof value[key] === 'number') {
        return value[key];
      }
    }

    return 1;
  }

  return null;
};

/**
 * Adds the middleware that reports every operation of one schema
 *
 * @param {object} schema The Mongoose schema, before it is compiled
 * @param {object} adapter The Mongoose adapter
 * @param {string} model The model name
 * @returns {object} The same schema
 */
const instrument = (schema, adapter, model) => {
  const { henri } = adapter;
  const { queries } = henri;

  if (!queries || !queries.enabled) {
    return schema;
  }

  const context = {
    adapter: adapter.adapterName,
    dialect: null,
    model,
    store: adapter.name,
  };

  /**
   * Stamps the start of an operation on whatever is carrying it
   *
   * @returns {void}
   */
  function begin() {
    this[STARTED] = performance.now();
    // Allocated, never formatted: core reads `.stack` only when a shape is
    // actually reported
    this[SITE] = queries.callsites ? new Error('query') : null;
  }

  /**
   * Reports a finished operation
   *
   * @param {string} method Mongoose's name for it
   * @param {string} operation henri's name for it
   * @param {*} filter The filter, for its key names only
   * @param {*} answer What came back
   * @param {object} carrier The query, document or aggregate
   * @returns {void}
   */
  const report = (method, operation, filter, answer, carrier) => {
    // A `pre` that never ran means the operation was started before the
    // schema was instrumented; nothing useful can be said about its duration
    if (typeof carrier[STARTED] !== 'number') {
      return;
    }

    // A layer of a call already being measured: `paginate()` is a `find` and
    // a `countDocuments`, and it is one decision. The wrappers below open
    // that scope; this is where the middleware honours it
    if (queries.nested()) {
      carrier[STARTED] = null;
      carrier[SITE] = null;

      return;
    }

    queries.record({
      ...context,
      at: carrier[SITE],
      filter,
      method,
      operation,
      rows: documentsIn(answer),
      started: carrier[STARTED],
    });

    carrier[STARTED] = null;
    carrier[SITE] = null;
  };

  for (const method of Object.keys(QUERIES)) {
    schema.pre(method, begin);
    schema.post(method, function record(answer) {
      // `getFilter()` answers the conditions as they were written; core's
      // `keysOf()` takes the key names and drops every value under them
      report(
        method,
        QUERIES[method],
        typeof this.getFilter === 'function' ? this.getFilter() : null,
        answer,
        this
      );
    });
  }

  for (const method of Object.keys(DOCUMENTS)) {
    schema.pre(method, { document: true, query: false }, begin);
    schema.post(method, { document: true, query: false }, function record() {
      // One document, and no filter: it is addressed by its own identity
      report(method, DOCUMENTS[method], null, 1, this);
    });
  }

  for (const method of Object.keys(MODELS)) {
    schema.pre(method, begin);
    schema.post(method, function record(answer) {
      report(method, MODELS[method], null, answer, this);
    });
  }

  schema.pre('aggregate', begin);
  schema.post('aggregate', function record(answer) {
    // A pipeline names stages and fields, and the stages carry values; only
    // the count of stages is reported, which is a shape and not a document
    report('aggregate', 'other', null, answer, this);
  });

  return schema;
};

/**
 * Wraps the two henri statics that answer a promise rather than a query
 *
 * Called after the model is compiled, because these live on the model rather
 * than on the schema.
 *
 * @param {object} instance The compiled Mongoose model
 * @param {object} adapter The Mongoose adapter
 * @returns {object} The same model
 */
const instrumentStatics = (instance, adapter) => {
  const { queries } = adapter.henri;

  if (!queries || !queries.enabled) {
    return instance;
  }

  queries.instrument(instance, STATICS, {
    adapter: adapter.adapterName,
    dialect: null,
    model: instance.modelName,
    store: adapter.name,
  });

  return instance;
};

module.exports = {
  DOCUMENTS,
  MODELS,
  QUERIES,
  STATICS,
  documentsIn,
  instrument,
  instrumentStatics,
};
