const session = require('express-session');
const debug = require('debug')('henri:session');

/**
 * Session store (express-session) delegating to the store of the current
 * database adapter.
 *
 * express-session keeps a reference to one store for the life of the
 * process, but henri rebuilds its adapters (and their session stores) on
 * every model reload. This proxy is handed to express-session once and
 * resolves the real store lazily: when the adapter that owns the user model
 * changes, the next call asks the new adapter for its store.
 *
 * `owner()` returns the current adapter (or null while models are reloading)
 * and `create(adapter)` returns (a promise of) the adapter's store.
 *
 * @class SessionStoreProxy
 * @extends {session.Store}
 */
class SessionStoreProxy extends session.Store {
  /**
   * Creates an instance of SessionStoreProxy.
   *
   * @param {object} options options
   * @param {function(): ?object} options.owner returns the current adapter
   * @param {function(object): (object|Promise<object>)} options.create builds the store of an adapter
   * @memberof SessionStoreProxy
   */
  constructor({ owner, create } = {}) {
    super();

    if (typeof owner !== 'function' || typeof create !== 'function') {
      throw new TypeError(
        'SessionStoreProxy needs owner() and create(adapter) functions'
      );
    }

    this.owner = owner;
    this.create = create;
    this.current = null;
    this.pending = null;
    this.closed = false;
  }

  /**
   * Resolves the store of the current adapter, building it when needed
   *
   * @returns {Promise<object>} the store
   * @memberof SessionStoreProxy
   */
  async resolve() {
    if (this.closed) {
      throw new Error('the session store is closed');
    }

    const owner = this.owner();

    if (!owner) {
      throw new Error(
        'no session store available: the models are not loaded (reloading?)'
      );
    }

    if (this.current && this.current.owner === owner) {
      return this.current.store;
    }

    if (this.pending && this.pending.owner === owner) {
      return this.pending.promise;
    }

    debug('resolving the session store of a new adapter');

    const promise = Promise.resolve()
      .then(() => this.create(owner))
      .then(
        (store) => {
          if (!store || typeof store.get !== 'function') {
            throw new Error('the adapter did not return a session store');
          }
          this.current = { owner, store };
          if (this.pending && this.pending.promise === promise) {
            this.pending = null;
          }

          return store;
        },
        (error) => {
          if (this.pending && this.pending.promise === promise) {
            this.pending = null;
          }
          throw error;
        }
      );

    this.pending = { owner, promise };

    return promise;
  }

  /**
   * Calls a method of the current store
   *
   * @param {string} method store method name
   * @param {Array} args arguments before the callback
   * @param {function} callback node style callback
   * @returns {void}
   * @memberof SessionStoreProxy
   */
  delegate(method, args, callback) {
    const done = typeof callback === 'function' ? callback : () => {};

    this.resolve().then(
      (store) => {
        if (typeof store[method] !== 'function') {
          return done();
        }

        return store[method](...args, done);
      },
      (error) => done(error)
    );
  }

  /**
   * The store currently in use (null before the first request)
   *
   * @returns {?object} the store
   * @memberof SessionStoreProxy
   */
  store() {
    return this.current ? this.current.store : null;
  }

  /**
   * Fetch a session
   *
   * @param {string} sid session id
   * @param {function} callback callback
   * @returns {void}
   * @memberof SessionStoreProxy
   */
  get(sid, callback) {
    this.delegate('get', [sid], callback);
  }

  /**
   * Save a session
   *
   * @param {string} sid session id
   * @param {object} data session data
   * @param {function} callback callback
   * @returns {void}
   * @memberof SessionStoreProxy
   */
  set(sid, data, callback) {
    this.delegate('set', [sid, data], callback);
  }

  /**
   * Delete a session
   *
   * @param {string} sid session id
   * @param {function} callback callback
   * @returns {void}
   * @memberof SessionStoreProxy
   */
  destroy(sid, callback) {
    this.delegate('destroy', [sid], callback);
  }

  /**
   * Refresh the expiration of a session
   *
   * @param {string} sid session id
   * @param {object} data session data
   * @param {function} callback callback
   * @returns {void}
   * @memberof SessionStoreProxy
   */
  touch(sid, data, callback) {
    this.delegate('touch', [sid, data], callback);
  }

  /**
   * All sessions (when the store supports it)
   *
   * @param {function} callback callback
   * @returns {void}
   * @memberof SessionStoreProxy
   */
  all(callback) {
    this.delegate('all', [], callback);
  }

  /**
   * Delete all sessions (when the store supports it)
   *
   * @param {function} callback callback
   * @returns {void}
   * @memberof SessionStoreProxy
   */
  clear(callback) {
    this.delegate('clear', [], callback);
  }

  /**
   * Number of sessions (when the store supports it)
   *
   * @param {function} callback callback
   * @returns {void}
   * @memberof SessionStoreProxy
   */
  length(callback) {
    this.delegate('length', [], callback);
  }

  /**
   * Detaches from the current store. The adapter that created the store
   * closes it (in its own stop()); this only stops timers the store owns.
   *
   * @returns {Promise<boolean>} done
   * @memberof SessionStoreProxy
   */
  async close() {
    const store = this.store();

    this.closed = true;
    this.current = null;
    this.pending = null;

    if (store && typeof store.stopExpiringSessions === 'function') {
      store.stopExpiringSessions();
    }

    return true;
  }
}

module.exports = SessionStoreProxy;
