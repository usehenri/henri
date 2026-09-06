const path = require('path');
const debug = require('debug')('henri:shared');

/**
 * The shared store: one backend, every counter that has to be counted once.
 *
 * Three guards keep a number per key and all three were per process: the
 * rate limiter (`base/rate-limit.js`), the sign-in lockout
 * (`base/lockout.js`) and the idempotency keys (`base/idempotency.js`).
 * Each already accepted a store of its own, in its own configuration key, so
 * an application that wanted them shared had to say it three times and an
 * application that said it nowhere got two of everything the moment it ran
 * two processes: a rate limit that is twice what it says, a lockout an
 * attacker escapes by being routed elsewhere, and an idempotency key that
 * stops being idempotent.
 *
 * `config.shared` is the one place to say it:
 *
 * ```json
 * {
 *   "shared": {
 *     "adapter": "redis",
 *     "url": "redis://127.0.0.1:6379",
 *     "prefix": "henri:",
 *     "onError": "closed"
 *   }
 * }
 * ```
 *
 * `adapter` names a package the application installs -- `redis` resolves
 * `@usehenri/redis` from the application, the way a store adapter and a view
 * engine are resolved -- so nothing here is a dependency of every
 * application. Anything else in the block reaches the driver.
 *
 * The three per-feature keys still work and still win, key by key:
 * `rateLimit.store`, `user.lockout.store` and `api.idempotency.store` name a
 * module of their own for whoever wants one backend for the limiter and
 * another for the keys.
 *
 * ## When the backend is down
 *
 * It will be, at some point, and there is no answer that is right for all
 * three:
 *
 * - the limiter and the lockout follow `onError`. `closed` (the default)
 *   refuses the request with a 503 and a `Retry-After`: a guard that cannot
 *   count is not a guard, and the deployment that would rather stay up says
 *   `open`, which serves the request uncounted and says so in the log.
 * - the idempotency keys are always closed, whatever `onError` says. Serving
 *   a mutating request whose first answer cannot be read is the one failure
 *   the header exists to prevent, so there is no defensible second answer
 *   and no switch pretending there is.
 *
 * Either way it is said out loud: every fallthrough is logged (at most once
 * every ten seconds per feature, so a long outage does not become the log).
 *
 * The session store is not part of this. It goes through the database
 * adapter (`base/session-store.js`), which is already shared by every
 * process, so it was never one of the counters this closes -- see the
 * configuration page.
 */

/** What `shared` looks like when the block leaves a key out */
const DEFAULTS = Object.freeze({
  enabled: true,
  onError: 'closed',
  prefix: 'henri:',
});

/** The failure policies `shared.onError` accepts */
const POLICIES = Object.freeze(['closed', 'open']);

/** How often one feature may report the backend being down (ms) */
const REPORT_EVERY = 10000;

/**
 * The backend did not answer.
 *
 * It carries the 503 the error handler answers (`base/http.js` reads
 * `status` and `retryAfter`), so a guard that cannot count refuses the
 * request instead of failing it with a 500 that says nothing.
 *
 * @class SharedStoreError
 * @extends {Error}
 */
class SharedStoreError extends Error {
  /**
   * Creates an instance of SharedStoreError.
   *
   * @param {string} message what could not be done
   * @param {object} [options={}] options
   * @param {Error} [options.cause] the driver's own error
   * @param {string} [options.feature] which counter was asking
   * @memberof SharedStoreError
   */
  constructor(message, { cause, feature = null } = {}) {
    super(message, { cause });

    this.name = 'SharedStoreError';
    this.code = 'SHARED_STORE_UNAVAILABLE';
    this.feature = feature;
    this.retryAfter = 1;
    this.status = 503;
    this.statusCode = 503;
  }
}

/**
 * Whether an error came from a shared store that could not answer
 *
 * @param {*} error anything thrown
 * @returns {boolean} true when it is one
 */
const unavailable = (error) =>
  Boolean(error) && error.code === 'SHARED_STORE_UNAVAILABLE';

/**
 * Normalizes `config.shared`
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {?object} the settings, or null when no backend is configured
 * @throws {TypeError} when the block is not an object, or names no adapter
 */
