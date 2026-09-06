const { Model, isValidObjectId } = require('mongoose');
const {
  EXTERNAL_ID,
  isUuid,
  normalizeExternalId,
  resolvesKeys,
  uuidv7,
} = require('./external-id');

/**
 * The Rails behaviours henri adds to Mongoose models: `paginate()` and the
 * public `externalId` on every model and, with `options: { paranoid: true }`,
 * soft deletes (Rails' `acts_as_paranoid`).
 */

// A filter no document can match. `_id: null` is a legal ObjectId cast and
// matches nothing, which is what a refused lookup answers: the same empty
// result an unknown uuid gets, so the reply never says which it was.
//
// A function, not a constant: the object is handed to mongoose as a query
// filter, and a filter mongoose casts in place is a filter no two calls may
// share.
const NOTHING = () => ({ _id: null });

// The henri instance behind a schema, so a static can read
// `externalIds.lookup` without a global. Weak, so a reloaded schema is
// collected with its entry.
const owners = new WeakMap();

/**
 * Remembers which henri instance a schema belongs to
 *
 * @param {object} schema The Mongoose schema
 * @param {object} henri The henri instance
 * @returns {object} The schema
 */
const owned = (schema, henri) => {
  owners.set(schema, henri);

  return schema;
};

/**
 * The filter of a lookup by document id, and only by document id.
 *
 * A value the `_id` path cannot hold answers `NOTHING` rather than throwing
 * a CastError: a lookup that fails must look like a lookup that found no
 * document, and a 500 where a 404 belongs is an answer of its own.
 *
 * @param {object} model The model (`this` in a static)
 * @param {*} value A document id
 * @returns {object} The filter
 */
const keyFilter = (model, value) => {
  if (value === null || typeof value === 'undefined') {
    return NOTHING();
  }

  const path = model && model.schema && model.schema.path('_id');

  if (path && path.instance === 'ObjectId' && !isValidObjectId(value)) {
    return NOTHING();
  }

  return { _id: value };
};

/**
 * The filter of `findById()`: on a model carrying a public identifier it is
 * the uuid and nothing else, so a document id from a url matches nothing.
 * `externalIds.lookup: "any"` restores the document id.
 *
 * A model that opted out has no public identifier to prefer, so its
 * document id stays the identifier and keeps resolving.
 *
 * @param {object} model The model (`this` in a static)
 * @param {*} value An external id (or a document id, see above)
 * @returns {object} The filter
 */
const idFilter = (model, value) => {
  if (!model.schema.path(EXTERNAL_ID)) {
    return keyFilter(model, value);
  }

  if (isUuid(value)) {
    return { [EXTERNAL_ID]: normalizeExternalId(value) };
  }

  return resolvesKeys(owners.get(model.schema))
    ? keyFilter(model, value)
    : NOTHING();
};

// Queries that must not see soft deleted documents (Mongoose 9 has no
// `count`, `findOneAndRemove` or `findByIdAndRemove` any more)
const READ_HOOKS = [
  'countDocuments',
  'distinct',
  'find',
  'findOne',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
];

// Model statics that stamp `deletedAt` instead of deleting
const DELETE_STATICS = [
  'deleteMany',
  'deleteOne',
  'findByIdAndDelete',
  'findOneAndDelete',
];

/**
 * The two lookups every model gets, whichever identifier it carries.
 *
 * `findByKey()` is the document id and only the document id: the door for
 * the code that legitimately holds one (the subject of a session, a
 * reload), which `findById()` stopped being. `findByExternalId()` is the
 * public identifier and only that.
 *
 * @param {object} schema The Mongoose schema
 * @returns {object} The schema
 */
const lookups = (schema) => {
  /**
   * A document by its document id
   *
   * @param {*} id A document id
   * @param {*} [projection] The projection
   * @param {object} [options] Query options
   * @returns {object} A query
   */
  schema.statics.findByKey = function findByKey(id, projection, options) {
    return this.findOne(keyFilter(this, id), projection, options);
  };

  /**
   * A document by its public identifier
   *
   * @param {*} id An external id (a uuid)
   * @param {*} [projection] The projection
   * @param {object} [options] Query options
   * @returns {object} A query
   */
  schema.statics.findByExternalId = function findByExternalId(
    id,
    projection,
    options
  ) {
    return this.findOne(
      isUuid(id) && this.schema.path(EXTERNAL_ID)
        ? { [EXTERNAL_ID]: normalizeExternalId(id) }
        : NOTHING(),
      projection,
      options
    );
  };

  return schema;
};

