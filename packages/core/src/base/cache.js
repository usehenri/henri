const crypto = require('crypto');
const debug = require('debug')('henri:cache');

const { MASK, filterParameters, isFiltered } = require('./redact');
const { REPORT_EVERY } = require('./shared');
const { fail } = require('./errors');

/**
 * `henri.cache`: keys, values, a TTL, and `fetch`.
 *
 * ```js
 * const board = await henri.cache.fetch(['leaderboard', event.externalId],
 *   { ttl: '30s' },
 *   () => Score.top(event)
 * );
 * ```
 *
 * `get`, `set`, `delete` and `clear` are the store; `fetch` is the reason
 * there is one. Everything else here follows from three facts: the value
 * crosses a serialization edge, the backend can be down, and a cache holds
 * a copy of something that is true somewhere else.
 *
 * ## Where it is kept
 *
 * Two backends, and the application picks neither of them twice. Without
 * `config.shared` the cache is this process's memory, bounded (below).
 * With it -- the same block that already names where the rate limit, the
 * sign-in lockout and the idempotency keys are counted -- the cache is
 * there too, in a key space of its own (`<prefix>kv:cache:`), with nothing
 * else to configure. `config.cache.store` still names a module of its own
 * for whoever wants the cache somewhere the counters are not.
 *
 * ## The stampede
 *
 * A key that expires under load is missed by every request at once, and a
 * `fetch` that answered "not there, so run it" a hundred times would run
 * the expensive thing a hundred times -- at the worst possible moment.
 * henri keeps one promise per key while the function runs and hands it to
 * everyone who missed it: **a hundred concurrent misses of one key in one
 * process run the function once**. Across processes the bound is the
 * number of processes, and that is deliberate. Making it one everywhere
 * needs a lock in the backend, which means a lease, which means guessing
 * how long the function may take: guess short and it runs twice anyway,
 * guess long and one crashed process blocks every reader of that key until
 * the lease expires. The single flight above costs nothing, never blocks a
 * reader and holds when the backend is down; the lock is what an
 * application writes for the one key that needs it, over `set` and
 * `delete`.
 *
 * `fetch` caches what the function returned, including `null`: "there is
 * no such record" is an answer worth keeping and the reason a cache is
 * asked for it again a millisecond later. It caches nothing when the
 * function throws -- an error is not an answer -- and the rejection
 * reaches every caller that was waiting on it. The callers that shared one
 * flight also share the object it answered with, the way they would share
 * the return value of any function they all called; a later hit is decoded
 * again and is nobody else's.
 *
 * ## What may be stored
 *
 * A value is JSON, plus `Date`, and that is the whole list: `null`,
 * booleans, finite numbers, strings, arrays, plain objects and `Date`,
 * nested however deep. A `Date` comes back a `Date` (it is written as
 * `{"$date":"..."}`, and an object of yours holding a `$date` key is
 * escaped so it comes back yours).
 *
 * Everything else is refused, loudly, at `set` -- never stored to come
 * back wrong:
 *
 * - **a model instance** (and every other class instance): it would come
 *   back a plain object, with none of its methods, and it may be carrying
 *   fields nobody meant to write down. Store what you want back:
 *   `record.toJSON()`, or `henri.model.stores.default.toPlain(record)`.
 * - **`undefined`**: it is what a miss answers, so a stored `undefined`
 *   would be a hit nothing can tell from a miss. Cache `null` for "there
 *   is nothing". As the value of an object's key it is dropped rather than
 *   refused, exactly as `JSON.stringify` and `res.json()` drop it; as an
 *   array element, where JSON silently turns it into `null`, it is
 *   refused.
 * - **`NaN` and `Infinity`** (JSON writes them `null`), a `Map`, a `Set`,
 *   a `Buffer`, a `RegExp`, a function, a symbol, a bigint, and anything
 *   circular.
 *
 * The refusal names the path (`the value.user.createdAt`) and the type,
 * never the value.
 *
 * ## When the backend is down
 *
 * **A miss. Always, whatever `config.shared.onError` says.** The three
 * counters that block share a backend with the cache and follow that
 * switch because a guard that cannot count is not a guard; a cache is the
 * opposite kind of thing. It holds no truth -- everything in it is a copy
 * of something the application can compute again -- so refusing a request
 * because a copy is unavailable would turn an optimization into an outage.
 * A read that fails is a miss, a write that fails is a `false` from `set`
 * and a `fetch` that ran the function and could not keep the answer, and
 * every one of them is logged at most once every ten seconds, the way the
 * counters' fallthroughs are.
 *
 * ## What henri does not do
 *
 * **It does not invalidate anything.** Nothing here watches a model, a
 * query or a route: a value stays until its TTL runs out or something
 * calls `delete`. That is the whole of the policy, on purpose -- a
 * framework that guesses when your data changed is wrong in a way you find
 * out about in production. Two consequences worth writing on the wall:
 * every entry has a TTL (there is no way to say "forever", and no default
 * that means it), and with the memory backend a `delete` reaches this
 * process only, which is why a deployment that runs several of them and
 * deletes keys wants `config.shared`.
 *
 * ## Bounds, and what is in the log
 *
 * The key is at most 250 characters -- a longer one is replaced by its
 * first 209 and a digest of the whole, deterministically, so two callers
 * of one long key still meet. The value is at most `maxEntrySize` (256kb)
 * encoded, on any backend: a bigger one is not stored, `set` answers
 * `false`, it is reported, and whatever was under that key is forgotten --
 * a value the caller has just replaced is not left to be served in place of
 * the one that could not be written. The memory backend holds at most
 * `maxEntries` (1000) entries and `maxSize` (32mb) of encoded bytes, and
 * evicts the least recently used to stay under both, so a cache cannot
 * become a leak.
 *
 * Values never reach a log line, an error message or a `debug` line: the
 * cache is handed whatever the application had, which is why the only
 * thing said about a value is its type. Keys do get logged, and a key is
 * often built out of what a request carried, so a key matching
 * `config.filterParameters` (`password-reset:<token>`) is printed
 * `[FILTERED]`, exactly as the same word is masked in a body.
 *
 * @module base/cache
 */