function sharedConfig(config) {
  const has =
    Boolean(config) && typeof config.has === 'function' && config.has('shared');
  const raw = has ? config.get('shared') : null;

  if (raw === null || typeof raw === 'undefined' || raw === false) {
    return null;
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(
      'config.shared must be an object ({ adapter, url, prefix, onError })'
    );
  }

  if (raw.enabled === false) {
    return null;
  }

  const adapter = typeof raw.adapter === 'string' ? raw.adapter.trim() : '';

  if (adapter === '') {
    throw new TypeError(
      'config.shared needs an adapter: { "adapter": "redis", "url": "redis://..." }'
    );
  }

  const onError = String(raw.onError || DEFAULTS.onError).toLowerCase();

  if (!POLICIES.includes(onError)) {
    throw new TypeError(
      `config.shared.onError must be one of ${POLICIES.join(', ')}`
    );
  }

  return Object.assign({}, raw, {
    adapter,
    enabled: true,
    onError,
    prefix: typeof raw.prefix === 'string' ? raw.prefix : DEFAULTS.prefix,
  });
}

/**
 * Loads the backend package of an adapter, from the application.
 *
 * A bare name is `@usehenri/<name>` first and the name itself second, so
 * `redis` finds the package henri ships and an application may still bring
 * its own; anything starting with a dot is a path inside the application.
 *
 * @param {string} adapter the adapter name, a module id or a relative path
 * @param {string} cwd the application directory
 * @param {function} resolve `utils.resolveFrom`
 * @returns {function} the backend constructor
 * @throws {Error} when nothing resolves, naming the package to install
 */
function loadBackend(adapter, cwd, resolve) {
  const ids = /^[a-z][a-z0-9-]*$/u.test(adapter)
    ? [`@usehenri/${adapter}`, adapter]
    : [adapter.startsWith('.') ? path.resolve(cwd, adapter) : adapter];

  for (const id of ids) {
    let resolved;

    try {
      resolved = resolve(id, cwd);
    } catch (error) {
      debug('%s does not resolve from %s (%s)', id, cwd, error.code);
      continue;
    }

    const loaded = require(resolved);

    return loaded && loaded.default ? loaded.default : loaded;
  }

  throw new Error(
    `unable to load the shared store adapter '${adapter}': install it with \`npm install @usehenri/${adapter}\``
  );
}

/**
 * The shared store: what the three counters are handed.
 *
 * It owns the backend (one connection for the whole application), hands out
 * the two kinds of store the counters need, and is the one place the failure
 * policy lives, so the limiter, the lockout and the keys cannot disagree
 * about what a down backend means.
 *
 * @class SharedStore
 */
class SharedStore {
  /**
   * Creates an instance of SharedStore.
   *
   * @param {object} backend what the adapter package exported, instantiated
   * @param {object} settings the normalized `config.shared`
   * @param {?Henri} [henri=null] the henri instance (for the log)
   * @memberof SharedStore
   */
  constructor(backend, settings, henri = null) {
    this.backend = backend;
    this.settings = settings;
    this.henri = henri;
    this.onError = settings.onError;
    this.name = backend.name || settings.adapter;
    this.healthy = true;
    this.reported = new Map();
    this.stores = [];
  }

  /**
   * What the backend is talking to, with the password taken out
   *
   * @returns {string} a one-line description
   * @memberof SharedStore
   */
  describe() {
    return typeof this.backend.describe === 'function'
      ? this.backend.describe()
      : this.name;
  }

  /**
   * Opens the connection. A backend that cannot connect does not fail the
   * boot: it keeps retrying, `/readyz` answers 503 until it is up, and the
   * requests meanwhile follow `onError`.
   *
   * @returns {Promise<boolean>} whether the backend answered
   * @memberof SharedStore
   */
  async start() {
    try {
      if (typeof this.backend.start === 'function') {
        await this.backend.start();
      }
      this.healthy = true;

      return true;
    } catch (error) {
      this.healthy = false;
      this.report('start', error);

      return false;
    }
  }

  /**
   * Closes the connection and every store handed out
   *
   * @returns {Promise<boolean>} done
   * @memberof SharedStore
   */
  async stop() {
    for (const store of this.stores.splice(0)) {
      if (typeof store.shutdown === 'function') {
        await store.shutdown();
      }
    }

    if (typeof this.backend.stop === 'function') {
      await this.backend.stop();
    }

    this.reported.clear();

    return true;
  }

  /**
   * Whether the backend answers, for `GET /readyz` and `henri doctor`
   *
   * @returns {Promise<boolean>} true when it answered
   * @throws whatever the backend threw
   * @memberof SharedStore
   */
  async ping() {
    if (typeof this.backend.ping !== 'function') {
      return true;
    }

    const answer = await this.backend.ping();

    this.healthy = true;

    return answer !== false;
  }

