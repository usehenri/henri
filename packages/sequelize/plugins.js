const {
  EXTERNAL_ID,
  isUuid,
  normalizeExternalId,
  withoutInternalIds,
} = require('./external-id');

/**
 * The Rails behaviours henri adds to every Sequelize model. Soft deletes
 * are Sequelize's own `paranoid` option, so `paginate()`, `findById()` and
 * the public identifier are what is added here.
 */

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
 * Adds `Model.paginate()`: one call for a page of rows and the counters
 * `res.collection()` wants
 *
 * @param {object} Model A Sequelize model
 * @returns {object} The model
 */
const paginate = (Model) => {
  /**
   * A page of rows and its counters
   *
   * @param {object} [options={}] `page` and `perPage` (as `req.pagination()`
   *   returns them, its `limit`, `offset` and `skip` are ignored); every
   *   other key is a `findAndCountAll()` option (`where`, `order`,
   *   `include`, `attributes`, `paranoid`, ...)
   * @returns {Promise<object>} `{ records, page, perPage, total, pages }`
   */
  Model.paginate = async function paginate(options = {}) {
    // `limit`, `offset` and `skip` are dropped so `Model.paginate(
    // req.pagination())` can be handed the whole object
    const {
      limit,
      offset,
      page: wanted,
      perPage: size,
      skip,
      ...query
    } = options;
    const page = toInt(wanted, 1);
    const perPage = toInt(size, 25);
    const { count, rows } = await this.findAndCountAll({
      ...query,
      limit: perPage,
      offset: (page - 1) * perPage,
    });
    // `findAndCountAll` counts groups when the query groups rows
    const total = Array.isArray(count) ? count.length : count;

    return {
      page,
      pages: Math.max(1, Math.ceil(total / perPage)),
      perPage,
      records: rows,
      total,
    };
  };

  return Model;
};

/**
 * Adds `Model.findById()`: the Sequelize name is `findByPk`, and henri
 * wants one lookup that takes whatever `req.params.id` holds.
 *
 * With a public identifier (`external-id.js`) a uuid is looked up on
 * `externalId` and anything else on the primary key, which can never be
 * confused: a uuid is 36 characters with dashes, a primary key is not.
 * `findByPk()` accepts both too, so existing code keeps working.
 *
 * @param {object} Model A Sequelize model
 * @param {boolean} external Does the model carry a public identifier?
 * @returns {object} The model
 */
const lookup = (Model, external) => {
  const findByPk = Model.findByPk;

  /**
   * A row by id: the public identifier or the primary key
   *
   * @param {*} value An external id or a primary key
   * @param {object} [options] findByPk/findOne options
   * @returns {Promise<?object>} The row or null
   */
  Model.findById = function findById(value, options) {
    if (external && isUuid(value)) {
      return this.findOne({
        ...options,
        where: {
          ...((options && options.where) || {}),
          [EXTERNAL_ID]: normalizeExternalId(value),
        },
      });
    }

    return findByPk.call(this, value, options);
  };

  Model.findByPk = function findByPkOrExternalId(value, options) {
    return this.findById(value, options);
  };

  return Model;
};

/**
 * The two halves of the public identifier on a model that carries one: the
 * primary key stops leaving the server (`toJSON()`, and everything built on
 * it, answers with `externalId` instead), and the public identifier is
 * written once, on the insert, so the urls of a record never move.
 *
 * @param {object} Model A Sequelize model
 * @returns {object} The model
 */
const publicId = (Model) => {
  /**
   * The row as JSON, without its primary key
   *
   * @returns {object} A plain object
   */
  Model.prototype.toJSON = function toJSON() {
    return withoutInternalIds(this.get({ plain: true }));
  };

  Model.addHook('beforeUpdate', 'henriExternalId', (record) => {
    if (record.changed(EXTERNAL_ID)) {
      record.set(EXTERNAL_ID, record.previous(EXTERNAL_ID));
      record.changed(EXTERNAL_ID, false);
    }
  });

  Model.addHook('beforeBulkUpdate', 'henriExternalId', (options = {}) => {
    const values = options.attributes || {};

    if (EXTERNAL_ID in values) {
      delete values[EXTERNAL_ID];
      options.fields = (options.fields || []).filter(
        (field) => field !== EXTERNAL_ID
      );
    }
  });

  return Model;
};

module.exports = { lookup, paginate, publicId };
