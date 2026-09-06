const { RedisStore } = require('rate-limit-redis');
const debug = require('debug')('henri:redis');
const { createClient } = require('redis');

const KeyValueStore = require('./kv');

/**
 * The Redis backend of `config.shared`.
 *
 * henri's rate limit, sign-in lockout and idempotency keys are numbers per
 * key, and all three were per process. `config.shared` names where they are
 * counted instead; this is what that name resolves to:
 *
 * ```json
 * {
 *   "shared": {
 *     "adapter": "redis",
 *     "url": "redis://127.0.0.1:6379",
 *     "prefix": "lineup:"
 *   }
 * }
 * ```
 *
 * Core loads it from the application with `utils.resolveFrom`, the way it
 * loads a store adapter, so an application that does not name it never
 * installs it. Nothing here is a henri module: there is no runlevel to sit
 * at, because the server needs the counters at runlevel 2 and the sign-in
 * lockout at 4.
 *
 * ## Why node-redis
 *
 * `redis` (node-redis), not `ioredis`. ioredis' own README now sends new
 * projects to node-redis and calls its own maintenance best-effort, and
 * node-redis is the client Redis develops. Two of its properties are the
 * reason it fits here rather than merely being acceptable:
 *
 * - `connect()` is explicit, so a deployment learns at boot that the server
 *   is unreachable instead of at the first request that needed a counter;
 * - `disableOfflineQueue` turns a command sent while disconnected into an
 *   immediate rejection rather than a queued promise. A fail-closed guard
 *   has to answer 503 in milliseconds; a queued command would hang the
 *   request until the reconnect, which is the worst of both answers.
 *
 * `rate-limit-redis` (the store express-rate-limit's own author maintains)
 * takes `sendCommand`, so the limiter behaves exactly as it does in every
 * other express-rate-limit deployment.
 *
 * ## Connecting
 *
 * The reconnect never gives up and never storms: the delay doubles from
 * 100ms to ten seconds. `start()` waits `connectTimeout` for the first
 * connection and then stops waiting, without failing -- the client keeps
 * reconnecting, `GET /readyz` reports it, and requests meanwhile follow
 * `config.shared.onError`.
 */

/** How long `start()` waits for the first connection (ms) */
const CONNECT_TIMEOUT = 5000;

/** The longest the reconnect ever waits between attempts (ms) */
const MAX_BACKOFF = 10000;

/**
 * How long to wait before the next connection attempt: 100ms doubling to
 * ten seconds, so a server that is down for an hour costs a handful of
 * connections a minute instead of a storm
 *
 * @param {number} retries how many attempts have failed
 * @returns {number} the delay (ms)
 */
const backoff = (retries) =>
  Math.min(100 * 2 ** Math.min(Number(retries) || 0, 7), MAX_BACKOFF);

/**
 * The url with its password replaced, so it can be printed
 *
 * @param {string} url a connection string
 * @returns {string} the url, without the password
 */
function redact(url) {
  return String(url).replace(/^(\w+:\/\/[^:/@]*:)[^@/]*@/u, '$1[FILTERED]@');
}

/**
 * A promise that rejects after a delay
 *
 * @param {Promise} promise the promise to bound
 * @param {number} ms how long it may take
 * @param {string} message what to say when it does not
 * @returns {Promise} the promise, bounded
 */