/** What `config.cache` looks like when the block leaves a key out */
const DEFAULTS = Object.freeze({
  enabled: true,
  maxEntries: 1000,
  maxEntrySize: 256 * 1024,
  maxSize: 32 * 1024 * 1024,
  store: null,
  ttl: 5 * 60 * 1000,
});

/** The longest key that reaches a backend */
const MAX_KEY_LENGTH = 250;

/** How many hex characters of the digest a shortened key ends with */
const DIGEST_LENGTH = 40;

/** How often the memory backend drops what has expired (ms) */
const SWEEP_EVERY = 60000;

/** How a `Date` is written down, and how an object holding that key is */
const DATE_TAG = '$date';
const ESCAPE_TAG = '$esc';

/** Multipliers of the units a duration accepts (no unit is milliseconds) */
const DURATION_UNITS = new Map([
  ['ms', 1],
  ['s', 1000],
  ['m', 60000],
  ['h', 3600000],
  ['d', 86400000],
  ['w', 604800000],
]);

/** Multipliers of the units a size accepts (no unit is bytes) */
const SIZE_UNITS = new Map([
  ['b', 1],
  ['kb', 1024],
  ['mb', 1024 * 1024],
  ['gb', 1024 * 1024 * 1024],
]);

/**
 * An amount, then a unit. The surrounding whitespace is trimmed before
 * these run rather than matched by them: `^\s*…\s*$` around an optional
 * group is quadratic on a long run of spaces.
 */
const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|[smhdw])?$/iu;
const SIZE = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/iu;

/** Characters a key may not hold: they would break the line it is logged on */
// eslint-disable-next-line no-control-regex -- refusing them is the point
const CONTROL = /[\u0000-\u001f\u007f]/u;

/**
 * Own property, without going through a prototype that may lie
 *
 * @param {object} value the object
 * @param {string} key the key
 * @returns {boolean} whether it is an own property
 */
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/**
 * Whether this is an object literal rather than an instance of something
 *
 * @param {object} value an object
 * @returns {boolean} true for `{}` and `Object.create(null)`
 */
const isPlain = (value) => {
  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
};

/**
 * A duration in milliseconds (`'30s'`, `'5m'`, `250`)
 *
 * @param {*} value what was written
 * @param {?number} [fallback=null] what an unreadable value answers
 * @returns {?number} the duration, or the fallback
 */
function duration(value, fallback = null) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const match = DURATION.exec(value.trim());

  if (!match) {
    return fallback;
  }

  const amount =
    Number(match[1]) * DURATION_UNITS.get((match[2] || 'ms').toLowerCase());

  return amount > 0 ? Math.round(amount) : fallback;
}

/**
 * A size in bytes (`'256kb'`, `1048576`), written the way `bodyLimit` is
 *
 * @param {*} value what was written
 * @param {?number} [fallback=null] what an unreadable value answers
 * @returns {?number} the size, or the fallback
 */
