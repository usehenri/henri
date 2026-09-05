const { count, eq, lte } = require('drizzle-orm');
const debug = require('debug')('henri:drizzle:session');

const ONE_DAY = 24 * 60 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * The fields of the sessions table, in the henri model format (compiled by
 * the adapter with the other tables so migrations include it)
 */
const SESSION_FIELDS = {
  expiresAt: { index: true, required: true, type: 'date' },
  sess: { required: true, type: 'json' },
  sid: { primaryKey: true, type: 'string' },
};

/**
 * Runs an async operation and answers through a node callback
 *
 * @param {function} fn The operation
 * @param {function} [callback] The callback
 * @returns {void}
 */
const answer = (fn, callback) => {
  const done = typeof callback === 'function' ? callback : () => {};

  Promise.resolve()
    .then(fn)
    .then(
      (result) => done(null, result),
      (error) => {
        debug('session store error: %s', error.message);
        done(error);
      }
    );
};

/**
 * Builds the express-session store class on a session module
 *
 * @param {(function|object)} session express-session (or its Store class)
 * @returns {function} The store class
 */
const createStore = (session) => {
  const Store = session.Store || session;

  /**
   * The express-session store on the `henri_sessions` table
   *
   * Sessions expire with their cookie (`cookie.expires`, else
   * `cookie.maxAge`, else `expiration`); expired rows are ignored on read
   * and swept every `checkExpirationInterval` ms.
   *
   * @class DrizzleSessionStore
   * @extends {Store}
   */
  class DrizzleSessionStore extends Store {
    /**
     * Creates an instance of DrizzleSessionStore.
     *
     * @param {object} adapter The Drizzle adapter (started)
     * @param {object} [options={}] `expiration` (ms, default one day),
     *   `checkExpirationInterval` (ms, default 15 minutes, 0 disables)
     * @memberof DrizzleSessionStore
     */
    constructor(adapter, options = {}) {
      super(options);
      this.adapter = adapter;
      this.expiration = options.expiration || ONE_DAY;
      this.interval =
        typeof options.checkExpirationInterval === 'number'
          ? options.checkExpirationInterval
          : FIFTEEN_MINUTES;
      this.timer = null;
      this.startExpiringSessions();
    }

    /**
     * The sessions table
     *
     * @readonly
     * @returns {object} The Drizzle table
     * @memberof DrizzleSessionStore
     */
    get table() {
      return this.adapter.sessionTable;
    }

    /**
     * The database (or the active transaction)
     *
     * @returns {object} A Drizzle database
     * @memberof DrizzleSessionStore
     */
    db() {
      return this.adapter.database();
    }

    /**
     * Runs an async operation and answers through a node callback
     *
     * @param {function} fn The operation
     * @param {function} [callback] The callback
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    run(fn, callback) {
      answer(() => fn.call(this), callback);
    }

    /**
     * When a session expires
     *
     * @param {object} sess The session
     * @returns {Date} The expiry
     * @memberof DrizzleSessionStore
     */
    expiresOf(sess) {
      const cookie = (sess && sess.cookie) || {};

      if (cookie.expires) {
        return new Date(cookie.expires);
      }

      return new Date(
        Date.now() +
          (typeof cookie.maxAge === 'number' ? cookie.maxAge : this.expiration)
      );
    }

    /**
     * Reads a session
     *
     * @param {string} sid The session id
     * @param {function} callback `(error, session)`
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    get(sid, callback) {
      this.run(async () => {
        const { table } = this;
        const rows = await this.db()
          .select()
          .from(table)
          .where(eq(table.sid, sid));
        const row = rows[0];

        if (!row) {
          return undefined;
        }

        if (new Date(row.expiresAt).getTime() <= Date.now()) {
          await this.db().delete(table).where(eq(table.sid, sid));

          return undefined;
        }

        return typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess;
      }, callback);
    }

    /**
     * Writes a session
     *
     * @param {string} sid The session id
     * @param {object} sess The session
     * @param {function} [callback] `(error)`
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    set(sid, sess, callback) {
      this.run(async () => {
        const { table } = this;
        const expiresAt = this.expiresOf(sess);

        await this.adapter.dialect.upsert(
          this.db(),
          table,
          { expiresAt, sess, sid },
          table.sid,
          { expiresAt, sess }
        );
      }, callback);
    }

    /**
     * Deletes a session
     *
     * @param {string} sid The session id
     * @param {function} [callback] `(error)`
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    destroy(sid, callback) {
      this.run(async () => {
        const { table } = this;

        await this.db().delete(table).where(eq(table.sid, sid));
      }, callback);
    }

    /**
     * Refreshes the expiry of a session
     *
     * @param {string} sid The session id
     * @param {object} sess The session
     * @param {function} [callback] `(error)`
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    touch(sid, sess, callback) {
      this.run(async () => {
        const { table } = this;

        await this.db()
          .update(table)
          .set({ expiresAt: this.expiresOf(sess) })
          .where(eq(table.sid, sid));
      }, callback);
    }

    /**
     * Every live session
     *
     * @param {function} callback `(error, sessions)`
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    all(callback) {
      this.run(async () => {
        const rows = await this.db().select().from(this.table);
        const now = Date.now();

        return Object.fromEntries(
          rows
            .filter((row) => new Date(row.expiresAt).getTime() > now)
            .map((row) => [
              row.sid,
              typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess,
            ])
        );
      }, callback);
    }

    /**
     * Deletes every session
     *
     * @param {function} [callback] `(error)`
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    clear(callback) {
      this.run(async () => {
        await this.db().delete(this.table);
      }, callback);
    }

    /**
     * Counts the sessions
     *
     * @param {function} callback `(error, count)`
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    length(callback) {
      this.run(async () => {
        const rows = await this.db()
          .select({ total: count() })
          .from(this.table);

        return Number(rows[0] ? rows[0].total : 0);
      }, callback);
    }

    /**
     * Deletes the expired sessions
     *
     * @param {function} [callback] `(error, count)`
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    clearExpiredSessions(callback) {
      this.run(async () => {
        const { table } = this;
        const result = await this.db()
          .delete(table)
          .where(lte(table.expiresAt, new Date()));

        return this.adapter.dialect.affected(result);
      }, callback);
    }

    /**
     * Sweeps the expired sessions on an interval
     *
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    startExpiringSessions() {
      this.stopExpiringSessions();

      if (this.interval > 0) {
        this.timer = setInterval(
          () => this.clearExpiredSessions(),
          this.interval
        );
        this.timer.unref();
      }
    }

    /**
     * Stops the sweep (called when the adapter stops)
     *
     * @returns {void}
     * @memberof DrizzleSessionStore
     */
    stopExpiringSessions() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  }

  return DrizzleSessionStore;
};

module.exports = { SESSION_FIELDS, createStore };
