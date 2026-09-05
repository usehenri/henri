const crypto = require('crypto');
const debug = require('debug')('henri:idempotency');

/**
 * Idempotent requests (Stripe semantics).
 *
 * A mutating request (POST, PUT, PATCH, DELETE) carrying an
 * `Idempotency-Key` header is executed once: the first answer (status, a
 * subset of the headers and the body) is stored for
 * `config.api.idempotency.ttl` (24h by default) and replayed to any request
 * reusing the key, with `Idempotency-Replayed: true`. Keys are scoped to the
 * user (the session, or the ip for anonymous requests) and tied to a
 * fingerprint of the method, url and body:
 *
 * | situation                                    | answer                          |
 * | -------------------------------------------- | ------------------------------- |
 * | first request                                | executed, stored                |
 * | same key, same fingerprint, done             | stored answer, replayed         |
 * | same key, same fingerprint, still running    | 409 Conflict                    |
 * | same key, different method, url or body      | 422 Unprocessable Entity        |
 * | first request failed with a 5xx (or aborted) | forgotten: the client may retry |
 * | key longer than 255 characters or not ascii  | 400 Bad Request                 |
 *
 * The store is `henri.api.idempotencyStore` (`{ get, set, delete }`, plus
 * an optional atomic `add`); the default keeps the entries in memory.
 */
const HEADER = 'Idempotency-Key';
const REPLAYED = 'Idempotency-Replayed';
const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_FORMAT = /^[\x21-\x7E]{1,255}$/;
const REPLAYED_HEADERS = [
  'content-type',
  'content-location',
  'location',
  'link',
  'x-total-count',
];
const DAY = 24 * 60 * 60 * 1000;

/**
 * In-memory store with a TTL (one process only: plug a shared store in
 * production, see `henri.api.idempotencyStore`)
 *
 * @class MemoryStore
 */
class MemoryStore {
  /**
   * Creates an instance of MemoryStore.
   *
   * @param {object} [options={}] options
   * @param {function(): number} [options.now=Date.now] clock (replaceable in tests)
   * @param {number} [options.sweepEvery=60000] expired entries sweep interval (ms)
   * @memberof MemoryStore
   */
  constructor({ now = Date.now, sweepEvery = 60000 } = {}) {
    this.entries = new Map();
    this.now = now;
    this.timer = setInterval(() => this.sweep(), sweepEvery);
    this.timer.unref();
  }

  /**
   * Reads an entry (expired entries are gone)
   *
   * @param {string} key the key
   * @returns {Promise<*>} the value or undefined
   * @memberof MemoryStore
   */
  async get(key) {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expires <= this.now()) {
      this.entries.delete(key);

      return undefined;
    }