function bytes(value, fallback = null) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const match = SIZE.exec(value.trim());

  if (!match) {
    return fallback;
  }

  const size =
    Number(match[1]) * SIZE_UNITS.get((match[2] || 'b').toLowerCase());

  return size > 0 ? Math.floor(size) : fallback;
}

/**
 * A size, printed the way the documentation writes it
 *
 * @param {number} value a number of bytes
 * @returns {string} `'32mb'`, `'256kb'`, `'900b'`
 */
function formatBytes(value) {
  for (const unit of ['gb', 'mb', 'kb']) {
    if (value >= SIZE_UNITS.get(unit)) {
      return `${Math.round((value / SIZE_UNITS.get(unit)) * 10) / 10}${unit}`;
    }
  }

  return `${value}b`;
}

/**
 * A duration, printed the way the documentation writes it
 *
 * @param {number} value milliseconds
 * @returns {string} `'5m'`, `'30s'`, `'250ms'`
 */
function formatDuration(value) {
  for (const [unit, size] of [...DURATION_UNITS].reverse()) {
    if (unit !== 'ms' && value >= size && value % size === 0) {
      return `${value / size}${unit}`;
    }
  }

  return `${value}ms`;
}

/**
 * What a value is, in words, for a refusal. The value itself is never in
 * the message: the cache is handed whatever the application had.
 *
 * @param {*} value what was refused
 * @returns {string} a noun phrase (`a function`, `an instance of User`)
 */
function describeType(value) {
  if (typeof value === 'undefined') {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'number') {
    return Number.isNaN(value) ? 'NaN' : String(value);
  }

  if (typeof value !== 'object') {
    return `a ${typeof value}`;
  }

  if (value instanceof Date) {
    return 'an Invalid Date';
  }

  const name = value.constructor && value.constructor.name;

  return name ? `an instance of ${name}` : 'an object without a prototype';
}

/**
 * What to do about a value the cache cannot keep
 *
 * @param {*} value what was refused
 * @returns {string} the hint, or an empty string
 */
function hintFor(value) {
  if (typeof value === 'undefined') {
    return 'undefined is what a miss answers: cache null for "there is nothing".';
  }

  if (typeof value === 'number') {
    return 'JSON writes it null; keep the number a number, or store it as a string.';
  }

  if (value instanceof Date) {
    return 'The date is invalid: check what built it.';
  }

  if (typeof value === 'object' && value !== null) {
    return 'Store what you want back: record.toJSON(), or henri.model.stores.default.toPlain(record).';
  }

  return 'The cache keeps what JSON keeps, plus Date.';
}

/**
 * The refusal of a value that cannot survive the cache
 *
 * @param {string} path where it sits (`the value.user.createdAt`)
 * @param {*} value what was refused
 * @returns {Error} the error to throw
 */
function refuse(path, value) {
  return fail(
    'HENRI_CACHE_VALUE_UNSUPPORTED',
    `${path} is ${describeType(value)}, which the cache cannot store. ${hintFor(
      value
    )}`
  );
}

/**
 * A value, ready for `JSON.stringify`: every `Date` tagged, every object
 * that holds a tag of its own escaped, and everything JSON would change on
 * the way through refused instead.
 *
 * @param {*} value what the caller is storing
 * @param {string} path where it sits, for the refusal
 * @param {Set} seen the objects on the way here, so a cycle is caught
 * @returns {*} the JSON-ready value
 * @throws {Error} `HENRI_CACHE_VALUE_UNSUPPORTED` for anything else
 */
function prepare(value, path, seen) {
  if (value === null) {
    return null;
  }

  const type = typeof value;

  if (type === 'string' || type === 'boolean') {
    return value;
  }

  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw refuse(path, value);
    }

    return value;
  }

  if (type !== 'object') {
    throw refuse(path, value);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw refuse(path, value);
    }

    return { [DATE_TAG]: value.toISOString() };
  }

  if (seen.has(value)) {
    throw fail(
      'HENRI_CACHE_VALUE_UNSUPPORTED',
      `${path} is already in the value being stored: the cache cannot store a circular structure.`
    );
  }

  if (!Array.isArray(value) && !isPlain(value)) {
    throw refuse(path, value);
  }

  seen.add(value);

  const done = Array.isArray(value)
    ? value.map((item, index) => prepare(item, `${path}[${index}]`, seen))
    : plainOf(value, path, seen);

  seen.delete(value);

  return done;
}

/**
 * The members of a plain object, prepared. A key whose value is
 * `undefined` is dropped, the way `JSON.stringify` drops it; an object
 * holding a tag of henri's own is wrapped so it comes back as it went in.
 *
 * @param {object} value the object
 * @param {string} path where it sits, for the refusal
 * @param {Set} seen the objects on the way here
 * @returns {object} the JSON-ready object
 */
