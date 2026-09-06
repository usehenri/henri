const { coded } = require('./utils');

/**
 * Model versioning on a Sequelize model.
 *
 * The design, the four rules of what is never stored and what a row holds
 * per event are core's (`@usehenri/core/src/base/versions.js`). This is the
 * Sequelize half, and it is the shortest of the three, because Sequelize
 * already keeps the state before a write: `instance.changed()` says which
 * attributes moved and `instance.previous(field)` says what they were.
 *
 * Nothing here is installed on a model that did not ask: `decorateModel()`
 * is called from `addModel()` only when the model file says
 * `options: { versioned: ... }`.
 *
 * ## The bulk hooks, and the one way through them
 *
 * `Model.update(values, { where })` and `Model.destroy({ where })` run
 * `beforeBulkUpdate` / `beforeBulkDestroy` and **no instance hook at all**,
 * so henri holds neither side of any of the rows they change: the naive
 * implementation records nothing for a hundred changed rows, and a history
 * that silently misses changes reads as evidence and is not. They are
 * refused (`HENRI_VERSION_MASS_WRITE`).
 *
 * Sequelize has an answer of its own and it is honoured:
 * `{ individualHooks: true }` makes it load the rows and run the instance
 * hooks on each, which is exactly what a version needs, so the refusal
 * steps aside. `{ versions: false }` is the other way through, and it is a
 * decision rather than a silence.
 *
 * `bulkCreate` is not refused, for the reason that makes a create
 * different: it has no before state, so the instances it answers are the
 * whole of what a version would hold and nothing is lost.
 *
 * @module versions
 */

/** Where the state before a write waits for the hook that records it */
const BEFORE = Symbol('henri.versions.before');

/** What the loop that replaces a mass write of each kind looks like */
const INSTEAD = {
  destroy: 'destroy()',
  restore: 'restore()',
  update: 'update(attrs)',
};

/**
 * The refusal a mass write on a versioned model gets
 *
 * @param {object} Model a sequelize model
 * @param {string} what `update`, `destroy` or `restore`
 * @returns {Error} the error to throw
 */
const massWrite = (Model, what) =>
  coded(
    'HENRI_VERSION_MASS_WRITE',
    `${Model.name} keeps versions, so ${Model.name}.${what}() over a condition is refused: it runs no instance hook, so henri would record nothing for every row it changed`,
    `Pass { individualHooks: true } and Sequelize runs them one by one, or loop over the records -- for (const record of await ${Model.name}.findAll({ where })) await record.${INSTEAD[what]}. { versions: false } writes them without a version, which is a decision rather than a silence`
  );

/**
 * The versions module of the running application, when there is one
 *
 * @param {object} henri the henri instance
 * @returns {?object} `henri.versions`, or null
 */
const versionsOn = (henri) => {
  const versions = henri && henri.versions;

  return versions && versions.enabled ? versions : null;
};

/**
 * An instance as a plain object
 *
 * @param {object} instance a sequelize instance
 * @returns {object} the attributes
 */
const plainOf = (instance) => ({ ...(instance && instance.dataValues) });

/**
 * The instance as it was before the write that is about to happen
 *
 * @param {object} instance a sequelize instance
 * @returns {object} the attributes
 */
const previousOf = (instance) => {
  const before = plainOf(instance);

  for (const field of instance.changed() || []) {
    before[field] = instance.previous(field);
  }

  return before;
};

/**
 * The hooks of one versioned model
 *
 * @param {object} Model a sequelize model
 * @param {object} henri the henri instance
 * @returns {object} the model
 */
const decorateModel = (Model, henri) => {
  const model = Model.name;
  const write = (event, options = {}) => {
    const versions = versionsOn(henri);

    return versions && options.versions !== false
      ? versions.record({ ...event, model })
      : null;
  };

  Model.addHook('afterCreate', 'henriVersions', (instance, options) =>
    write(
      {
        after: plainOf(instance),
        before: null,
        event: 'create',
        record: instance.externalId,
      },
      options
    )
  );

  Model.addHook('afterBulkCreate', 'henriVersions', async (rows, options) => {
    for (const instance of rows || []) {
      await write(
        {
          after: plainOf(instance),
          before: null,
          event: 'create',
          record: instance.externalId,
        },
        options
      );
    }
  });

  Model.addHook('beforeUpdate', 'henriVersions', (instance) => {
    instance[BEFORE] = previousOf(instance);
  });

  Model.addHook('afterUpdate', 'henriVersions', (instance, options) => {
    const before = instance[BEFORE] || null;

    delete instance[BEFORE];

    return before
      ? write(
          {
            after: plainOf(instance),
            before,
            event: 'update',
            record: instance.externalId,
          },
          options
        )
      : null;
  });

  Model.addHook('beforeDestroy', 'henriVersions', (instance) => {
    instance[BEFORE] = previousOf(instance);
  });

  Model.addHook('afterDestroy', 'henriVersions', (instance, options = {}) => {
    const before = instance[BEFORE] || plainOf(instance);
    // A soft delete leaves the row where it is with `deletedAt` set, so it
    // is an update and the diff says all of it. Only a row that left the
    // table is a `destroy`, and that is why a destroy carries a snapshot
    const soft = Model.options.paranoid && !options.force;

    delete instance[BEFORE];

    return write(
      {
        after: soft ? plainOf(instance) : null,
        before,
        event: soft ? 'update' : 'destroy',
        record: instance.externalId,
      },
      options
    );
  });

  // `beforeRestore` is where the stamp is still on the instance: reading
  // `previous('deletedAt')` after the fact answers nothing, and a restore
  // that recorded no version would be the one change a versioned model
  // quietly missed
  Model.addHook('beforeRestore', 'henriVersions', (instance) => {
    instance[BEFORE] = plainOf(instance);
  });

  Model.addHook('afterRestore', 'henriVersions', (instance, options) => {
    const before = instance[BEFORE] || plainOf(instance);

    delete instance[BEFORE];

    return write(
      {
        after: { ...plainOf(instance), deletedAt: null },
        before,
        event: 'update',
        record: instance.externalId,
      },
      options
    );
  });

  for (const [hook, what] of [
    ['beforeBulkUpdate', 'update'],
    ['beforeBulkDestroy', 'destroy'],
    ['beforeBulkRestore', 'restore'],
  ]) {
    Model.addHook(hook, 'henriVersions', (options = {}) => {
      if (options.versions === false || options.individualHooks === true) {
        return;
      }

      throw massWrite(Model, what);
    });
  }

  return Model;
};

module.exports = {
  BEFORE,
  decorateModel,
  massWrite,
  plainOf,
  previousOf,
  versionsOn,
};
