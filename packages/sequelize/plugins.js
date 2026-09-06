const { DataTypes } = require('sequelize');
const {
  EXTERNAL_ID,
  isUuid,
  normalizeExternalId,
  resolvesKeys,
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
 * Adds the two lookups henri splits an id into.
 *
 * `findById()` is the one that takes what arrived from outside, and on a
 * model carrying a public identifier (`external-id.js`) it takes a uuid and
 * nothing else: a primary key answers `null`, the same `null` a uuid naming
 * no row answers, so nothing in the reply says which of the two it was.
 * `externalIds.lookup: "any"` restores the old permissive behaviour.
 *
 * `findByKey()` is the primary key and only the primary key, for the code
 * that legitimately holds one -- the subject of a session, a row it just
 * joined. `findByPk()`, the Sequelize name, is its alias.
 *
 * A model that opted out of the public identifier has only the primary key
 * to be found by, so both take it and nothing changes for it.
 *
 * @param {object} Model A Sequelize model
 * @param {boolean} external Does the model carry a public identifier?
 * @param {object} henri The henri instance (for `externalIds.lookup`)
 * @returns {object} The model
 */
const lookup = (Model, external, henri) => {
  const findByPk = Model.findByPk;

  /**
   * Can the primary key column hold this value at all?
   *
   * A uuid handed to an integer key is a `SequelizeDatabaseError` on
   * PostgreSQL, which would answer a 500 -- and print a fragment of SQL --
   * where a lookup that found nothing belongs. It answers `null` instead,
   * the way every other miss does.
   *
   * @param {object} model The model (`this` in a static)
   * @param {*} value The value
   * @returns {boolean} true when the lookup is worth running
   */
  const castable = (model, value) => {
    if (value === null || typeof value === 'undefined' || value === '') {
      return false;
    }

    const attribute = model.rawAttributes[model.primaryKeyAttribute] || {};

    return (
      !(attribute.type instanceof DataTypes.INTEGER) ||
      /^\d+$/u.test(String(value))
    );
  };

  /**
   * A row by primary key, never by public identifier
   *
   * @param {*} value A primary key
   * @param {object} [options] findByPk options
   * @returns {Promise<?object>} The row or null
   */
  Model.findByKey = function findByKey(value, options) {
    if (!castable(this, value)) {
      return Promise.resolve(null);
    }

    return findByPk.call(this, value, options);
  };

  /**
   * A row by public identifier
   *
   * @param {*} value An external id (a uuid)
   * @param {object} [options] findOne options
   * @returns {Promise<?object>} The row or null
   */
  Model.findByExternalId = function findByExternalId(value, options) {
    return this.findOne({
      ...options,
      where: {
        ...((options && options.where) || {}),
        [EXTERNAL_ID]: normalizeExternalId(value),
      },
    });
  };

  /**
   * A row by the identifier the outside world holds
   *
   * @param {*} value An external id (or a primary key, on a model that has
   *   no external id or an application that opted out of the strict lookup)
   * @param {object} [options] findByPk/findOne options
   * @returns {Promise<?object>} The row or null
   */
  Model.findById = function findById(value, options) {
    if (!external) {
      return this.findByKey(value, options);
    }

    if (isUuid(value)) {
      return this.findByExternalId(value, options);
    }

    if (resolvesKeys(henri)) {
      return this.findByKey(value, options);
    }

    return Promise.resolve(null);
  };

  Model.findByPk = Model.findByKey;

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
