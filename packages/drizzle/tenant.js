const { and, eq } = require('drizzle-orm');

/**
 * The tenant condition, on the drizzle adapter.
 *
 * The design is core's (`packages/core/src/base/tenancy.js`): a column on
 * the models that say `options: { tenant: true }`, a condition on every
 * query henri builds for one, and a refusal -- never an unscoped read --
 * when nothing in scope says which tenant.
 *
 * This file is the wiring, and it is deliberately three functions rather
 * than a decorator that wraps the statics. The reason is where the holes
 * are: `Relation#whereSQL()` is the funnel every read and every fluent mass
 * write already goes through (it is where `deletedAt IS NULL` is added, and
 * this rides next to it), but **two write paths never build a `Relation` at
 * all** -- `Model.updateById()`, which is what `instance.save()` and
 * `findByIdAndUpdate()` reach, and `Model.setWhere()`, which is the raw
 * stamp behind a soft delete and a restore. Those get the condition
 * themselves, which means a row scoped through a `Relation` carries it
 * twice. That redundancy is on purpose: the same equality ANDed twice
 * costs a planner nothing, and the alternative is a flag threaded through
 * four call sites that would be right until somebody adds a fifth.
 *
 * What is **not** covered, and is said out loud in the guide:
 * `adapter.query()`. Raw SQL is raw SQL, and henri cannot parse a
 * statement to add a condition to it -- `henri.tenancy.current()` is what
 * the application interpolates, and `henri audit` reports a `query()` in
 * an application that is multi-tenant.
 */

/**
 * The tenancy module of the henri instance behind a model, or null
 *
 * @param {function} Model A model class
 * @returns {?object} `henri.tenancy`, or null when there is none
 */
const tenancyOf = (Model) => {
  const henri = Model && Model.adapter && Model.adapter.henri;
  const tenancy = henri && henri.tenancy;

  return tenancy && tenancy.enabled ? tenancy : null;
};

/**
 * What a query on this model must be narrowed by, or nothing.
 *
 * `null` when tenancy is off, when the model is shared, or when the caller
 * said `unscoped()`. A `HENRI_TENANT_REQUIRED` throw when the model is a
 * tenant's and nobody said which -- **never** an unscoped read.
 *
 * @param {function} Model A model class
 * @param {string} [operation] What is being done, for the message
 * @returns {?object} The drizzle SQL condition, or null
 * @throws HENRI_TENANT_REQUIRED
 */
const tenantSQL = (Model, operation) => {
  if (!Model || !Model.tenant) {
    return null;
  }

  const tenancy = tenancyOf(Model);
  const condition = tenancy
    ? tenancy.conditionFor(Model.modelName, {
        column: Model.tenant.column,
        operation,
      })
    : null;

  return condition
    ? eq(Model.column(condition.column), condition.tenant)
    : null;
};

/**
 * A condition with the tenant ANDed onto it
 *
 * @param {function} Model A model class
 * @param {*} where The condition so far (may be undefined)
 * @param {string} [operation] What is being done, for the message
 * @returns {*} The condition to run
 * @throws HENRI_TENANT_REQUIRED
 */
const scoped = (Model, where, operation) => {
  const mine = tenantSQL(Model, operation);

  if (!mine) {
    return where;
  }

  return where ? and(where, mine) : mine;
};

/**
 * The values of a write, with the tenant stamped on and checked.
 *
 * A create is stamped; a create or an update that names the column itself
 * is checked against the tenant in scope and refused when they differ
 * (`HENRI_TENANT_CROSS_WRITE`). Moving a row between tenants is one of the
 * few mistakes no later request notices, so henri refuses rather than
 * obeying, and `unscoped()` is where it is done on purpose.
 *
 * @param {function} Model A model class
 * @param {string} kind `create` or `update`
 * @param {object} values The attributes being written
 * @returns {object} The values to write
 * @throws HENRI_TENANT_REQUIRED, HENRI_TENANT_CROSS_WRITE
 */
const stamp = (Model, kind, values) => {
  if (!Model || !Model.tenant) {
    return values;
  }

  const tenancy = tenancyOf(Model);
  const wanted = tenancy
    ? tenancy.checkWrite(Model.modelName, values, {
        column: Model.tenant.column,
        operation: kind,
      })
    : null;

  if (!wanted || kind !== 'create') {
    return values;
  }

  return { ...values, [wanted.column]: wanted.tenant };
};

/**
 * The schema field of a tenant column henri adds itself.
 *
 * A string as wide as core says an identifier may be (the mark carries the
 * width, so no adapter keeps a copy of the number) and indexed, because
 * every query on the table now carries it. It is deliberately **not**
 * `required`: the value is stamped rather than supplied, and a `NOT NULL`
 * would turn every `unscoped()` insert of a migration into a failure
 * instead of a decision.
 *
 * @param {object} mark What `henri.tenancy.markFor()` answered
 * @returns {object} The field
 */
const tenantField = (mark) => ({
  index: true,
  length: mark.length,
  type: 'string',
});

module.exports = { scoped, stamp, tenancyOf, tenantField, tenantSQL };
