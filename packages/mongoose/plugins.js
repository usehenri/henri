const { Model } = require('mongoose');

/**
 * The Rails behaviours henri adds to Mongoose models: `paginate()` on every
 * model and, with `options: { paranoid: true }`, soft deletes (Rails'
 * `acts_as_paranoid`).
 */

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
      return Model[name].call(this, filter, rest);
    }

    const where = name.startsWith('findById') ? { _id: filter } : filter || {};
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

module.exports = { DELETE_STATICS, READ_HOOKS, paginate, paranoid };
