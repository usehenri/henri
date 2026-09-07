/**
 * Reading records through whichever ORM holds them.
 *
 * `base/erasure.js` was the first place core had to run a query of its own
 * against three adapters, and it wrote the three spellings out by hand
 * (`findRecords`, `updateRecords`, `deleteRecords`). Two more places want
 * the same thing now -- the relations `base/embeds.js` puts under
 * `_embedded`, and the pages `base/csv.js` walks -- so the *read* half is
 * here rather than copied a third time.
 *
 * What is deliberately **not** here: any spelling of a condition or an
 * order. Those are `base/filters.js`'s (`conditionFor()`, `orderFor()`),
 * which already knows the three vocabularies and is exercised against all
 * three. This module only knows how to hand one of them to a model and get
 * rows back, plus the two facts about a model that differ per adapter --
 * what its primary key is called, and whether it carries a column.
 *
 * The failure is the caller's, because it is the caller a person is
 * reading about: `unsupported(name, code)` takes the code to stamp.
 *
 * @module base/records
 */

const { fail } = require('./errors');
const { kindOf } = require('./erasure');

/** What a caller gets when it does not name a code of its own */
const CODE = 'HENRI_MODEL_ADAPTER_UNSUPPORTED';

/**
 * The failure a model henri cannot drive raises
 *
 * @param {string} name the model name
 * @param {string} [code=CODE] the code to stamp
 * @returns {Error} the error to throw
 */
const unsupported = (name, code = CODE) =>
  fail(
    code,
    `unable to read the records of ${name}: its adapter is not one henri knows how to drive`,
    {
      hint: 'henri reads records through the model API of the three adapters it ships: mongoose, sequelize and drizzle',
    }
  );

/**
 * The ORM model of a global name, the way `Router#ormFor` resolves it: the
 * stores first, the global second
 *
 * @param {Henri} henri the henri instance
 * @param {string} name the global name (`Invoice`)
 * @param {string} [code=CODE] the code to stamp when there is none
 * @returns {*} the ORM model
 * @throws {Error} when no store holds it
 */
function ormFor(henri, name, code = CODE) {
  for (const store of Object.values(
    (henri && henri.model && henri.model.stores) || {}
  )) {
    const models = typeof store.getModels === 'function' && store.getModels();

    if (models && models[name]) {
      return models[name];
    }
  }

  if (global[name]) {
    return global[name];
  }

  throw unsupported(name, code);
}

/**
 * The name of the column holding the primary key
 *
 * @param {*} Model an ORM model
 * @returns {string} `_id` on Mongoose, the declared key on Sequelize, `id`
 *   on Drizzle
 */
function primaryOf(Model) {
  const kind = kindOf(Model);

  if (kind === 'mongoose') {
    return '_id';
  }

  if (kind === 'sequelize') {
    return Model.primaryKeyAttribute || 'id';
  }

  return 'id';
}

/**
 * Does this model carry a column?
 *
 * @param {*} Model an ORM model
 * @param {string} name the column
 * @returns {boolean} true when it does
 */
function hasColumn(Model, name) {
  const kind = kindOf(Model);

  if (kind === 'mongoose') {
    return Boolean(Model.schema && Model.schema.path(name));
  }

  if (kind === 'sequelize') {
    return Boolean(Model.rawAttributes && Model.rawAttributes[name]);
  }

  return Boolean(Model.fields && Model.fields[name]);
}

/**
 * Every row matching a condition, in one statement
 *
 * @param {*} Model an ORM model
 * @param {*} where the condition, spelled for the adapter (base/filters.js)
 * @param {object} [options={}] `{ code, limit, order }`
 * @returns {Promise<Array>} the records
 * @throws {Error} when the adapter is one henri does not know
 */
async function findRecords(
  Model,
  where,
  { code = CODE, limit = null, order = null } = {}
) {
  const kind = kindOf(Model);

  if (kind === 'drizzle') {
    return Model.find(where, { limit, order });
  }

  if (kind === 'mongoose') {
    const query = Model.find(where);

    order && query.sort(order);

    return limit === null ? query : query.limit(limit);
  }

  if (kind === 'sequelize') {
    return Model.findAll(
      Object.assign(
        { where },
        limit === null ? {} : { limit },
        order ? { order } : {}
      )
    );
  }

  throw unsupported((Model && Model.name) || 'this model', code);
}

/**
 * How many rows match a condition
 *
 * @param {*} Model an ORM model
 * @param {*} where the condition, spelled for the adapter
 * @param {object} [options={}] `{ code }`
 * @returns {Promise<number>} the count
 * @throws {Error} when the adapter is one henri does not know
 */
async function countRecords(Model, where, { code = CODE } = {}) {
  const kind = kindOf(Model);

  if (kind === 'drizzle') {
    return Model.count(where);
  }

  if (kind === 'mongoose') {
    return Model.countDocuments(where);
  }

  if (kind === 'sequelize') {
    return Model.count({ where });
  }

  throw unsupported((Model && Model.name) || 'this model', code);
}

module.exports = {
  CODE,
  countRecords,
  findRecords,
  hasColumn,
  ormFor,
  primaryOf,
  unsupported,
};
