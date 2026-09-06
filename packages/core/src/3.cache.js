const BaseModule = require('./base/module');

const debug = require('debug')('henri:cache');

const { Cache, cacheConfig, createCache } = require('./base/cache');
const { manyProcesses } = require('./base/shared');

/**
 * The cache module: `henri.cache`.
 *
 * Everything the cache is -- what a key becomes, what a value may be, what
 * `fetch` does about a stampede, what a backend that is down means -- is in
 * `base/cache.js`, and its header is the document. This is the module
 * around it: where it sits in the boot, which backend it ends up on, what
 * the boot line says and what a reload does.
 *
 * It runs after the server, because that is where `config.shared` becomes
 * `henri.shared` (runlevel 2), and before the router, so a route or a
 * controller loaded above it finds `henri.cache` already there. Every
 * command that boots past runlevel 3 has it: a request, a console, a
 * worker and `henri jobs` alike.
 *
 * A reload drops the memory cache, and only the memory cache: the code that
 * computed those values has just changed under them. It never clears a
 * shared backend -- the other processes did not reload, and their cache is
 * not this process's to empty.
 *
 * @class CacheModule
 * @extends {BaseModule}
 */
class CacheModule extends BaseModule {
  /**
   * Creates an instance of CacheModule.
   * @memberof CacheModule
   */
  constructor() {
    super();

    this.name = 'cache';
    this.runlevel = 3;
    this.needs = ['config'];
    // `henri.shared` is built by the server module, at runlevel 2
    this.after = ['server'];
    this.before = ['router'];
    this.reloadable = true;
    this.henri = null;

    /** The cache itself, until init() there is none */
    this.cache = null;
    /** `config.cache`, normalized */
    this.settings = null;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
    this.fetch = this.fetch.bind(this);
    this.get = this.get.bind(this);
    this.set = this.set.bind(this);
    this.delete = this.delete.bind(this);
    this.clear = this.clear.bind(this);
    this.scope = this.scope.bind(this);
    this.stats = this.stats.bind(this);
  }

  /**
   * Module initialization
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof CacheModule
   */
  async init() {
    const { pen } = this.henri;

    this.settings = cacheConfig(this.henri.config);
    this.cache = new Cache({
      henri: this.henri,
      settings: this.settings,
      store: createCache(this.henri, this.settings),
    });

    if (!this.settings.enabled) {
      pen.info('cache', 'disabled', 'every fetch runs its function');

      return this.name;
    }

    pen.info('cache', this.cache.name, this.cache.describe());
    this.warnUnshared();
    this.instrument();
    debug('%s: %o', this.cache.name, this.settings);

    return this.name;
  }

  /**
   * The one metric a cache is worth having: the hit rate.
   *
   * An **observable** counter, so nothing is recorded while a request runs:
   * the callback reads the counters `stats()` already keeps and the
   * pipeline asks for them when it collects. The rate itself is not a
   * metric -- hits over hits plus misses is computed where it is read, and
   * a rate henri averaged would be an average of averages.
   *
   * @returns {boolean} whether the instrument was registered
   * @memberof CacheModule
   */
  instrument() {
    const { telemetry } = this.henri;

    if (!telemetry || !telemetry.enabled) {
      return false;
    }

    return telemetry.observe(
      'henri.cache.operations',
      {
        description: 'What the cache has been asked for, by outcome',
        kind: 'counter',
        unit: '{operation}',
      },
      (observe) => {
        const found = this.stats();

        for (const outcome of ['errors', 'hits', 'misses', 'writes']) {
          observe(found[outcome] || 0, { 'henri.cache.outcome': outcome });
        }
      }
    );
  }

  /**
   * Warns when the cache is this process's memory and the environment says
   * this process is one of several.
   *
   * Not because a per-process cache is wrong -- it is a perfectly good
   * cache, and every process warms its own -- but because `delete` then
   * reaches one of them. An application that invalidates a key expects the
   * next request to see it gone, whichever process answers it.
   *
   * @returns {boolean} whether it warned
   * @memberof CacheModule
   */
  warnUnshared() {
    const { pen } = this.henri;

    if (this.cache.name !== 'memory') {
      return false;
    }

    const evidence = manyProcesses();

    if (!evidence) {
      return false;
    }

    pen.warn(
      'cache',
      `${evidence}, and the cache is in this process only`,
      'henri.cache.delete() then reaches this process alone: name a backend once with config.shared ({ "adapter": "redis", "url": "..." })'
    );

    return true;
  }

  /**
   * The cached value, or the one the function answers -- kept for next
   * time, and computed once however many callers missed it at once.
   *
   * @param {*} key what to key on
   * @param {(object|function)} [options={}] `ttl`, `force`, or the function
   * @param {function} [fn] what to run on a miss
   * @returns {Promise<*>} the value
   * @memberof CacheModule
   */
  fetch(key, options = {}, fn = null) {
    return this.cache.fetch(key, options, fn);
  }

  /**
   * Reads a key
   *
   * @param {*} key what to key on
   * @returns {Promise<*>} the value, or `undefined` when there is none
   * @memberof CacheModule
   */
  get(key) {
    return this.cache.get(key);
  }

  /**
   * Writes a key
   *
   * @param {*} key what to key on
   * @param {*} value what to keep (JSON, plus Date)
   * @param {object} [options={}] `ttl`
   * @returns {Promise<boolean>} whether it was written
   * @memberof CacheModule
   */
  set(key, value, options = {}) {
    return this.cache.set(key, value, options);
  }

  /**
   * Forgets a key
   *
   * @param {*} key what to key on
   * @returns {Promise<boolean>} whether the backend answered
   * @memberof CacheModule
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Forgets everything in the cache
   *
   * @returns {Promise<number>} how many keys were removed
   * @memberof CacheModule
   */
  clear() {
    return this.cache.clear();
  }

  /**
   * A cache whose keys all start with a name of their own
   *
   * @param {string} name the scope name
   * @returns {Cache} the scoped cache
   * @memberof CacheModule
   */
  scope(name) {
    return this.cache.scope(name);
  }

  /**
   * Hits, misses, writes, errors, and what the memory backend holds
   *
   * @returns {object} the counters
   * @memberof CacheModule
   */
  stats() {
    return this.cache.stats();
  }

  /**
   * Drops what this process cached, on a reload only
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @memberof CacheModule
   */
  async reload() {
    if (this.cache && this.cache.name === 'memory') {
      await this.cache.clear();
    }

    return this.name;
  }

  /**
   * Releases the backend and the timers
   *
   * @async
   * @returns {Promise<boolean>} done
   * @memberof CacheModule
   */
  async stop() {
    if (this.cache) {
      await this.cache.stop();
    }

    return true;
  }
}

module.exports = CacheModule;