function plainOf(value, path, seen) {
  const done = {};

  for (const key of Object.keys(value)) {
    if (typeof value[key] !== 'undefined') {
      done[key] = prepare(value[key], `${path}.${key}`, seen);
    }
  }

  return owns(value, DATE_TAG) || owns(value, ESCAPE_TAG)
    ? { [ESCAPE_TAG]: done }
    : done;
}

/**
 * What is written down for a value
 *
 * @param {*} value what the caller is storing
 * @returns {string} the encoded entry
 * @throws {Error} `HENRI_CACHE_VALUE_UNSUPPORTED` for what cannot survive
 */
function encode(value) {
  return JSON.stringify(prepare(value, 'the value', new Set()));
}

/**
 * The members of something already known not to be a tag
 *
 * @param {*} value an array or a plain object
 * @returns {*} the same shape, revived
 */
function members(value) {
  if (Array.isArray(value)) {
    return value.map(revive);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const done = {};

  for (const key of Object.keys(value)) {
    done[key] = revive(value[key]);
  }

  return done;
}

/**
 * A parsed entry, with the tags read back.
 *
 * Top down rather than through a `JSON.parse` reviver, which runs bottom
 * up and would read the tag inside an escape before the escape that says
 * it is not one.
 *
 * @param {*} value what `JSON.parse` answered
 * @returns {*} the value the caller stored
 */
function revive(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return members(value);
  }

  const keys = Object.keys(value);

  if (keys.length === 1 && keys[0] === ESCAPE_TAG) {
    return members(value[ESCAPE_TAG]);
  }

  if (keys.length === 1 && keys[0] === DATE_TAG) {
    const date = new Date(value[DATE_TAG]);

    return Number.isNaN(date.getTime()) ? members(value) : date;
  }

  return members(value);
}

/**
 * What was written down, read back. An entry that is not what the cache
 * wrote (something else owns the key, an old format) reads as a miss
 * rather than as a failure.
 *
 * @param {*} entry what the backend answered
 * @returns {*} the value, or `undefined` for a miss
 */
function decode(entry) {
  if (typeof entry !== 'string') {
    return undefined;
  }

  try {
    return revive(JSON.parse(entry));
  } catch (error) {
    debug('unreadable entry: %s', error.message);

    return undefined;
  }
}

/**
 * A key, from whatever the caller keyed on.
 *
 * Strings pass through; a number, a boolean or a `Date` become the obvious
 * thing; an array is its parts joined with `/`, which is how a key with
 * more than one part is written (`['user', id, 'posts']`); a plain object
 * is its keys sorted, so two callers writing them in a different order
 * still meet; anything with a `cacheKey()` answers for itself.
 *
 * @param {*} value what to key on
 * @returns {string} the key
 * @throws {Error} `HENRI_CACHE_KEY_INVALID` for what cannot become one
 */
function cacheKey(value) {
  if (typeof value === 'string') {
    if (value.trim() === '' || CONTROL.test(value)) {
      throw fail(
        'HENRI_CACHE_KEY_INVALID',
        value.trim() === ''
          ? 'a cache key cannot be empty'
          : 'a cache key cannot hold control characters'
      );
    }

    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw fail('HENRI_CACHE_KEY_INVALID', 'a cache key cannot be empty');
    }

    return value.map(cacheKey).join('/');
  }

  if (value && typeof value.cacheKey === 'function') {
    return cacheKey(value.cacheKey());
  }

  if (value && typeof value === 'object' && isPlain(value)) {
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .map((key) => [key, cacheKey(value[key])])
    );
  }

  throw fail(
    'HENRI_CACHE_KEY_INVALID',
    `${describeType(value)} is not a cache key: use a string, a number, a Date, an array of them, or give it a cacheKey() method.`
  );
}

/**
 * A key inside the bound, deterministically: a long one keeps its front,
 * so it is still readable in a log, and ends with a digest of the whole.
 *
 * @param {string} key the key
 * @returns {string} a key of at most MAX_KEY_LENGTH characters
 */
function bound(key) {
  if (key.length <= MAX_KEY_LENGTH) {
    return key;
  }

  const digest = crypto
    .createHash('sha256')
    .update(key)
    .digest('hex')
    .slice(0, DIGEST_LENGTH);

  return `${key.slice(0, MAX_KEY_LENGTH - DIGEST_LENGTH - 1)}~${digest}`;
}

/**
 * A key as it may be printed: masked when its name holds one of
 * `config.filterParameters`, the way a parameter of that name is masked in
 * a body
 *
 * @param {string} key the key
 * @param {Array<string>} filters the filters
 * @returns {string} the key, or `[FILTERED]`
 */
