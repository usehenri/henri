const { coded } = require('./utils');

/**
 * Model versioning on a Mongoose model.
 *
 * The design, the four rules of what is never stored and what a row holds
 * per event are core's (`@usehenri/core/src/base/versions.js`). This is the
 * Mongoose half, and it is the awkward one, because Mongoose has two kinds
 * of write and only one of them passes through a document.
 *
 * Nothing here is installed on a model that did not ask: `versioned()` is
 * called from `addModel()` only when the model file says
 * `options: { versioned: ... }`.
 *
 * ## Documents: the snapshot taken at `init`
 *
 * A version needs the state *before* a write, and Mongoose keeps no public
 * copy of it -- `isModified()` says which paths changed, not what they
 * were. So the document keeps its own: `post('init')` puts a plain copy in
 * `doc.$locals`, `pre('save')` moves it aside as the before state, and
 * `post('save')` writes the version and takes a fresh copy. That is one
 * `toObject()` per load of a versioned model and nothing at all for every
 * other model.
 *
 * The plugin is applied **after** the encryption plugin, so its
 * `post('save')` runs after the one that puts the plaintext back into the
 * document: a version therefore reads plaintext and core writes its own
 * envelope, with the field's own context.
 *
 * ## Queries: the read before, and the refusal
 *
 * `findOneAndUpdate`, `updateOne`, `replaceOne`, `findOneAndDelete` and
 * `deleteOne` name one document and run no document middleware, so this
 * file reads it before the write and reads it again after: two extra
 * queries per write on a versioned model, which is the honest price of a
 * history. It has to be a read rather than a reconstruction because the
 * update is a language (`$set`, `$inc`, `$push`) and only the database
 * knows what it did.
 *
 * `updateMany` and `deleteMany` are **refused** (`HENRI_VERSION_MASS_WRITE`)
 * and so is `bulkWrite`. They change an unbounded number of documents in
 * one statement, and there is no moment at which henri holds either side of
 * any of them: the naive implementation records nothing for a hundred
 * changed documents, and a history that silently misses changes reads as
 * evidence and is not. `{ versions: false }` is the way through, and it is
 * a decision rather than a silence.
 *
 * `insertMany` is the exception and the reason is worth stating: a create
 * has no before state, so the documents it answers *are* the whole of what
 * a version would hold. Nothing is lost, so nothing is refused.
 *
 * A paranoid model's soft deletes are rewritten into updates by
 * `plugins.js` before they get here, which is exactly right: a soft delete
 * leaves the row where it is, so it is an update and its diff says all of
 * it.
 *
 * @module versions
 */

/** Where the state before a write waits, on a document */
const BEFORE = '$henriVersionBefore';

/** ... and where the copy taken at `init` waits for the next write */
const SNAPSHOT = '$henriVersionSnapshot';

/** ... and whether the save being watched is an insert */
const CREATING = '$henriVersionCreating';

/** The single-document writes that run no document middleware */
const ONE = ['findOneAndUpdate', 'updateOne', 'replaceOne'];

/** ... and the ones that take a document away */
const ONE_DELETE = ['findOneAndDelete', 'deleteOne'];

/** The writes that change an unbounded number of documents at once */
const MANY = ['deleteMany', 'updateMany'];

/** What the loop that replaces a mass write of each kind looks like */
const INSTEAD = {
  bulkWrite: 'save()',
  deleteMany: 'deleteOne()',
  updateMany: 'save()',
};

/**
 * The refusal a mass write on a versioned model gets
 *
 * @param {string} model the model name
 * @param {string} what the operation
 * @returns {Error} the error to throw
 */
const massWrite = (model, what) =>
  coded(
    'HENRI_VERSION_MASS_WRITE',
    `${model} keeps versions, so ${model}.${what}() is refused: it changes any number of documents in one statement and runs no document middleware, so henri would record nothing for every one of them`,
    `Loop over the documents -- for (const record of await ${model}.find(filter)) await record.${INSTEAD[what] || 'save()'} -- and each one is versioned. { versions: false } writes them without a version, which is a decision rather than a silence`
  );

/**
 * The versions module of the running application, when there is one
 *
 * @param {object} henri the henri instance the schema belongs to
 * @returns {?object} `henri.versions`, or null
 */
const versionsOn = (henri) => {
  const versions = henri && henri.versions;

  return versions && versions.enabled ? versions : null;
};

