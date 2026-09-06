/**
 * Model versioning on a Drizzle model.
 *
 * The design, the four rules of what is never stored and what a row holds
 * per event are core's (`@usehenri/core/src/base/versions.js`). This is the
 * Drizzle half: the hooks that notice a change, and the refusal that keeps
 * a mass write from making the history lie.
 *
 * Nothing here runs for a model that did not ask. `decorateModel()` is
 * called from `addModel()` only when the model file says
 * `options: { versioned: ... }`, so an application with no versioned model
 * registers no hook, allocates nothing and takes no branch on its write
 * path.
 *
 * ## Where the old values come from
 *
 * `beforeUpdate` gets the values about to be written and the instance
 * being saved; `afterUpdate` gets the instance after `merge()`, which has
 * already reset the dirty tracking. So the state before the write is taken
 * in the before hook and left **on the instance**, under a symbol, for the
 * after hook to pick up: the two hooks of one save are the only pair that
 * can see both sides, and the options object is not shared by every path
 * (`Model.bindable()` copies it).
 *
 * The hooks are registered **after** the encryption hooks, so a value this
 * file sees on the way in is already an envelope. It does not matter: core
 * takes the old values off the instance, which holds plaintext, and writes
 * its own envelope with the field's own context. A version's envelope is a
 * re-wrap rather than a byte copy of the row's, and the header of
 * `base/versions.js` says so.
 *
 * ## Why a mass write is refused
 *
 * `Model.update(where, attrs)` runs the hooks **once and without an
 * instance**, so there is no before state and no record to name: a naive
 * implementation records nothing for a hundred changed rows, and a history
 * that silently misses changes reads as evidence and is not. Recording one
 * entry per row was the other option and it was refused twice over -- it
 * turns an update into a full read of every matching row, a cost nobody
 * wrote down, and the read and the update are not one statement, so a row
 * that changed in between would be recorded with a diff that never
 * happened. So a mass write on a versioned model raises
 * `HENRI_VERSION_MASS_WRITE` and names the two ways out: loop over the
 * records, or say `{ versions: false }` and mean it.
 *
 * @module versions
 */

const { coded } = require('./utils');

/** Where the state before a write waits for the hook that records it */
const BEFORE = Symbol('henri.versions.before');

/**
 * The mark a model file declared, or null
 *
 * @param {object} [model={}] a model file
 * @returns {*} what `options.versioned` said
 */
const versionedMark = (model = {}) => {
  const declared = ((model && model.options) || {}).versioned;

  return typeof declared === 'undefined' || declared === false
    ? null
    : declared;
};

/**
 * The versions module of the running application, when there is one
 *
 * @param {function} Model the model class
 * @returns {?object} `henri.versions`, or null
 */
const versionsOn = (Model) => {
  const henri = Model.adapter && Model.adapter.henri;
  const versions = henri && henri.versions;

  return versions && versions.enabled ? versions : null;
};

/** What the loop that replaces a mass write of each kind looks like */
const INSTEAD = {
  destroy: 'destroy()',
  restore: 'restore()',
  update: 'update(attrs)',
};

/**
 * The refusal a mass write on a versioned model gets
 *
 * @param {function} Model the model class
 * @param {string} what `update`, `destroy` or `restore`
 * @returns {Error} the error to throw
 */
const massWrite = (Model, what) =>
  coded(
    'HENRI_VERSION_MASS_WRITE',
    `${Model.modelName} keeps versions, so ${Model.modelName}.${what}() over a condition is refused: it runs the hooks once and without instances, so henri would record nothing for every row it changed`,
    `Loop over the records -- for (const record of await ${Model.modelName}.find(where)) await record.${INSTEAD[what]} -- and each one is versioned. { versions: false } writes them without a version, which is a decision rather than a silence`
  );

/**
 * Refuses a mass write on a versioned model, unless the caller said what
 * it wanted
 *
 * @param {function} Model the model class
 * @param {string} what `update`, `destroy` or `restore`
 * @param {object} [options={}] the caller's options
 * @returns {void}
 * @throws HENRI_VERSION_MASS_WRITE
 */
const checkMassWrite = (Model, what, options = {}) => {
  if (!Model.versioned || options.versions === false) {
    return;
  }

  throw massWrite(Model, what);
};

/**
 * A record as a plain object, hidden columns and all: a version undoes
 * what was written, and a column the serializer drops is still a column a
 * change touched
 *
 * @param {object} instance a model instance
 * @returns {object} the attributes
 */
const plainOf = (instance) =>
  instance && typeof instance.toObject === 'function'
    ? instance.toObject({ hidden: true })
    : { ...instance };

/**
 * Records one event, unless the caller opted out
 *
 * @param {function} Model the model class
 * @param {object} event `event`, `record`, `before`, `after`
 * @param {object} [options={}] the caller's options
 * @returns {Promise<*>} what the module answered
 */
const write = (Model, event, options = {}) => {
  const versions = versionsOn(Model);

  if (!versions || options.versions === false) {
    return null;
  }

  return versions.record({ ...event, model: Model.modelName });
};

/**
 * The hooks of one versioned model
 *
 * @param {function} Model the model class
 * @returns {function} the model
 */
const decorateModel = (Model) => {
  Model.internalHooks.afterCreate.push((instance, options = {}) =>
    write(
      Model,
      {
        after: plainOf(instance),
        before: null,
        event: 'create',
        record: instance.externalId,
      },
      options
    )
  );

  Model.internalHooks.beforeUpdate.push((values, options = {}, instance) => {
    if (instance) {
      instance[BEFORE] = plainOf(instance);
    }

    return values;
  });

  Model.internalHooks.afterUpdate.push((instance, options = {}) => {
    const before = instance[BEFORE] || null;

    delete instance[BEFORE];

    // Every single-row update path of this adapter goes through an
    // instance on a versioned model (`Model.findByIdAndUpdate` and
    // `findOneAndUpdate` read the record first), so a missing before state
    // is a path that has not been taught to version, not a diff to guess
    if (!before) {
      return null;
    }

    return write(
      Model,
      {
        after: plainOf(instance),
        before,
        event: 'update',
        record: instance.externalId,
      },
      options
    );
  });

  Model.internalHooks.beforeDestroy.push((instance) => {
    instance[BEFORE] = plainOf(instance);
  });

  Model.internalHooks.afterDestroy.push((instance, options = {}) => {
    const before = instance[BEFORE] || plainOf(instance);
    // A soft delete leaves the row where it is with `deletedAt` set, so it
    // is an update and the diff says all of it. Only a row that left the
    // table is a `destroy`, and that is exactly why a destroy carries a
    // snapshot and an update does not
    const soft = Model.paranoid && !options.force;

    delete instance[BEFORE];

    return write(
      Model,
      {
        after: soft ? plainOf(instance) : null,
        before,
        event: soft ? 'update' : 'destroy',
        record: instance.externalId,
      },
      options
    );
  });

  return Model;
};

module.exports = {
  BEFORE,
  checkMassWrite,
  decorateModel,
  massWrite,
  plainOf,
  versionedMark,
  versionsOn,
  write,
};