const maskKey = (key, filters) => (isFiltered(key, filters) ? MASK : key);

/**
 * The memory backend: the cache of an application that names no shared
 * one.
 *
 * Entries are the encoded string, not the object the caller handed over.
 * It costs a parse per read and buys two things worth more than it: a
 * reader cannot mutate what the next reader will get, and both backends
 * then keep and answer exactly the same thing, so what works here works in
 * Redis.
 *
 * Bounded twice -- a number of entries and a number of bytes -- and the
 * least recently used goes first, so a key space nobody thought would grow
 * costs a fixed amount of memory instead of the process.
 *
 * @class MemoryBackend
 */
class MemoryBackend {
  /**
   * Creates an instance of MemoryBackend.
   *
   * @param {object} [options={}] options
   * @param {number} [options.maxEntries] how many entries it may hold
   * @param {number} [options.maxSize] how many bytes it may hold
   * @param {function(): number} [options.now=Date.now] the clock (tests)
   * @param {number} [options.sweepEvery=SWEEP_EVERY] expiry sweep (ms)
   * @memberof MemoryBackend
   */
  constructor({
    maxEntries = DEFAULTS.maxEntries,
    maxSize = DEFAULTS.maxSize,
    now = Date.now,
    sweepEvery = SWEEP_EVERY,
  } = {}) {
    this.name = 'memory';
    this.entries = new Map();
    this.maxEntries = maxEntries;
    this.maxSize = maxSize;
    this.now = now;
    this.size = 0;
    this.evictions = 0;
    this.timer = setInterval(() => this.sweep(), sweepEvery);
    this.timer.unref();
  }

  /**
   * Reads an entry, and makes it the most recently used
   *
   * @param {string} key the key
   * @returns {Promise<?string>} the encoded entry, or undefined
   * @memberof MemoryBackend
   */
  async get(key) {
    const entry = this.entries.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expires <= this.now()) {
      this.drop(key);

      return undefined;
    }

    // Re-inserting moves it to the end: the front of a Map is its oldest
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.payload;
  }

  /**
   * Writes an entry, evicting the least recently used to stay in bounds
   *
   * @param {string} key the key
   * @param {string} payload the encoded entry
   * @param {number} ttl how long it lives (ms)
   * @returns {Promise<boolean>} true when it was written
   * @memberof MemoryBackend
   */
  async set(key, payload, ttl) {
    const weight = Buffer.byteLength(payload) + Buffer.byteLength(key);

    this.drop(key);

    if (weight > this.maxSize) {
      return false;
    }

    this.entries.set(key, { expires: this.now() + ttl, payload, weight });
    this.size += weight;

    while (
      this.entries.size > this.maxEntries ||
      (this.size > this.maxSize && this.entries.size > 1)
    ) {
      const oldest = this.entries.keys().next().value;

      this.drop(oldest);
      this.evictions += 1;
    }

    return true;
  }

  /**
   * Removes an entry
   *
   * @param {string} key the key
   * @returns {Promise<boolean>} whether there was one
   * @memberof MemoryBackend
   */
  async delete(key) {
    return this.drop(key);
  }

  /**
   * Removes every entry of a prefix
   *
   * @param {string} [prefix=''] the prefix (everything when empty)
   * @returns {Promise<number>} how many were removed
   * @memberof MemoryBackend
   */
  async clear(prefix = '') {
    let removed = 0;

    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix) && this.drop(key)) {
        removed += 1;
      }
    }

    return removed;
  }

  /**
   * Forgets an entry, keeping the byte count honest
   *
   * @param {string} key the key
   * @returns {boolean} whether there was one
   * @memberof MemoryBackend
   */
  drop(key) {
    const entry = this.entries.get(key);

    if (!entry) {
      return false;
    }

    this.size -= entry.weight;
    this.entries.delete(key);

    return true;
  }

  /**
   * Removes what has expired, so a key nobody reads again is not held
   * until the eviction reaches it
   *
   * @returns {number} how many were removed
   * @memberof MemoryBackend
   */
  sweep() {
    const now = this.now();
    let removed = 0;

    for (const [key, entry] of this.entries) {
      if (entry.expires <= now && this.drop(key)) {
        removed += 1;
      }
    }

    return removed;
  }

  /**
   * What it is holding, for `henri.cache.stats()`
   *
   * @returns {{bytes: number, entries: number}} the counts
   * @memberof MemoryBackend
   */
  usage() {
    return { bytes: this.size, entries: this.entries.size };
  }

  /**
   * Drops everything and stops the sweep
   *
   * @returns {Promise<void>} done
   * @memberof MemoryBackend
   */
  async shutdown() {
    clearInterval(this.timer);
    this.entries.clear();
    this.size = 0;
  }
}