  /**
   * Logs a backend failure, at most once every ten seconds per feature: an
   * outage that lasts an hour must not be the only thing in the log
   *
   * @param {string} feature which counter was asking
   * @param {Error} error what the backend threw
   * @param {string} [policy=this.onError] what is being done about it
   * @returns {boolean} whether it was logged this time
   * @memberof SharedStore
   */
  report(feature, error, policy = this.onError) {
    const now = Date.now();
    const last = this.reported.get(feature) || 0;

    debug('%s: %s', feature, error.message);

    if (now - last < REPORT_EVERY) {
      return false;
    }

    this.reported.set(feature, now);

    if (this.henri && this.henri.pen) {
      this.henri.pen.error(
        'shared',
        this.name,
        feature,
        policy === 'open'
          ? `unavailable, serving uncounted: ${error.message}`
          : `unavailable, refusing: ${error.message}`
      );
    }

    return true;
  }

  /**
   * What a failed call does, per the policy of that feature
   *
   * @param {string} feature which counter was asking
   * @param {Error} error what the backend threw
   * @param {*} answer what to return when the policy is to serve anyway
   * @param {string} [policy=this.onError] `open` or `closed`
   * @returns {*} `answer` when open
   * @throws {SharedStoreError} when closed
   * @memberof SharedStore
   */
  fallthrough(feature, error, answer, policy = this.onError) {
    this.healthy = false;
    this.report(feature, error, policy);

    if (policy === 'open') {
      return answer;
    }

    throw new SharedStoreError(
      `the shared store (${this.name}) did not answer`,
      { cause: error, feature }
    );
  }

  /**
   * An express-rate-limit store on the backend, with the policy applied
   *
   * @param {string} feature the limiter name (`global`, `auth`, `lockout`)
   * @returns {object} the store
   * @memberof SharedStore
   */
  rateLimitStore(feature) {
    const store = this.backend.rateLimitStore(feature);
    let windowMs = 60000;

    /**
     * What a window that was never counted looks like
     *
     * @returns {{totalHits: number, resetTime: Date}} no hits
     */
    const uncounted = () => ({
      resetTime: new Date(Date.now() + windowMs),
      totalHits: 0,
    });

    const guarded = {
      /**
       * Forgets a key
       *
       * @param {string} key the key
       * @returns {Promise<void>} done
       */
      decrement: async (key) => {
        try {
          return await store.decrement(key);
        } catch (error) {
          return this.fallthrough(feature, error, undefined);
        }
      },

      /**
       * Reads a counter without touching it.
       *
       * A key that is not there reads as `undefined`, whatever the backend
       * answers for one -- `rate-limit-redis` gives `{ totalHits: NaN }` --
       * because the lockout has to read one answer, not one per backend.
       *
       * @param {string} key the key
       * @returns {Promise<*>} what the store holds, or undefined
       */
      get: async (key) => {
        if (typeof store.get !== 'function') {
          return undefined;
        }

        try {
          const info = await store.get(key);

          return info && Number.isFinite(info.totalHits) ? info : undefined;
        } catch (error) {
          return this.fallthrough(feature, error, undefined);
        }
      },

      /**
       * Counts one hit
       *
       * @param {string} key the key
       * @returns {Promise<{totalHits: number, resetTime: Date}>} the count
       */
      increment: async (key) => {
        try {
          return await store.increment(key);
        } catch (error) {
          return this.fallthrough(feature, error, uncounted());
        }
      },

      /**
       * Passes the limiter's options on, and keeps the window for the
       * answer a fail-open call has to invent
       *
       * @param {object} options the express-rate-limit options
       * @returns {void}
       */
      init: (options) => {
        windowMs = Number(options.windowMs) > 0 ? options.windowMs : windowMs;

        if (typeof store.init === 'function') {
          store.init(options);
        }
      },

      /** Keys of this store reach every process */
      localKeys: false,

      /** What the backend prefixes its keys with */
      prefix: store.prefix,

      /**
       * Clears a key
       *
       * @param {string} key the key
       * @returns {Promise<void>} done
       */
      resetKey: async (key) => {
        try {
          return await store.resetKey(key);
        } catch (error) {
          return this.fallthrough(feature, error, undefined);
        }
      },

      /**
       * Releases whatever the backend store holds
       *
       * @returns {Promise<void>} done
       */
      shutdown: async () => {
        if (typeof store.shutdown === 'function') {
          await store.shutdown();
        }
      },
    };

    this.stores.push(guarded);

    return guarded;
  }

