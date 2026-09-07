const { coded } = require('./utils');

/**
 * The tenant condition, on the Mongoose adapter.
 *
 * The design is core's (`packages/core/src/base/tenancy.js`). This is the
 * wiring, and it is the soft-delete plugin's shape on purpose: one
 * `schema.pre` over every query that carries a filter, adding
 * `this.where({ [column]: tenant })` -- which *ands* into whatever the
 * caller asked for, so a filter can narrow the tenant's rows and can never
 * reach past them.
 *
 * Two things are different from `paranoid()` and both are deliberate.
 *
 * **The hook list is the encryption plugin's and not the soft delete's.**
 * `plugins.js` leaves `deleteMany`, `deleteOne` and `findOneAndDelete` out
 * of `READ_HOOKS` because `soften()` rewrites them into updates that
 * re-enter the list -- which is true only on a paranoid model. A model that
 * belongs to a tenant and does not soft delete would then have three
 * unscoped deletes, so this uses the wider list.
 *
 * **Three operations are refused rather than scoped.** `aggregate` runs no
 * query middleware at all, `bulkWrite` runs none either, and
 * `estimatedDocumentCount` counts a collection rather than a filter --
 * there is nowhere to put a condition in any of the three, and answering
 * them unscoped on a tenanted collection is the failure this whole feature
 * exists to prevent. `HENRI_TENANT_UNSCOPABLE` says so and names what to do
 * instead; `henri.tenancy.unscoped()` is how a report means it.
 *
 * @module tenant
 */

/** Every query whose filter henri can narrow (the encryption plugin's list) */
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

/** The queries that also carry values, which must not move a row */
const UPDATE_HOOKS = [
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];

/** What henri cannot put a condition on, and refuses instead of guessing */
const UNSCOPABLE = {
  aggregate:
    'an aggregation pipeline runs no query middleware, so henri cannot add the tenant to it. Put the match yourself -- `{ $match: { [column]: henri.tenancy.current() } }` as the first stage -- or say henri.tenancy.unscoped() when every tenant is what the pipeline means',
  bulkWrite:
    'Mongoose runs no middleware for the operations of a bulk write, so henri never sees their filters. Use one update per record, which is scoped, or henri.tenancy.unscoped() when every tenant is what it means',
  estimatedDocumentCount:
    'it counts the collection rather than a filter, so there is nowhere to put the tenant. Use countDocuments(), which is scoped',
};

/**
 * The tenancy module of a henri instance, when it is on
 *
 * @param {object} henri The henri instance
 * @returns {?object} `henri.tenancy`, or null
 */
const tenancyOf = (henri) => {
  const tenancy = henri && henri.tenancy;

  return tenancy && tenancy.enabled ? tenancy : null;
};

/**
 * The tenant column a value moves a row to, when it names one
 *
 * @param {*} update What a query is writing
 * @param {string} column The tenant column
 * @returns {*} The value, or undefined when the write does not name it
 */
const named = (update, column) => {
  if (!update || typeof update !== 'object') {
    return undefined;
  }

  for (const holder of [update, update.$set, update.$setOnInsert]) {
    if (
      holder &&
      typeof holder === 'object' &&
      Object.prototype.hasOwnProperty.call(holder, column)
    ) {
      return holder[column];
    }
  }

  return undefined;
};

/**
 * Scopes a model to the tenant in scope, and refuses what it cannot scope
 *
 * @param {object} schema The Mongoose schema
 * @param {object} henri The henri instance
 * @param {string} model The model name
 * @param {object} mark What `henri.tenancy.markFor()` answered
 * @returns {object} The schema
 */
const tenant = (schema, henri, model, mark) => {
  const { column } = mark;

  if (!mark.declared) {
    schema.add({ [column]: { default: null, index: true, type: String } });
  }

  /**
   * What every query on this model must carry, or null
   *
   * @param {string} operation What is being done, for the message
   * @returns {?object} `{ column, tenant }`, or null
   */
  const wanted = (operation) => {
    const tenancy = tenancyOf(henri);

    return tenancy ? tenancy.conditionFor(model, { column, operation }) : null;
  };

  schema.pre(FILTER_HOOKS, function scopeToTenant() {
    const condition = wanted(this.op || 'find');

    if (condition) {
      this.where({ [condition.column]: condition.tenant });
    }
  });

  schema.pre(UPDATE_HOOKS, function keepTheTenant() {
    const tenancy = tenancyOf(henri);
    const moving = named(this.getUpdate(), column);

    if (tenancy && typeof moving !== 'undefined') {
      tenancy.checkWrite(
        model,
        { [column]: moving },
        { column, operation: this.op }
      );
    }
  });

  // A document write: the tenant is stamped on the way in rather than
  // supplied, so an application never has to remember it -- and a document
  // that names another tenant is refused the same way an update is
  schema.pre('validate', function stampTheTenant() {
    const tenancy = tenancyOf(henri);

    if (!tenancy) {
      return;
    }

    const condition = tenancy.checkWrite(
      model,
      this.isNew || this.isModified(column) ? { [column]: this[column] } : {},
      { column, operation: this.isNew ? 'create' : 'update' }
    );

    if (condition && this.isNew) {
      this[column] = condition.tenant;
    }
  });

  // `insertMany` runs no document middleware, so the stamp is here: it is
  // a bulk create, which means every document is in hand
  schema.pre('insertMany', function stampTheTenants(docs) {
    const tenancy = tenancyOf(henri);
    const condition =
      tenancy && tenancy.checkWrite(model, {}, { column, operation: 'create' });

    if (!condition) {
      return;
    }

    for (const doc of Array.isArray(docs) ? docs : [docs]) {
      if (!doc || typeof doc !== 'object') {
        continue;
      }

      tenancy.checkWrite(model, doc, { column, operation: 'create' });
      doc[column] = condition.tenant;
    }
  });

  for (const [operation, why] of Object.entries(UNSCOPABLE)) {
    schema.pre(operation, function refuseUnscopable() {
      if (tenancyOf(henri) && !henri.tenancy.isUnscoped()) {
        throw coded(
          'HENRI_TENANT_UNSCOPABLE',
          `${model}.${operation}() cannot be scoped to a tenant and ${model} belongs to one: ${why}`
        );
      }
    });
  }

  return schema;
};

module.exports = { FILTER_HOOKS, UNSCOPABLE, UPDATE_HOOKS, tenant };