/**
 * The cache itself: what `henri.cache` and every `scope()` of it are.
 *
 * @class Cache
 */
class Cache {
  /**
   * Creates an instance of Cache.
   *
   * @param {object} options options
   * @param {object} options.store the backend (`get`, `set`, `delete`)
   * @param {object} options.settings the normalized `config.cache`
   * @param {?object} [options.henri=null] the henri instance (for the log)
   * @param {string} [options.scope=''] what every key of this one starts with
   * @param {?object} [options.root=null] the cache this one was scoped from
   * @memberof Cache
   */
  constructor({ store, settings, henri = null, scope = '', root = null }) {
    this.store = store;
    this.settings = settings;
    this.henri = henri;
    this.prefix = scope;
    this.root = root;
    this.name = (store && store.name) || 'memory';
    this.enabled = settings.enabled !== false;

    /** Shared with every scope: one flight and one set of counters */
    this.inflight = root ? root.inflight : new Map();
    this.counters = root
      ? root.counters
      : { errors: 0, hits: 0, misses: 0, writes: 0 };
    this.reported = root ? root.reported : new Map();
    this.filters = root
      ? root.filters
      : filterParameters(henri && henri.config);
  }

  /**
   * A cache whose keys all start with a name of their own, so two features
   * cannot collide on a key as ordinary as `recent`
   *
   * @param {string} name the scope name
   * @returns {Cache} the scoped cache
   * @throws {Error} `HENRI_CACHE_KEY_INVALID` when the name is not one
   * @memberof Cache
   */
  scope(name) {
    return new Cache({
      henri: this.henri,
      root: this.root || this,
      scope: `${this.prefix}${cacheKey(name)}:`,
      settings: this.settings,
      store: this.store,
    });
  }

  /**
   * The key a backend sees: the scope, then the key, shortened when it is
   * longer than the bound (the scope never is, so `clear()` still finds it)
   *
   * @param {*} key what the caller keyed on
   * @returns {string} the key
   * @memberof Cache
   */
  keyFor(key) {
    return `${this.prefix}${bound(cacheKey(key))}`;
  }

  /**
   * A TTL in milliseconds, from the options of a call
   *
   * @param {object} [options={}] the options of the call
   * @returns {number} the TTL
   * @throws {Error} `HENRI_CACHE_TTL_INVALID` when it is not a duration
   * @memberof Cache
   */
  ttlOf(options = {}) {
    if (typeof options.ttl === 'undefined' || options.ttl === null) {
      return this.settings.ttl;
    }

    const ms = duration(options.ttl, null);

    if (ms === null) {
      throw fail(
        'HENRI_CACHE_TTL_INVALID',
        `${JSON.stringify(options.ttl)} is not a duration: use milliseconds, or '30s', '5m', '2h', '1d'. Every entry has one -- there is no forever.`
      );
    }

    return ms;
  }

  /**
   * Says the backend did not answer, at most once every ten seconds, the
   * way a shared store's fallthrough is said
   *
   * @param {string} what the call that failed (`read`, `write`)
   * @param {string} key the key it was about
   * @param {Error} error what the backend threw
   * @returns {boolean} whether it was logged this time
   * @memberof Cache
   */
  degraded(what, key, error) {
    const now = Date.now();
    const last = this.reported.get(what) || 0;

    this.counters.errors += 1;
    debug('%s %s: %s', what, maskKey(key, this.filters), error.message);

    if (now - last < REPORT_EVERY) {
      return false;
    }

    this.reported.set(what, now);

    if (this.henri && this.henri.pen) {
      this.henri.pen.warn(
        'cache',
        this.name,
        `${what} failed, treating it as a miss: ${error.message}`
      );
    }

    return true;
  }

  /**
   * Reads a key
   *
   * @param {*} key what the caller keyed on
   * @returns {Promise<*>} the value, or `undefined` when there is none
   * @throws {Error} `HENRI_CACHE_KEY_INVALID` when the key is not one
   * @memberof Cache
   */
  async get(key) {
    if (!this.enabled) {
      return undefined;
    }

    const full = this.keyFor(key);
    let entry;

    try {
      entry = await this.store.get(full);
    } catch (error) {
      this.degraded('read', full, error);

      return undefined;
    }

    const value = decode(entry);

    this.counters[typeof value === 'undefined' ? 'misses' : 'hits'] += 1;

    return value;
  }