/**
 * A positive integer, or a fallback
 *
 * @param {*} value Anything (a query string value, usually)
 * @param {number} fallback Used when the value is not a positive integer
 * @returns {number} The integer
 */
const toInt = (value, fallback) => {
  const number = parseInt(value, 10);

  return Number.isFinite(number) && number > 0 ? number : fallback;
};

/**
 * Adds `Model.paginate()`: one call for a page of documents and the
 * counters `res.collection()` wants
 *
 * @param {object} schema The Mongoose schema
 * @returns {object} The schema
 */
const paginate = (schema) => {
  /**
   * A page of documents and its counters
   *
   * @param {object} [options={}] `page` and `perPage` (as `req.pagination()`
   *   returns them; every other key it sets is ignored), `where` (the
   *   filter), `sort`, `select`, `populate`, `lean` and `withDeleted`
   * @returns {Promise<object>} `{ records, page, perPage, total, pages }`
   */
  schema.statics.paginate = async function paginate(options = {}) {
    const {
      lean = false,
      page: wanted,
      perPage: size,
      populate,
      select,
      sort,
      where = {},
      withDeleted = false,
    } = options;
    const page = toInt(wanted, 1);
    const perPage = toInt(size, 25);
    let query = this.find(where)
      .setOptions({ withDeleted })
      .skip((page - 1) * perPage)
      .limit(perPage);

    if (sort) {
      query = query.sort(sort);
    }
    if (select) {
      query = query.select(select);
    }
    if (populate) {
      query = query.populate(populate);
    }
    if (lean) {
      query = query.lean();
    }

    const [records, total] = await Promise.all([
      query,
      this.countDocuments(where).setOptions({ withDeleted }),
    ]);

    return {
      page,
      pages: Math.max(1, Math.ceil(total / perPage)),
      perPage,
      records,
      total,
    };
  };

  return schema;
};

/**
 * The soft delete of one static: stamps `deletedAt` and answers with the
 * shape the real method answers with
 *
 * @param {string} name The static being replaced
 * @returns {function} The replacement
 */
const soften = (name) =>
  /**
   * @param {*} [filter] The filter (an id for the findById* statics)
   * @param {object} [options={}] Options, `force: true` deletes for real
   * @returns {Promise<*>} What the replaced static answers
   */
  async function softDelete(filter, options = {}) {
    const { force, ...rest } = options;

    if (force) {
      // `findByIdAndDelete` takes an id: route it through the filter form so
      // that a public identifier is understood here too
      return name.startsWith('findById')
        ? Model.findOneAndDelete.call(this, idFilter(this, filter), rest)
        : Model[name].call(this, filter, rest);
    }

    const where = name.startsWith('findById')
      ? idFilter(this, filter)
      : filter || {};
    const update = { $set: { deletedAt: new Date() } };

    if (name === 'deleteMany' || name === 'deleteOne') {
      const result = await this[
        name === 'deleteMany' ? 'updateMany' : 'updateOne'
      ](where, update, rest);

      return { acknowledged: true, deletedCount: result.modifiedCount };
    }

    return this.findOneAndUpdate(where, update, {
      ...rest,
      returnDocument: 'before',
    });
  };

/**
 * Soft deletes, Rails' `acts_as_paranoid`: deleting stamps `deletedAt`,
 * every query hides the stamped documents, `{ withDeleted: true }` shows
 * them again and `{ force: true }` deletes for real
 *
 * @param {object} schema The Mongoose schema
 * @returns {object} The schema
 */
