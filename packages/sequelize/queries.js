/**
 * What this adapter reports to `henri.queries`.
 *
 * The seam is core's (`packages/core/src/base/queries.js` has the design and
 * the argument); this file is only the mapping. Nothing here runs unless
 * `henri.queries.enabled`: `index.js` asks once, per model, and an
 * application that is not counting gets an untouched model.
 *
 * ## This is the adapter whose SQL settled the design
 *
 * The question the whole seam turned on was whether an event carries the
 * statement, and the answer -- no, on any adapter -- is this package's fault.
 * **Sequelize's query generator interpolates values into the text it runs.**
 * `Model.findAll({ where: { name: 'ada' } })` reaches the driver as
 * `SELECT ... WHERE "U"."name" = 'ada'`: the value is inside the string, on
 * the ordinary path, not an edge case. Drizzle parameterizes and Mongoose has
 * no statement at all, so a `sql` field would have been safe on two adapters
 * and a copy of the row on the third -- which is worse than no field, because
 * it is the leak nobody would look for. The event carries the filter's key
 * **names** instead, and the statement is never read.
 *
 * ## Wrapped, like Drizzle's and unlike Mongoose's
 *
 * Sequelize has no lazy query object: `Model.findAll(options)` answers a
 * promise, not something chainable. So this is instrumented the way the
 * Drizzle adapter is -- the statics and the instance methods, wrapped -- and
 * core's nesting rule keeps a call that is built out of another one
 * (`findByPk` is a `findOne` is a `findAll`) to a single event under the name
 * the application wrote.
 *
 * ## What is not here
 *
 * `adapter.query()`, which core instruments itself in `3.model.js`, and
 * `sequelize.sync()`, the session store and the drift reader, which are
 * henri's own housekeeping rather than an application's queries.
 */

/**
 * The condition of a call, for its key names only.
 *
 * Sequelize takes its condition inside an options bag (`{ where }`), and the
 * bag also carries `attributes`, `include`, `order` and the rest -- which are
 * names too, but not the ones that say what question was asked. Only `where`
 * is read, and only for its keys: core's `keysOf()` walks `Op.and`/`Op.or`
 * (symbol keys) and drops every value under them.
 *
 * @param {number} at Which argument holds the options bag
 * @returns {function} A filter reader for a spec entry
 */
const whereIn =
  (at = 0) =>
  (args) => {
    const options = args[at];

    return options && typeof options === 'object'
      ? options.where || null
      : null;
  };

/** The identifier of a lookup by id, as a name and not a value */
const byId = () => ({ id: null });

/** The identifier of a lookup by the public identifier */
const byExternalId = () => ({ externalId: null });

/**
 * The statics of a Sequelize model that go to the database.
 *
 * `findAndCountAll` is two statements and one decision, like `paginate`; both
 * are one event, because the seam counts decisions.
 */
const STATICS = {
  aggregate: { filter: whereIn(2), operation: 'other' },
  bulkCreate: { operation: 'insert' },
  count: { filter: whereIn(), operation: 'count' },
  create: { operation: 'insert' },
  destroy: { filter: whereIn(), operation: 'delete' },
  findAll: { filter: whereIn(), operation: 'select' },
  findAndCountAll: { filter: whereIn(), operation: 'select' },
  findByExternalId: { filter: byExternalId, operation: 'select' },
  findById: { filter: byId, operation: 'select' },
  findByKey: { filter: byId, operation: 'select' },
  findByPk: { filter: byId, operation: 'select' },
  findOne: { filter: whereIn(), operation: 'select' },
  findOrCreate: { filter: whereIn(), operation: 'select' },
  increment: { filter: whereIn(1), operation: 'update' },
  max: { filter: whereIn(1), operation: 'count' },
  min: { filter: whereIn(1), operation: 'count' },
  paginate: { operation: 'select' },
  restore: { filter: whereIn(), operation: 'update' },
  sum: { filter: whereIn(1), operation: 'count' },
  truncate: { operation: 'delete' },
  update: { filter: whereIn(1), operation: 'update' },
  upsert: { operation: 'update' },
};

/** The instance methods that go to the database */
const INSTANCE = {
  decrement: { operation: 'update' },
  destroy: { operation: 'delete' },
  increment: { operation: 'update' },
  reload: { operation: 'select' },
  restore: { operation: 'update' },
  save: { operation: 'insert' },
  update: { operation: 'update' },
};

/**
 * How many rows an answer holds, for the shapes Sequelize returns.
 *
 * `findAndCountAll` answers `{ count, rows }` and `update`/`destroy` answer a
 * number (or `[affected]`), neither of which core's own `rowsOf()` would read
 * correctly on its own.
 *
 * @param {*} value What the call answered
 * @returns {?number} The count, or null when it cannot be told
 */
const rowsIn = (value) => {
  if (value === null || typeof value === 'undefined') {
    return 0;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === 'number' ? value[0] : value.length;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'object') {
    if (Array.isArray(value.rows)) {
      return value.rows.length;
    }

    if (Array.isArray(value.records)) {
      return value.records.length;
    }

    return 1;
  }

  return null;
};

/**
 * Instruments one model
 *
 * @param {object} instance The Sequelize model
 * @param {object} adapter The Sequelize adapter
 * @returns {object} The same model
 */
const instrument = (instance, adapter) => {
  const { queries } = adapter.henri;

  if (!queries || !queries.enabled) {
    return instance;
  }

  const context = {
    adapter: adapter.adapterName,
    dialect: adapter.dialect || null,
    store: adapter.name,
  };
  const rows = (spec) =>
    Object.fromEntries(
      Object.entries(spec).map(([name, entry]) => [
        name,
        { rows: rowsIn, ...entry },
      ])
    );

  queries.instrument(instance, rows(STATICS), {
    ...context,
    model: instance.name,
  });
  queries.instrument(instance.prototype, rows(INSTANCE), {
    ...context,
    model: (self) => self.constructor.name,
  });

  return instance;
};

module.exports = { INSTANCE, STATICS, instrument, rowsIn };