    return entry.value;
  }

  /**
   * Writes an entry
   *
   * @param {string} key the key
   * @param {*} value the value
   * @param {number} ttl time to live (ms)
   * @returns {Promise<void>} done
   * @memberof MemoryStore
   */
  async set(key, value, ttl) {
    this.entries.set(key, { expires: this.now() + ttl, value });
  }

  /**
   * Writes an entry unless one exists (atomic set-if-absent)
   *
   * @param {string} key the key
   * @param {*} value the value
   * @param {number} ttl time to live (ms)
   * @returns {Promise<boolean>} true when written
   * @memberof MemoryStore
   */
  async add(key, value, ttl) {
    if (typeof (await this.get(key)) !== 'undefined') {
      return false;
    }

    await this.set(key, value, ttl);

    return true;
  }

  /**
   * Removes an entry
   *
   * @param {string} key the key
   * @returns {Promise<void>} done
   * @memberof MemoryStore
   */
  async delete(key) {
    this.entries.delete(key);
  }

  /**
   * Removes the expired entries
   *
   * @returns {number} how many were removed
   * @memberof MemoryStore
   */
  sweep() {
    const now = this.now();
    let removed = 0;

    for (const [key, entry] of this.entries) {
      if (entry.expires <= now) {
        this.entries.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Number of entries (expired ones included until the next sweep)
   *
   * @returns {number} the size
   * @memberof MemoryStore
   */
  get size() {
    return this.entries.size;
  }

  /**
   * Forgets everything
   *
   * @returns {void}
   * @memberof MemoryStore
   */
  clear() {
    this.entries.clear();
  }

  /**
   * Stops the sweep timer
   *
   * @returns {void}
   * @memberof MemoryStore
   */
  shutdown() {
    clearInterval(this.timer);
  }
}

/**
 * JSON with the object keys sorted, so equal bodies hash the same
 *
 * @param {*} value anything JSON-serializable
 * @returns {string} the JSON
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    if (typeof value.toJSON === 'function') {
      return stableStringify(value.toJSON());
    }

    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return typeof value === 'undefined' ? 'null' : JSON.stringify(value);
}

/**
 * A sha256 hex digest
 *
 * @param {string} text the text
 * @returns {string} the digest
 */
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * The fingerprint of a request: method, url and body
 *
 * @param {Express.Request} req the request
 * @returns {string} a sha256 digest
 */
function fingerprint(req) {
  return sha256(
    `${req.method} ${req.originalUrl || req.url}\n${stableStringify(req.body || {})}`
  );
}

/**
 * Whom a key belongs to: the user, else the session, else the ip
 *
 * @param {Express.Request} req the request
 * @param {string} [sessionCookie='henri.sid'] name of the session cookie
 * @returns {string} the scope
 */
function scopeOf(req, sessionCookie = 'henri.sid') {
  const { user } = req;
  const id =
    user &&
    (typeof user.id !== 'undefined' && user.id !== null ? user.id : user._id);

  if (id !== null && typeof id !== 'undefined') {
    return `user:${String(id)}`;
  }

  if (req.cookies && req.cookies[sessionCookie] && req.sessionID) {
    return `session:${req.sessionID}`;
  }

  return `ip:${req.ip || 'unknown'}`;
}

/**
 * The stored headers of a response
 *
 * @param {Express.Response} res the response
 * @returns {object} headers by lowercased name
 */
function replayableHeaders(res) {
  const headers = {};

  for (const name of REPLAYED_HEADERS) {
    const value = res.getHeader(name);

    if (typeof value !== 'undefined') {
      headers[name] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  return headers;
}

/**
 * A chunk written to a response, as a Buffer
 *
 * @param {*} chunk the chunk
 * @param {*} encoding the encoding given to write/end, if any
 * @returns {?Buffer} the buffer or null
 */
function toBuffer(chunk, encoding) {
  if (
    chunk === null ||
    typeof chunk === 'undefined' ||
    typeof chunk === 'function'
  ) {
    return null;
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  return Buffer.from(
    String(chunk),
    typeof encoding === 'string' ? encoding : 'utf8'
  );
}

/**
 * Per-route middleware
 *
 * @param {Henri} henri the henri instance (`henri.api.idempotencyStore` is
 *   resolved on every request, so it can be replaced after boot)
 * @param {object} [options={}] options
 * @param {number} [options.ttl=86400000] how long an answer is kept (ms)
 * @param {string} [options.sessionCookie='henri.sid'] name of the session cookie
 * @returns {function} middleware
 */
function idempotency(henri, { ttl = DAY, sessionCookie = 'henri.sid' } = {}) {
  return async (req, res, next) => {
    if (!METHODS.has(req.method)) {
      return next();
    }

    const key = req.get(HEADER);

    if (typeof key !== 'string' || key.length === 0) {
      return next();
    }

    if (!KEY_FORMAT.test(key)) {
      return res.boom.badRequest(
        `${HEADER} must be 1 to 255 printable ascii characters`
      );
    }

    const store = henri.api.idempotencyStore;
    const scope = scopeOf(req, sessionCookie);
    const storeKey = `idempotency:${sha256(`${scope}\n${key}`)}`;
    const digest = fingerprint(req);

    try {
      const entry = await store.get(storeKey);

      if (entry) {
        if (entry.fingerprint !== digest) {
          debug('%s reused with another request (%s)', key, scope);

          return res.boom.badData(
            `${HEADER} was already used for a different request`,
            { key }
          );
        }

        if (entry.state === 'pending') {
          debug('%s is still running (%s)', key, scope);
          res.set('Retry-After', '1');

          return res.boom.conflict(
            `A request with this ${HEADER} is still in progress`,
            { key }
          );
        }

        debug('%s replayed (%s)', key, scope);

        for (const name of Object.keys(entry.headers || {})) {
          res.set(name, entry.headers[name]);
        }

        res.set(HEADER, key);
        res.set(REPLAYED, 'true');
        res.status(entry.status);

        return res.send(entry.body ? Buffer.from(entry.body, 'base64') : '');
      }

      const pending = {
        fingerprint: digest,
        startedAt: Date.now(),
        state: 'pending',
      };
      const claimed =
        typeof store.add === 'function'
          ? await store.add(storeKey, pending, ttl)
          : await store.set(storeKey, pending, ttl).then(() => true);

      if (claimed === false) {
        res.set('Retry-After', '1');

        return res.boom.conflict(
          `A request with this ${HEADER} is still in progress`,
          { key }
        );
      }
    } catch (error) {
      return next(error);
    }

    const chunks = [];
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    const forget = () =>
      Promise.resolve(store.delete(storeKey)).catch((error) =>
        debug('unable to forget %s: %s', key, error)
      );

    res.set(HEADER, key);

    res.write = (chunk, ...args) => {
      const buffer = toBuffer(chunk, args[0]);

      if (buffer) {
        chunks.push(buffer);
      }

      return write(chunk, ...args);
    };

    res.end = (chunk, ...args) => {
      const buffer = toBuffer(chunk, args[0]);

      if (buffer) {
        chunks.push(buffer);
      }

      return end(chunk, ...args);
    };

    res.on('finish', () => {
      if (res.statusCode >= 500) {
        debug('%s failed with %d, forgotten', key, res.statusCode);

        return forget();
      }

      return Promise.resolve(
        store.set(
          storeKey,
          {
            body: Buffer.concat(chunks).toString('base64'),
            fingerprint: digest,
            headers: replayableHeaders(res),
            state: 'done',
            status: res.statusCode,
            storedAt: Date.now(),
          },
          ttl
        )
      ).catch((error) => debug('unable to store %s: %s', key, error));
    });

    res.on('close', () => {
      if (!res.writableFinished) {
        debug('%s aborted, forgotten', key);
        forget();
      }
    });

    return next();
  };
}

module.exports = {
  DAY,
  HEADER,
  KEY_FORMAT,
  METHODS,
  MemoryStore,
  REPLAYED,
  fingerprint,
  idempotency,
  scopeOf,
  stableStringify,
};
