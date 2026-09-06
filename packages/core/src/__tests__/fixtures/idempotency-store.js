/**
 * A store `config.api.idempotency.store` can name
 *
 * @param {object} henri the henri instance
 * @param {object} [context={}] `{ name }`
 * @returns {object} the store
 */
module.exports = (henri, { name } = {}) => ({
  add() {},
  delete() {},
  get() {},
  named: name,
  set() {},
});