/**
 * A document as a plain object
 *
 * @param {object} doc a document
 * @returns {object} the attributes
 */
const plainOf = (doc) =>
  doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };

/**
 * Records one event
 *
 * @param {object} henri the henri instance
 * @param {string} model the model name
 * @param {object} event `event`, `record`, `before`, `after`
 * @returns {Promise<*>} what the module answered
 */
const write = (henri, model, event) => {
  const versions = versionsOn(henri);

  return versions ? versions.record({ ...event, model }) : null;
};

/**
 * Did the caller ask for this write not to be versioned?
 *
 * @param {object} query a mongoose query
 * @returns {boolean} true when it did
 */
const optedOut = (query) => {
  const options = (query && query.getOptions && query.getOptions()) || {};

  return options.versions === false;
};

/**
 * The document a single-document write is about, soft deleted or not
 *
 * @param {object} query a mongoose query
 * @returns {Promise<?object>} the document, or null
 */
const targetOf = (query) =>
  query.model
    .findOne(query.getFilter())
    .setOptions({ versions: false, withDeleted: true });

/**
 * The versioning of one model: the document hooks, the query hooks and the
 * refusals
 *
 * @param {object} schema the mongoose schema
 * @param {object} henri the henri instance the schema belongs to
 * @param {string} model the model name
 * @returns {object} the schema
 */
const versioned = (schema, henri, model) => {
  schema.post('init', function afterInit() {
    this.$locals[SNAPSHOT] = plainOf(this);
  });

  schema.pre('save', function beforeSave() {
    this.$locals[CREATING] = this.isNew;
    this.$locals[BEFORE] = this.isNew ? null : this.$locals[SNAPSHOT] || {};
  });

  schema.post('save', async function afterSave(doc) {
    const creating = doc.$locals[CREATING] === true;
    const before = doc.$locals[BEFORE] || null;
    const after = plainOf(doc);

    doc.$locals[SNAPSHOT] = after;
    doc.$locals[BEFORE] = null;

    await write(henri, model, {
      after,
      before,
      event: creating ? 'create' : 'update',
      record: doc.externalId,
    });
  });

  schema.pre(
    'deleteOne',
    { document: true, query: false },
    function beforeDelete() {
      this.$locals[BEFORE] = plainOf(this);
    }
  );

  schema.post(
    'deleteOne',
    { document: true, query: false },
    async function afterDelete(doc) {
      await write(henri, model, {
        after: null,
        before: doc.$locals[BEFORE] || plainOf(doc),
        event: 'destroy',
        record: doc.externalId,
      });
    }
  );

  schema.pre([...ONE, ...ONE_DELETE], async function beforeOne() {
    if (optedOut(this)) {
      return;
    }

    this[BEFORE] = await targetOf(this);
  });

  schema.post(ONE, async function afterOne() {
    const before = this[BEFORE];

    this[BEFORE] = null;

    if (!before) {
      return;
    }

    const after = await this.model
      .findById(before.externalId)
      .setOptions({ versions: false, withDeleted: true });

    if (!after) {
      return;
    }

    await write(henri, model, {
      after: plainOf(after),
      before: plainOf(before),
      event: 'update',
      record: before.externalId,
    });
  });

  schema.post(ONE_DELETE, async function afterOneDelete() {
    const before = this[BEFORE];

    this[BEFORE] = null;

    if (!before) {
      return;
    }

    await write(henri, model, {
      after: null,
      before: plainOf(before),
      event: 'destroy',
      record: before.externalId,
    });
  });

  schema.post('insertMany', async function afterInsertMany(docs) {
    if (optedOut(this) || !Array.isArray(docs)) {
      return;
    }

    for (const doc of docs) {
      await write(henri, model, {
        after: plainOf(doc),
        before: null,
        event: 'create',
        record: doc.externalId,
      });
    }
  });

  schema.pre(MANY, function refuseMany() {
    if (optedOut(this)) {
      return;
    }

    throw massWrite(model, this.op || 'updateMany');
  });

  schema.pre('bulkWrite', function refuseBulk(ops, options = {}) {
    if (options && options.versions === false) {
      return;
    }

    throw massWrite(model, 'bulkWrite');
  });

  return schema;
};

module.exports = {
  BEFORE,
  CREATING,
  MANY,
  ONE,
  ONE_DELETE,
  SNAPSHOT,
  massWrite,
  plainOf,
  versioned,
  versionsOn,
  write,
};