const paranoid = (schema) => {
  schema.add({ deletedAt: { default: null, index: true, type: Date } });

  schema.pre(READ_HOOKS, function hideDeleted() {
    const options = this.getOptions() || {};

    if (options.withDeleted) {
      return;
    }

    this.where({ deletedAt: null });
  });

  DELETE_STATICS.forEach((name) => {
    schema.statics[name] = soften(name);
  });

  /**
   * Stamps this document as deleted (`{ force: true }` deletes it)
   *
   * @param {object} [options={}] Options, `force: true` deletes for real
   * @returns {Promise<object>} The document
   */
  schema.methods.deleteOne = async function softDeleteOne(options = {}) {
    const { force, ...rest } = options;

    if (force) {
      return Model.prototype.deleteOne.call(this, rest);
    }

    this.deletedAt = new Date();

    return this.save(rest);
  };

  /**
   * Every document, the soft deleted ones included
   *
   * @param {object} [filter={}] The filter
   * @returns {object} A query
   */
  schema.statics.withDeleted = function withDeleted(filter = {}) {
    return this.find(filter).setOptions({ withDeleted: true });
  };

  /**
   * The soft deleted documents only
   *
   * @param {object} [filter={}] The filter
   * @returns {object} A query
   */
  schema.statics.onlyDeleted = function onlyDeleted(filter = {}) {
    return this.find({ ...filter, deletedAt: { $ne: null } }).setOptions({
      withDeleted: true,
    });
  };

  /**
   * Clears the `deletedAt` stamp of every matching document
   *
   * @param {object} [filter={}] The filter
   * @returns {Promise<object>} The update result
   */
  schema.statics.restore = function restore(filter = {}) {
    return this.updateMany(
      { ...filter, deletedAt: { $ne: null } },
      { $set: { deletedAt: null } }
    ).setOptions({ withDeleted: true });
  };

  /**
   * Clears the `deletedAt` stamp of this document
   *
   * @returns {Promise<object>} The document
   */
  schema.methods.restore = async function restore() {
    this.deletedAt = null;

    return this.save();
  };

  return schema;
};

/**
 * The public identifier of every document: `externalId`, a uuid v7 written
 * on insert, unique and indexed. The document id stays internal, is never
 * serialized, and the lookups by id take either of the two.
 *
 * `options: { externalId: false }` on the model file opts out.
 *
 * @param {object} schema The Mongoose schema
 * @returns {object} The schema
 */
const externalId = (schema) => {
  schema.add({
    [EXTERNAL_ID]: {
      default: uuidv7,
      immutable: true,
      lowercase: true,
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
  });

  // What leaves the server carries the external id and not the document id
  schema.set('toJSON', {
    ...(schema.get('toJSON') || {}),
    /**
     * Drops the document id from the JSON representation
     *
     * @param {object} doc The document
     * @param {object} ret The plain object being built
     * @returns {object} The plain object
     */
    transform(doc, ret) {
      delete ret._id;
      delete ret.__v;

      return ret;
    },
  });

  /**
   * A document by id: the public identifier or the document id
   *
   * @param {*} id An external id or a document id
   * @param {*} [projection] The projection
   * @param {object} [options] Query options
   * @returns {object} A query
   */
  schema.statics.findById = function findById(id, projection, options) {
    return this.findOne(idFilter(this, id), projection, options);
  };

  /**
   * Updates a document by id
   *
   * @param {*} id An external id or a document id
   * @param {object} [update] The update
   * @param {object} [options] Query options
   * @returns {object} A query
   */
  schema.statics.findByIdAndUpdate = function findByIdAndUpdate(
    id,
    update,
    options
  ) {
    return this.findOneAndUpdate(idFilter(this, id), update, options);
  };

  /**
   * Deletes a document by id (a soft delete on a paranoid model)
   *
   * @param {*} id An external id or a document id
   * @param {object} [options] Query options
   * @returns {object} A query
   */
  schema.statics.findByIdAndDelete = function findByIdAndDelete(id, options) {
    return this.findOneAndDelete(idFilter(this, id), options);
  };

  return schema;
};

module.exports = {
  DELETE_STATICS,
  NOTHING,
  READ_HOOKS,
  externalId,
  idFilter,
  keyFilter,
  lookups,
  owned,
  paginate,
  paranoid,
};
