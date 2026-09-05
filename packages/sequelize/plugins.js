/**
 * The Rails behaviours henri adds to every Sequelize model. Soft deletes
 * are Sequelize's own `paranoid` option, so only `paginate()` is added here.
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

module.exports = { paginate };
