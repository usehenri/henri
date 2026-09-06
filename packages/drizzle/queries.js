/**
 * What this adapter reports to `henri.queries`.
 *
 * The seam is core's (`packages/core/src/base/queries.js` has the design and
 * the argument); this file is only the mapping: which methods of the Drizzle
 * model layer are **model calls**, what each one means in the one vocabulary
 * the three adapters share, and where the filter's key names come from.
 *
 * Nothing here runs unless `henri.queries.enabled`. `index.js` asks once, per
 * model, while it is building it, and an application that is not counting has
 * an untouched model class.
 *
 * ## Three targets, and why
 *
 * - **The model class**, per model. Every static that ends in a promise:
 *   `find`, `findById`, `create`, `destroy` and the rest. These are what an
 *   application writes, and the name it wrote is what the event reports.
 * - **`Model.prototype`**, per model. `save`, `update`, `destroy`, `restore`,
 *   `reload` -- a write per record in a loop is an N+1 like any other.
 * - **`Relation.prototype`**, once per process. `Model.where({ ... }).limit(5)`
 *   answers a relation and the statement runs at `toArray()`, so instrumenting
 *   only the statics would miss the whole lazy path. It is one object shared by
 *   every store in the process, which is why it is wrapped once and resolves
 *   its henri from the receiver -- see `instrument()`'s own header.
 *
 * A call that goes through two of them is one event: core's nesting rule keeps
 * the outermost, so `Model.findById()` reports `findById` rather than the
 * `first()` it is built out of.
 *
 * ## What is not here
 *
 * `adapter.query()` is instrumented by core (`3.model.js`), because the raw
 * path is the same on every adapter and no model layer sees it. The session
 * store, the migrations and drizzle-kit reach the database without going
 * through a model, and are deliberately absent: they are henri's own
 * housekeeping, they run once, and counting them would put noise in a report
 * about an application's code.
 */

/** Marks `Relation.prototype` as wrapped, so a second henri does not redo it */
const INSTRUMENTED = Symbol.for('henri.queries.relation');

/**
 * The condition of a call, for its key names only.
 *
 * The values are never read: `keysOf()` in core takes the keys and drops
 * everything under them. A drizzle condition that is already compiled (a `sql`
 * chunk rather than a plain object) has no keys to take, and answers none
 * rather than a guess.
 *
 * @param {number} at Which argument holds the condition
 * @returns {function} A filter reader for a spec entry
 */
const where =
  (at = 0) =>
  (args) => {
    const condition = args[at];

    return condition && typeof condition === 'object' && !condition.queryChunks
      ? condition
      : null;
  };

/** The identifier of a lookup by id, as a name and not a value */
const byId = () => ({ id: null });

/** The identifier of a lookup by the public identifier */
const byExternalId = () => ({ externalId: null });

/**
 * The statics of a model class that are model calls.
 *
 * Read as: `<method>: { operation, filter }`. Anything that answers a
 * `Relation` rather than a promise -- `query`, `where`, `order`, `limit`,
 * `include`, `relation` -- is a builder and is deliberately absent: nothing
 * has run yet when it returns.
 */
const STATICS = {
  all: { operation: 'select' },
  count: { filter: where(), operation: 'count' },
  countDocuments: { filter: where(), operation: 'count' },
  create: { operation: 'insert' },
  deleteMany: { filter: where(), operation: 'delete' },
  destroy: { filter: where(), operation: 'delete' },
  exists: { filter: where(), operation: 'count' },
  find: { filter: where(), operation: 'select' },
  findAll: { filter: where(), operation: 'select' },
  findByExternalId: { filter: byExternalId, operation: 'select' },
  findById: { filter: byId, operation: 'select' },
  findByIdAndDelete: { filter: byId, operation: 'delete' },
  findByIdAndRemove: { filter: byId, operation: 'delete' },
  findByIdAndUpdate: { filter: byId, operation: 'update' },
  findByKey: { filter: byId, operation: 'select' },
  findByPk: { filter: byId, operation: 'select' },
  findOne: { filter: where(), operation: 'select' },
  findOneAndDelete: { filter: where(), operation: 'delete' },
  findOneAndUpdate: { filter: where(), operation: 'update' },
  first: { operation: 'select' },
  internalId: { filter: byId, operation: 'select' },
  last: { operation: 'select' },
  paginate: { operation: 'select' },
  pluck: { filter: where(1), operation: 'select' },
  restore: { filter: where(), operation: 'update' },
  update: { filter: where(), operation: 'update' },
  updateMany: { filter: where(), operation: 'update' },
};

/** The instance methods that go to the database */
const INSTANCE = {
  destroy: { operation: 'delete' },
  reload: { operation: 'select' },
  restore: { operation: 'update' },
  save: { operation: 'insert' },
  update: { operation: 'update' },
};

/** The terminals of a relation: where a built query finally runs */
const RELATION = {
  count: { operation: 'count' },
  exists: { operation: 'count' },
  first: { operation: 'select' },
  last: { operation: 'select' },
  paginate: { operation: 'select' },
  pluck: { operation: 'select' },
  toArray: { operation: 'select' },
};

/**
 * The adapter a relation belongs to, or an empty stand-in
 *
 * @param {object} relation A relation
 * @returns {object} The adapter, or `{}` when the chain is incomplete
 */
const storeOf = (relation) =>
  (relation && relation.Model && relation.Model.adapter) || {};

/**
 * Instruments one model class, and the shared relation the first time round
 *
 * @param {object} adapter The Drizzle adapter
 * @param {function} Model The model class core just built
 * @param {function} Relation The relation class of this package
 * @returns {function} The same model class
 */
const instrument = (adapter, Model, Relation) => {
  const { queries } = adapter.henri;

  if (!queries || !queries.enabled) {
    return Model;
  }

  const context = {
    adapter: adapter.adapterName,
    dialect: (adapter.dialect && adapter.dialect.name) || null,
    store: adapter.name,
  };

  queries.instrument(Model, STATICS, { ...context, model: Model.modelName });
  queries.instrument(Model.prototype, INSTANCE, {
    ...context,
    model: (self) => self.constructor.modelName,
  });

  // One object for every store in the process, so: wrapped once, and every
  // field that names a store is read off the relation rather than closed over
  queries.instrument(Relation.prototype, RELATION, {
    adapter: (self) => storeOf(self).adapterName || null,
    dialect: (self) => {
      const { dialect } = storeOf(self);

      return (dialect && dialect.name) || null;
    },
    model: (self) => (self.Model && self.Model.modelName) || null,
    once: INSTRUMENTED,
    /**
     * The seam of whichever henri this relation's model belongs to
     *
     * @param {object} self The relation
     * @returns {?object} The queries module, or null
     */
    queries: (self) => {
      const { henri } = storeOf(self);

      return (henri && henri.queries) || null;
    },
    store: (self) => storeOf(self).name || null,
  });

  return Model;
};

module.exports = { INSTANCE, INSTRUMENTED, RELATION, STATICS, instrument };
