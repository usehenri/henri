/**
 * A cache backend `config.cache.store` can name: three methods over
 * strings, and the `clear(prefix)` that makes `henri.cache.clear()` work.
 *
 * @param {object} henri the henri instance
 * @param {object} [context={}] `{ name }`
 * @returns {object} the store
 */
module.exports = (henri, { name } = {}) => {
  const entries = new Map();

  return {
    /**
     * Removes every key of a prefix
     *
     * @param {string} [prefix=''] the prefix
     * @returns {Promise<number>} how many were removed
     */
    clear: async (prefix = '') => {
      let removed = 0;

      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) {
          entries.delete(key);
          removed += 1;
        }
      }

      return removed;
    },

    /**
     * Removes an entry
     *
     * @param {string} key the key
     * @returns {Promise<void>} done
     */
    delete: async (key) => {
      entries.delete(key);
    },

    /**
     * Reads an entry
     *
     * @param {string} key the key
     * @returns {Promise<?string>} the encoded entry
     */
    get: async (key) => entries.get(key),

    name: 'fixture',
    named: name,

    /**
     * Writes an entry
     *
     * @param {string} key the key
     * @param {string} payload the encoded entry
     * @returns {Promise<boolean>} written
     */
    set: async (key, payload) => {
      entries.set(key, payload);

      return true;
    },
  };
};
