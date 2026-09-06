const debug = require('debug')('henri:redis');

/**
 * The `{ get, set, add, delete }` store the idempotency keys use, on Redis.
 *
 * Values are JSON, the expiry is Redis' own (`PX`), and `add()` is one
 * `SET ... NX PX` -- an atomic claim, which is what makes two processes
 * racing on the same `Idempotency-Key` end with one execution and one 409
 * rather than two executions.
 *
 * Nothing here catches: a command that fails rejects, and `base/shared.js`
 * in core decides what that means (for these keys, always a 503).
 *
 * @class KeyValueStore
 */
class KeyValueStore {
  /**
   * Creates an instance of KeyValueStore.
   *
   * @param {object} options options
   * @param {function(): Promise<object>} options.client resolves the connected client
   * @param {string} options.prefix what every key is prefixed with
   * @memberof KeyValueStore
   */
  constructor({ client, prefix }) {
    this.client = client;
    this.prefix = prefix;
  }

  /**
   * The Redis key of an entry
   *
   * @param {string} key the key the caller used
   * @returns {string} the prefixed key
   * @memberof KeyValueStore
   */
  key(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Reads an entry
   *
   * @param {string} key the key
   * @returns {Promise<*>} the value, or undefined when there is none
   * @memberof KeyValueStore
   */
  async get(key) {
    const client = await this.client();
    const raw = await client.get(this.key(key));

    if (raw === null || typeof raw === 'undefined') {
      return undefined;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      // Something else wrote this key: forget it rather than fail every
      // retry of a request that can never replay
      debug('unreadable entry at %s: %s', key, error.message);
      await client.del(this.key(key));

      return undefined;
    }
  }

  /**
   * Writes an entry, replacing whatever was there
   *
   * @param {string} key the key
   * @param {*} value anything JSON-serializable
   * @param {number} ttl how long it lives (ms)
   * @returns {Promise<void>} done
   * @memberof KeyValueStore
   */
  async set(key, value, ttl) {
    const client = await this.client();

    await client.set(this.key(key), JSON.stringify(value), {
      PX: Math.max(1, Math.round(ttl)),
    });
  }

  /**
   * Writes an entry unless the key is taken. One round trip, atomic across
   * every process talking to this server.
   *
   * @param {string} key the key
   * @param {*} value anything JSON-serializable
   * @param {number} ttl how long it lives (ms)
   * @returns {Promise<boolean>} true when this call wrote it
   * @memberof KeyValueStore
   */
  async add(key, value, ttl) {
    const client = await this.client();
    const answer = await client.set(this.key(key), JSON.stringify(value), {
      NX: true,
      PX: Math.max(1, Math.round(ttl)),
    });

    return answer !== null;
  }

  /**
   * Removes an entry
   *
   * @param {string} key the key
   * @returns {Promise<void>} done
   * @memberof KeyValueStore
   */
  async delete(key) {
    const client = await this.client();

    await client.del(this.key(key));
  }
}

module.exports = KeyValueStore;
