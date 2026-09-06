/**
 * A store `config.rateLimit.store` can name: a factory, which is the other
 * shape `loadStore()` accepts
 *
 * @param {object} henri the henri instance
 * @param {object} [context={}] `{ name }`, the limiter it is for
 * @returns {object} the store
 */
module.exports = (henri, { name } = {}) => ({
  decrement() {},
  increment() {},
  named: name,
  resetKey() {},
});
