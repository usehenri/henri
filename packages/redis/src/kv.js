const debug = require('debug')('henri:redis');

/** How many keys a `clear()` asks Redis for per round trip */
const SCAN_COUNT = 250;

/**
 * The `{ get, set, add, delete }` store the idempotency keys use, on Redis.
 *
 * Values are JSON, the expiry is Redis' own (`PX`), and `add()` is one
 * `SET ... NX PX` -- an atomic claim, which is what makes two processes
 * racing on the same `Idempotency-Key` end with one execution and one 409
 * rather than two executions.
 *
 * `raw` turns the JSON off, for a caller that has already serialized: the
 * cache hands over the string it encoded and measured, and encoding it a
 * second time would only escape every quote in it.
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
   * @param {boolean} [options.raw=false] store the string as it arrives
   * @memberof KeyValueStore
   */
  constructor({ client, prefix, raw = false }) {
    this.client = client;
    this.prefix = prefix;
    this.raw = Boolean(raw);
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

    if (this.raw) {
      return raw;
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
   * What is written down for a value: JSON, or the string itself in `raw`
   *
   * @param {*} value what the caller is storing
   * @returns {string} what Redis is handed
   * @memberof KeyValueStore
   */
  payload(value) {
    return this.raw ? String(value) : JSON.stringify(value);
  }

  /**
   * Writes an entry, replacing whatever was there
   *
   * @param {string} key the key
   * @param {*} value anything JSON-serializable (a string in `raw`)
   * @param {number} ttl how long it lives (ms)
   * @returns {Promise<void>} done
   * @memberof KeyValueStore
   */
  async set(key, value, ttl) {
    const client = await this.client();

    await client.set(this.key(key), this.payload(value), {
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
    const answer = await client.set(this.key(key), this.payload(value), {
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

  /**
   * Removes every key of this store, or of a prefix inside it.
   *
   * `SCAN` and `UNLINK`, never `KEYS` and never `FLUSHDB`: the server may
   * be holding somebody else's data and this only ever touches the store's
   * own key space. It walks the whole keyspace to do it, so it belongs in a
   * teardown or a console rather than in a request.
   *
   * @param {string} [prefix=''] a prefix inside the store (all of it when empty)
   * @returns {Promise<number>} how many keys were removed
   * @memberof KeyValueStore
   */
  async clear(prefix = '') {
    const client = await this.client();
    const match = `${this.key(prefix)}*`;
    let cursor = '0';
    let removed = 0;

    do {
      const page = await client.scan(cursor, {
        COUNT: SCAN_COUNT,
        MATCH: match,
      });

      cursor = String(page.cursor);

      if (page.keys.length > 0) {
        removed += await client.unlink(page.keys);
      }
    } while (cursor !== '0');

    debug('cleared %d keys matching %s', removed, match);

    return removed;
  }
}

module.exports = KeyValueStore;