  /**
   * Writes a key
   *
   * @param {*} key what the caller keyed on
   * @param {*} value what to keep (JSON, plus Date)
   * @param {object} [options={}] `ttl`
   * @returns {Promise<boolean>} whether it was written
   * @throws {Error} when the key or the value cannot be stored
   * @memberof Cache
   */
  async set(key, value, options = {}) {
    if (!this.enabled) {
      return false;
    }

    const full = this.keyFor(key);
    const ttl = this.ttlOf(options);
    const payload = encode(value);
    const size = Buffer.byteLength(payload);

    if (size > this.settings.maxEntrySize) {
      this.oversize(full, size);
      // What was there is superseded by a value that could not be written:
      // serving it now would be serving what the caller just replaced
      await this.delete(key);

      return false;
    }

    try {
      const written = (await this.store.set(full, payload, ttl)) !== false;

      if (written) {
        this.counters.writes += 1;
      }

      return written;
    } catch (error) {
      this.degraded('write', full, error);

      return false;
    }
  }

  /**
   * Says a value was too big to keep, at most once every ten seconds.
   * Nothing is truncated and nothing is stored: half a value read back as
   * a whole one is the bug this exists to avoid.
   *
   * @param {string} key the key it was about
   * @param {number} size what it weighed
   * @returns {boolean} whether it was logged this time
   * @memberof Cache
   */
  oversize(key, size) {
    const now = Date.now();
    const last = this.reported.get('oversize') || 0;

    debug('%s is %d bytes, not stored', maskKey(key, this.filters), size);

    if (now - last < REPORT_EVERY) {
      return false;
    }

    this.reported.set('oversize', now);

    if (this.henri && this.henri.pen) {
      this.henri.pen.warn(
        'cache',
        `${maskKey(key, this.filters)} is ${formatBytes(size)}, more than the ${formatBytes(
          this.settings.maxEntrySize
        )} of cache.maxEntrySize: not cached`,
        'Cache less of it, or raise the limit'
      );
    }

    return true;
  }

  /**
   * Forgets a key. The one invalidation henri has: nothing else in the
   * framework decides that a value is stale.
   *
   * @param {*} key what the caller keyed on
   * @returns {Promise<boolean>} whether the backend answered
   * @memberof Cache
   */
  async delete(key) {
    if (!this.enabled) {
      return false;
    }

    const full = this.keyFor(key);

    try {
      await this.store.delete(full);

      return true;
    } catch (error) {
      this.degraded('delete', full, error);

      return false;
    }
  }

  /**
   * Forgets everything of this cache -- of this scope only, when it is one.
   *
   * It walks the key space, so it belongs in a test's teardown or a
   * console, not in a request.
   *
   * @returns {Promise<number>} how many keys were removed
   * @throws {Error} `HENRI_CACHE_STORE_INCAPABLE` when the backend cannot
   * @memberof Cache
   */
  async clear() {
    if (!this.enabled) {
      return 0;
    }

    if (typeof this.store.clear !== 'function') {
      throw fail(
        'HENRI_CACHE_STORE_INCAPABLE',
        `the cache backend (${this.name}) cannot clear a key space: delete the keys you know, or give the store a clear(prefix) method.`
      );
    }

    try {
      return await this.store.clear(this.prefix);
    } catch (error) {
      this.degraded('clear', this.prefix, error);

      return 0;
    }
  }

  /**
   * The cached value, or the one the function answers -- kept for next
   * time, and computed once however many callers missed it at once.
   *
   * @param {*} key what the caller keyed on
   * @param {(object|function)} [options={}] `ttl`, `force`, or the function
   * @param {function} [fn] what to run on a miss
   * @returns {Promise<*>} the value
   * @throws whatever the function throws (nothing is cached then)
   * @memberof Cache
   */
  async fetch(key, options = {}, fn = null) {
    const run = typeof options === 'function' ? options : fn;
    const settings = typeof options === 'function' ? {} : options;

    if (typeof run !== 'function') {
      throw new TypeError(
        'henri.cache.fetch(key, [options], fn) needs a function to run on a miss'
      );
    }

    if (!this.enabled) {
      return run();
    }

    const full = this.keyFor(key);

    if (!settings.force) {
      const hit = await this.get(key);

      if (typeof hit !== 'undefined') {
        return hit;
      }

      const inflight = this.inflight.get(full);

      if (inflight) {
        return inflight;
      }
    }

    const promise = Promise.resolve()
      .then(run)
      .then(async (value) => {
        await this.set(key, value, settings);

        return value;
      });

    if (settings.force) {
      return promise;
    }

    // Nothing is awaited between the miss above and this line, and that is
    // what makes the single flight hold: a caller resuming from its own
    // `get` runs to here without yielding, so the first one to come back
    // registers and every other one finds it
    this.inflight.set(full, promise);

    // Everyone waiting shares this rejection; nobody is left with an
    // unhandled one because the entry is removed either way
    return promise.finally(() => this.inflight.delete(full));
  }

