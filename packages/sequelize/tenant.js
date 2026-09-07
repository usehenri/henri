const { DataTypes } = require('sequelize');

const { coded } = require('./utils');

/**
 * The tenant condition, on the Sequelize adapter.
 *
 * The design is core's (`packages/core/src/base/tenancy.js`). This is the
 * wiring, and the shape it borrows is the encryption plugin's rather than
 * `defaultScope`, which is what a Sequelize application would reach for
 * first. **`defaultScope` is the wrong seam here and the reason is in the
 * code next door**: `Model.scope('withPassword')` *replaces* the default
 * scope, which is exactly how henri's own sign-in reads the password
 * column, and `Model.unscoped()` drops it, which is what
 * `identityOfUpdate()` and the encryption rotation walk both do. Each of
 * those would silently lose a tenant condition put in a default scope --
 * three unscoped reads, none of which looks wrong at the call site. Hooks
 * survive all three.
 *
 * The hooks are the five that carry a condition (`beforeFind`,
 * `beforeCount`, `beforeBulkUpdate`, `beforeBulkDestroy`,
 * `beforeBulkRestore`) plus the three that carry values, and one on the
 * **connector** rather than a model for the include: an eager loaded
 * association carries a `where` of its own and the included model's hooks
 * do not fire for it, which is the same hole the encryption plugin found
 * and fixed the same way.
 *
 * `increment` and `decrement` fire no hook at all, so they are wrapped, the
 * way the validations plugin wraps them.
 *
 * @module tenant
 */

/** The Sequelize instances whose global include hook is registered */
const decorated = new WeakSet();

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
 * The condition a model must carry, or null
 *
 * @param {object} Model The Sequelize model
 * @param {object} henri The henri instance
 * @param {string} operation What is being done, for the message
 * @returns {?object} `{ column, tenant }`, or null
 * @throws HENRI_TENANT_REQUIRED
 */
const wanted = (Model, henri, operation) => {
  const tenancy = Model && Model.henriTenant ? tenancyOf(henri) : null;

  return tenancy
    ? tenancy.conditionFor(Model.name, {
        column: Model.henriTenant.column,
        operation,
      })
    : null;
};

/**
 * A `where` with the tenant added to it
 *
 * @param {*} where The condition so far
 * @param {object} condition `{ column, tenant }`
 * @returns {object} The condition to run
 */
const narrow = (where, condition) => ({
  ...(where && typeof where === 'object' ? where : {}),
  [condition.column]: condition.tenant,
});

/**
 * The include walk, registered once on the connector.
 *
 * `Invoice.findAll({ include: [Line] })` runs `Invoice`'s hooks and not
 * `Line`'s, so without this an eager load reaches every tenant's lines.
 *
 * @param {Array} includes The include list
 * @param {object} henri The henri instance
 * @returns {Array} The include list, narrowed
 */
const narrowIncludes = (includes, henri) => {
  if (!Array.isArray(includes)) {
    return includes;
  }

  return includes.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }

    const included = entry.model || entry;
    const condition = wanted(included, henri, 'include');
    const copy = { ...entry };

    if (condition) {
      copy.where = narrow(entry.where, condition);
    }

    if (entry.include) {
      copy.include = narrowIncludes(entry.include, henri);
    }

    return copy;
  });
};

/**
 * Registers the connector-wide include hook, once
 *
 * @param {object} connector The Sequelize instance
 * @param {object} henri The henri instance
 * @returns {object} The connector
 */
const decorateConnector = (connector, henri) => {
  if (decorated.has(connector)) {
    return connector;
  }

  decorated.add(connector);

  for (const hook of ['beforeFind', 'beforeCount']) {
    connector.addHook(hook, 'henriTenant', (options = {}) => {
      options.include = narrowIncludes(options.include, henri);
    });
  }

  return connector;
};

/**
 * The attribute of a tenant column henri adds itself
 *
 * @param {object} mark What `henri.tenancy.markFor()` answered
 * @returns {object} The Sequelize attribute
 */
const tenantAttribute = (mark) => ({
  allowNull: true,
  type: DataTypes.STRING(mark.length),
});

/**
 * Scopes a model to the tenant in scope
 *
 * @param {object} Model The Sequelize model
 * @param {object} henri The henri instance
 * @param {object} mark What `henri.tenancy.markFor()` answered
 * @returns {object} The model
 */
const decorateModel = (Model, henri, mark) => {
  const { column } = mark;

  Model.henriTenant = mark;

  for (const [hook, operation] of [
    ['beforeFind', 'find'],
    ['beforeCount', 'count'],
    ['beforeBulkUpdate', 'update'],
    ['beforeBulkDestroy', 'destroy'],
    ['beforeBulkRestore', 'restore'],
  ]) {
    Model.addHook(hook, 'henriTenant', (options = {}) => {
      const condition = wanted(Model, henri, operation);

      if (condition) {
        options.where = narrow(options.where, condition);
      }
    });
  }

  // The values: a create is stamped, and anything naming the column is
  // checked against the tenant in scope
  Model.addHook('beforeValidate', 'henriTenant', (record) => {
    const tenancy = tenancyOf(henri);
    const condition =
      tenancy &&
      tenancy.checkWrite(
        Model.name,
        record.isNewRecord || record.changed(column)
          ? { [column]: record.get(column) }
          : {},
        { column, operation: record.isNewRecord ? 'create' : 'update' }
      );

    if (condition && record.isNewRecord) {
      record.set(column, condition.tenant);
    }
  });

  Model.addHook('beforeBulkCreate', 'henriTenant', (records) => {
    const tenancy = tenancyOf(henri);
    const condition =
      tenancy &&
      tenancy.checkWrite(Model.name, {}, { column, operation: 'create' });

    if (condition) {
      for (const record of records) {
        record.set(column, condition.tenant);
      }
    }
  });

  // `Model.update(values, { where })` hands the values here as
  // `options.attributes`: a mass write that names the tenant column would
  // move every row it matched into another tenant
  Model.addHook('beforeBulkUpdate', 'henriTenantValues', (options = {}) => {
    const tenancy = tenancyOf(henri);
    const values = options.attributes;

    if (
      tenancy &&
      values &&
      Object.prototype.hasOwnProperty.call(values, column)
    ) {
      tenancy.checkWrite(Model.name, values, { column, operation: 'update' });
    }
  });

  // Neither fires a hook, so neither can be narrowed: refused rather than
  // run across every tenant (the validations plugin wraps the same two)
  for (const what of ['decrement', 'increment']) {
    const original = Model[what].bind(Model);

    Model[what] = async (fields, options) => {
      const tenancy = tenancyOf(henri);

      if (tenancy && !tenancy.isUnscoped()) {
        throw coded(
          'HENRI_TENANT_UNSCOPABLE',
          `${Model.name}.${what}() runs no hook, so henri cannot add the tenant to it, and ${Model.name} belongs to one. Read the record, change it and save it, which is scoped; or say henri.tenancy.unscoped() when every tenant is what it means.`
        );
      }

      return original(fields, options);
    };
  }

  decorateConnector(Model.sequelize, henri);

  return Model;
};

module.exports = {
  decorateConnector,
  decorateModel,
  narrowIncludes,
  tenantAttribute,
};