function withTimeout(promise, ms, message) {
  let timer = null;

  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The keys of `config.shared` henri owns; everything else is a node-redis
 * option and reaches `createClient()`
 */
const OWN = ['adapter', 'connectTimeout', 'enabled', 'onError', 'prefix'];

/**
 * The Redis shared store
 *
 * @class RedisBackend
 */
class RedisBackend {
  /**
   * Creates an instance of RedisBackend.
   *
   * @param {object} [settings={}] the normalized `config.shared`
   * @param {?object} [henri=null] the henri instance, when there is one
   *   (`henri doctor` builds one without booting)
   * @memberof RedisBackend
   */
  constructor(settings = {}, henri = null) {
    const options = {};

    for (const key of Object.keys(settings)) {
      if (!OWN.includes(key)) {
        options[key] = settings[key];
      }
    }

    this.name = 'redis';
    this.henri = henri;
    this.prefix = settings.prefix || 'henri:';
    this.connectTimeout =
      Number(settings.connectTimeout) > 0
        ? Number(settings.connectTimeout)
        : CONNECT_TIMEOUT;
    this.url = options.url || 'redis://127.0.0.1:6379';
    this.options = Object.assign({ url: this.url }, options, {
      // A command sent while the connection is down fails now instead of
      // waiting for a reconnect that may be minutes away
      disableOfflineQueue: true,
      socket: Object.assign(
        { connectTimeout: this.connectTimeout, reconnectStrategy: backoff },
        options.socket
      ),
    });

    this.client = null;
    this.connecting = null;
    this.lastError = null;
    this.sendCommand = this.sendCommand.bind(this);
    this.connected = this.connected.bind(this);
  }

  /**
   * What this is talking to, with the password taken out
   *
   * @returns {string} the redacted url
   * @memberof RedisBackend
   */
  describe() {
    return redact(this.url);
  }

  /**
   * Opens the connection, at most once at a time.
   *
   * It resolves when the client is ready and rejects when the first attempt
   * has not landed within `connectTimeout` -- which does not stop the
   * client: it keeps reconnecting on its own, and the next call finds it
   * ready.
   *
   * @returns {Promise<object>} the client
   * @throws when the first connection does not land in time
   * @memberof RedisBackend
   */
  async start() {
    if (this.client && this.client.isReady) {
      return this.client;
    }

    if (!this.client) {
      this.client = createClient(this.options);
      // An unhandled `error` event throws, and there is one on every failed
      // reconnect. The log is not the place for them: what a request does
      // about it is core's business (`config.shared.onError`), and the boot
      // line and `GET /readyz` already say whether the server is up.
      this.client.on('error', (error) => {
        this.lastError = error;
        debug('client error: %s', error.message);
      });
    }

    if (!this.connecting) {
      this.connecting = Promise.resolve()
        .then(() => (this.client.isOpen ? null : this.client.connect()))
        .finally(() => {
          this.connecting = null;
        });
    }

    await withTimeout(
      this.connecting,
      this.connectTimeout,
      `redis did not answer within ${this.connectTimeout}ms${
        this.lastError ? ` (${this.lastError.message})` : ''
      }`
    );

    return this.client;
  }

  /**
   * The connected client, connecting when it is not.
   *
   * Every store call goes through this: a client that is up answers with no
   * added work, and one that is not fails now rather than queueing.
   *
   * @returns {Promise<object>} the client
   * @throws when it is not connected
   * @memberof RedisBackend
   */
  async connected() {
    if (this.client && this.client.isReady) {
      return this.client;
    }

    if (this.client && this.client.isOpen) {
      // Open but not ready: reconnecting. Fail now; the guard decides.
      throw new Error(
        `redis is not connected${this.lastError ? ` (${this.lastError.message})` : ''}`
      );
    }

    return this.start();
  }

  /**
   * Sends a raw command, which is all `rate-limit-redis` needs
   *
   * @param {...string} args the command and its arguments
   * @returns {Promise<*>} what Redis answered
   * @memberof RedisBackend
   */
  async sendCommand(...args) {
    const client = await this.connected();

    return client.sendCommand(args.map(String));
  }

  /**
   * Whether the server answers
   *
   * @returns {Promise<boolean>} true when it did
   * @throws when it did not
   * @memberof RedisBackend
   */
  async ping() {
    const client = await this.connected();

    await withTimeout(
      client.ping(),
      this.connectTimeout,
      `redis did not answer PING within ${this.connectTimeout}ms`
    );

    return true;
  }

  /**
   * An express-rate-limit store, one key space per limiter
   *
   * @param {string} feature the limiter name (`global`, `auth`, `lockout`)
   * @returns {object} the store
   * @memberof RedisBackend
   */
  rateLimitStore(feature) {
    return new RedisStore({
      prefix: `${this.prefix}rl:${feature}:`,
      sendCommand: this.sendCommand,
    });
  }

  /**
   * A `{ get, set, add, delete, clear }` store, one key space per feature
   *
   * @param {string} feature what the keys are for (`idempotency`, `cache`)
   * @param {object} [options={}] `raw` stores the string it is handed as it
   *   is, for a caller that has serialized already (the cache)
   * @returns {KeyValueStore} the store
   * @memberof RedisBackend
   */
  keyValueStore(feature, options = {}) {
    return new KeyValueStore({
      client: this.connected,
      prefix: `${this.prefix}kv:${feature}:`,
      raw: options.raw === true,
    });
  }

  /**
   * Closes the connection
   *
   * @returns {Promise<boolean>} done
   * @memberof RedisBackend
   */
  async stop() {
    const { client } = this;

    this.client = null;
    this.connecting = null;

    if (!client) {
      return true;
    }

    try {
      await withTimeout(client.close(), 1000, 'redis did not close in time');
    } catch (error) {
      debug('closing: %s', error.message);
      client.destroy();
    }

    return true;
  }
}

module.exports = RedisBackend;
module.exports.CONNECT_TIMEOUT = CONNECT_TIMEOUT;
module.exports.MAX_BACKOFF = MAX_BACKOFF;
module.exports.backoff = backoff;
module.exports.redact = redact;