  /**
   * A `{ get, set, add, delete }` store on the backend, with the policy
   * applied. Used by the idempotency keys, which are always fail-closed.
   *
   * @param {string} feature what the keys are for (`idempotency`)
   * @returns {object} the store
   * @memberof SharedStore
   */
  keyValueStore(feature) {
    const store = this.backend.keyValueStore(feature);
    // Never `open`: a mutating request whose first answer cannot be read is
    // exactly what Idempotency-Key exists to prevent
    const policy = 'closed';
    const guarded = {
      /**
       * Writes a value unless the key is taken (atomic)
       *
       * @param {string} key the key
       * @param {*} value anything JSON-serializable
       * @param {number} ttl how long it lives (ms)
       * @returns {Promise<boolean>} true when written
       */
      add: async (key, value, ttl) => {
        try {
          return await store.add(key, value, ttl);
        } catch (error) {
          return this.fallthrough(feature, error, true, policy);
        }
      },

      /**
       * Removes a key
       *
       * @param {string} key the key
       * @returns {Promise<void>} done
       */
      delete: async (key) => {
        try {
          return await store.delete(key);
        } catch (error) {
          return this.fallthrough(feature, error, undefined, policy);
        }
      },

      /**
       * Reads a value
       *
       * @param {string} key the key
       * @returns {Promise<*>} the value, or undefined
       */
      get: async (key) => {
        try {
          return await store.get(key);
        } catch (error) {
          return this.fallthrough(feature, error, undefined, policy);
        }
      },

      /**
       * Writes a value
       *
       * @param {string} key the key
       * @param {*} value anything JSON-serializable
       * @param {number} ttl how long it lives (ms)
       * @returns {Promise<void>} done
       */
      set: async (key, value, ttl) => {
        try {
          return await store.set(key, value, ttl);
        } catch (error) {
          return this.fallthrough(feature, error, undefined, policy);
        }
      },

      /**
       * Releases whatever the backend store holds
       *
       * @returns {Promise<void>} done
       */
      shutdown: async () => {
        if (typeof store.shutdown === 'function') {
          await store.shutdown();
        }
      },
    };

    this.stores.push(guarded);

    return guarded;
  }
}

/**
 * Builds the shared store of an application, or nothing when `config.shared`
 * names no backend
 *
 * @param {Henri} henri the henri instance
 * @returns {?SharedStore} the shared store
 * @throws {Error} when the adapter cannot be loaded or refuses the settings
 */
function createShared(henri) {
  const settings = sharedConfig(henri.config);

  if (!settings) {
    return null;
  }

  const Backend = loadBackend(
    settings.adapter,
    henri.cwd(),
    henri.utils.resolveFrom
  );

  if (typeof Backend !== 'function') {
    throw new Error(
      `the shared store adapter '${settings.adapter}' does not export a constructor`
    );
  }

  const backend = new Backend(settings, henri);

  for (const method of ['keyValueStore', 'rateLimitStore']) {
    if (typeof backend[method] !== 'function') {
      throw new Error(
        `the shared store adapter '${settings.adapter}' has no ${method}()`
      );
    }
  }

  debug('shared store: %s', settings.adapter);

  return new SharedStore(backend, settings, henri);
}

/**
 * Evidence, from the environment alone, that this process is one of
 * several.
 *
 * A warning that fires on every single-process development boot is a warning
 * people learn to skip, so henri only says the counters are split when
 * something in the environment says there is more than one process to split
 * them across. Nothing here is a guess: a cluster worker knows it is one,
 * and the three process managers below number their instances.
 *
 * @param {object} [env=process.env] the environment
 * @param {object} [cluster] node's cluster module
 * @returns {?string} what says so, null when nothing does
 */
function manyProcesses(env = process.env, cluster = require('cluster')) {
  if (cluster && cluster.isWorker) {
    return 'this process is a cluster worker';
  }

  if (Number(env.NODE_APP_INSTANCE) > 0) {
    return `pm2 instance ${env.NODE_APP_INSTANCE}`;
  }

  if (Number(env.WEB_CONCURRENCY) > 1) {
    return `WEB_CONCURRENCY is ${env.WEB_CONCURRENCY}`;
  }

  const dyno = /^[a-z]+\.(\d+)$/iu.exec(String(env.DYNO || ''));

  if (dyno && Number(dyno[1]) > 1) {
    return `dyno ${env.DYNO}`;
  }

  return null;
}

module.exports = {
  DEFAULTS,
  POLICIES,
  REPORT_EVERY,
  SharedStore,
  SharedStoreError,
  createShared,
  loadBackend,
  manyProcesses,
  sharedConfig,
  unavailable,
};