  /**
   * What the cache has done, and what the memory backend is holding
   *
   * @returns {object} the counters
   * @memberof Cache
   */
  stats() {
    const usage =
      typeof this.store.usage === 'function'
        ? this.store.usage()
        : { bytes: null, entries: null };

    return Object.assign(
      {
        backend: this.name,
        evictions: this.store.evictions || 0,
        inflight: this.inflight.size,
      },
      usage,
      this.counters
    );
  }

  /**
   * What the boot line says about where the cache is
   *
   * @returns {string} one line
   * @memberof Cache
   */
  describe() {
    const parts = [`${formatDuration(this.settings.ttl)} default ttl`];

    if (this.name === 'memory') {
      parts.push(
        `${this.settings.maxEntries} entries`,
        formatBytes(this.settings.maxSize)
      );
    }

    parts.push(`${formatBytes(this.settings.maxEntrySize)} per entry`);

    return parts.join(', ');
  }

  /**
   * Releases the backend, when it is one of henri's own
   *
   * @returns {Promise<void>} done
   * @memberof Cache
   */
  async stop() {
    this.inflight.clear();
    this.reported.clear();

    if (typeof this.store.shutdown === 'function') {
      await this.store.shutdown();
    }
  }
}

/**
 * Normalizes `config.cache`
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {object} the settings
 * @throws {TypeError} when the block is not an object
 */
function cacheConfig(config) {
  const has =
    Boolean(config) && typeof config.has === 'function' && config.has('cache');
  const raw = has ? config.get('cache') : null;

  if (raw === false) {
    return Object.assign({}, DEFAULTS, { enabled: false });
  }

  if (raw === null || typeof raw === 'undefined') {
    return Object.assign({}, DEFAULTS);
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(
      'config.cache must be an object ({ ttl, maxEntries, maxSize, maxEntrySize, store }) or false'
    );
  }

  const maxSize = bytes(raw.maxSize, DEFAULTS.maxSize);
  const settings = {
    enabled: raw.enabled !== false,
    maxEntries: Math.max(
      1,
      Math.floor(
        Number(raw.maxEntries) > 0 ? raw.maxEntries : DEFAULTS.maxEntries
      )
    ),
    // A value nothing can ever hold is a limit that only looks like one
    maxEntrySize: Math.min(
      bytes(raw.maxEntrySize, DEFAULTS.maxEntrySize),
      maxSize
    ),
    maxSize,
    store: typeof raw.store === 'string' ? raw.store : null,
    ttl: duration(raw.ttl, DEFAULTS.ttl),
  };

  return settings;
}

/**
 * The backend of an application: the module `config.cache.store` names,
 * else the shared backend of `config.shared`, else this process's memory.
 *
 * A backend is `get(key)`, `set(key, payload, ttl)` and `delete(key)` over
 * strings -- `payload` is what `encode()` wrote -- plus an optional
 * `clear(prefix)`, `usage()` and `shutdown()`. The shared one is taken
 * without its failure policy (`SharedStore#unguarded`): a cache decides for
 * itself what a backend that is down means, and the answer is a miss.
 *
 * @param {Henri} henri the henri instance
 * @param {object} settings the normalized `config.cache`
 * @returns {object} the backend
 * @throws {Error} when `cache.store` names something that cannot be loaded
 */
function createCache(henri, settings) {
  if (settings.store) {
    const { loadStore } = require('./api');
    const store = loadStore(henri, settings.store, { name: 'cache' });

    if (!store.name) {
      // The boot line says where the cache is; a store that does not name
      // itself is named by what the configuration called it
      store.name = settings.store;
    }

    return store;
  }

  if (henri.shared && typeof henri.shared.unguarded === 'function') {
    return henri.shared.unguarded('cache', { raw: true });
  }

  return new MemoryBackend({
    maxEntries: settings.maxEntries,
    maxSize: settings.maxSize,
  });
}

module.exports = {
  Cache,
  DEFAULTS,
  DIGEST_LENGTH,
  MAX_KEY_LENGTH,
  MemoryBackend,
  SWEEP_EVERY,
  bound,
  bytes,
  cacheConfig,
  cacheKey,
  createCache,
  decode,
  duration,
  encode,
  formatBytes,
  formatDuration,
  maskKey,
};
