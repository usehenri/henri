const path = require('path');
const { DAY, MemoryStore } = require('./idempotency');
const { AUTH_DEFAULTS, DEFAULTS: RATE_DEFAULTS } = require('./rate-limit');
const { DEFAULTS: PAGE_DEFAULTS } = require('./pagination');
const { filterParameters } = require('./redact');

/**
 * `henri.api`: the settings of the JSON API and the stores it uses.
 *
 * ```json
 * {
 *   "api": {
 *     "strict": false,
 *     "perPage": 25,
 *     "maxPerPage": 100,
 *     "idempotency": { "ttl": 86400000, "store": null }
 *   },
 *   "rateLimit": {
 *     "windowMs": 60000,
 *     "max": 600,
 *     "auth": { "windowMs": 60000, "max": 10 },
 *     "store": null
 *   },
 *   "bodyLimit": "1mb",
 *   "requestTimeout": 30000,
 *   "filterParameters": ["password", "token", "secret", "authorization"]
 * }
 * ```
 *
 * `api.idempotency`, `rateLimit`, `rateLimit.auth` and `requestTimeout`
 * accept `false`. The `store` keys name a module (resolved from the
 * application) exporting a store or a `(henri, { name }) => store` factory.
 */

/**
 * A positive number, or the fallback
 *
 * @param {*} value the value
 * @param {number} fallback the fallback
 * @returns {number} a positive number
 */
const positive = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) > 0
    ? Number(value)
    : fallback;

/**
 * A plain object, or an empty one
 *
 * @param {*} value the value
 * @returns {object} a plain object
 */
const objectOf = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/**
 * The normalized settings from the configuration
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @param {object} [user={}] the normalized user settings (for `loginPath`)
 * @returns {object} settings
 */
function settings(config, user = {}) {
  const has = (key) =>
    Boolean(config) && typeof config.has === 'function' && config.has(key);
  const get = (key, fallback) => (has(key) ? config.get(key) : fallback);
  const api = objectOf(get('api', {}));
  const idempotency = objectOf(api.idempotency);
  const rate = get('rateLimit', {});
  const rateLimit = objectOf(rate === true ? {} : rate);
  const auth = objectOf(rateLimit.auth);
  const timeout = get('requestTimeout', 30000);

  return {
    bodyLimit:
      typeof get('bodyLimit') === 'string' || Number(get('bodyLimit')) > 0
        ? get('bodyLimit')
        : '1mb',
    filterParameters: filterParameters(config),
    idempotency:
      api.idempotency === false
        ? false
        : {
            store:
              typeof idempotency.store === 'string' ? idempotency.store : null,
            ttl: positive(idempotency.ttl, DAY),
          },
    pagination: {
      maxPerPage: positive(api.maxPerPage, PAGE_DEFAULTS.maxPerPage),
      perPage: positive(api.perPage, PAGE_DEFAULTS.perPage),
    },
    rateLimit:
      rate === false
        ? false
        : {
            auth:
              rateLimit.auth === false
                ? false
                : {
                    loginPath: user.loginPath || '/login',
                    max: positive(auth.max, AUTH_DEFAULTS.max),
                    paths: Array.isArray(auth.paths) ? auth.paths : undefined,
                    windowMs: positive(auth.windowMs, AUTH_DEFAULTS.windowMs),
                  },
            max: positive(
              typeof rateLimit.limit === 'undefined'
                ? rateLimit.max
                : rateLimit.limit,
              RATE_DEFAULTS.max
            ),
            store: typeof rateLimit.store === 'string' ? rateLimit.store : null,
            windowMs: positive(rateLimit.windowMs, RATE_DEFAULTS.windowMs),
          },
    requestTimeout: timeout === false ? false : positive(timeout, 30000),
    strict: api.strict === true,
  };
}

/**
 * Loads a store module named in the configuration
 *
 * @param {Henri} henri the henri instance
 * @param {string} id module id or path, relative to the application
 * @param {object} [context={}] handed to a factory export (`{ name }`)
 * @returns {*} the store
 * @throws when the module cannot be loaded
 */
function loadStore(henri, id, context = {}) {
  const cwd = henri.cwd();
  const target = id.startsWith('.') ? path.resolve(cwd, id) : id;

  try {
    const loaded = require(henri.utils.resolveFrom(target, cwd));
    const mod = loaded && loaded.default ? loaded.default : loaded;

    return typeof mod === 'function' && !mod.get ? mod(henri, context) : mod;
  } catch (error) {
    throw new Error(`unable to load the store '${id}': ${error.message}`, {
      cause: error,
    });
  }
}

/**
 * Builds `henri.api`
 *
 * @param {Henri} henri the henri instance
 * @param {object} [user={}] the normalized user settings
 * @returns {object} the api namespace
 */
function createApi(henri, user = {}) {
  const config = settings(henri.config, user);
  const api = {
    /** Rate limiters created by the server and the router (stopped with them) */
    limiters: [],
    settings: config,
    /** Resource routes already reported for answering JSON without _links */
    warned: new Set(),
  };

  api.idempotencyStore =
    config.idempotency && config.idempotency.store
      ? loadStore(henri, config.idempotency.store, { name: 'idempotency' })
      : new MemoryStore();

  /**
   * An express-rate-limit store for a limiter (`config.rateLimit.store`),
   * or undefined for the library's memory store
   *
   * @param {string} name the limiter name
   * @returns {?object} a store
   */
  api.rateLimitStore = (name) =>
    config.rateLimit && config.rateLimit.store
      ? loadStore(henri, config.rateLimit.store, { name })
      : undefined;

  /**
   * Releases the stores and timers
   *
   * @returns {void}
   */
  api.stop = () => {
    const { shutdown } = require('./rate-limit');

    api.limiters.splice(0).forEach(shutdown);
    api.warned.clear();

    if (
      api.idempotencyStore &&
      typeof api.idempotencyStore.shutdown === 'function'
    ) {
      api.idempotencyStore.shutdown();
    }
  };

  return api;
}

module.exports = { createApi, loadStore, settings };
