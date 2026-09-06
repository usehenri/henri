const { randomUUID } = require('crypto');
const debug = require('debug')('henri:webhooks');

const { WebhookError, coded } = require('./errors');
const { active, fresh, keyring, open, rotate, seal } = require('./secrets');
const { deliver } = require('./deliver');
const { parse: parseUrl } = require('./address');
const { headersFor } = require('./signature');
const { normalize } = require('./config');
const { storeFor } = require('./store');

/**
 * Outbound webhooks: what an application sees as `henri.webhooks`.
 *
 * ## Where the endpoints live
 *
 * In a table this package owns, `henri_webhooks`, reached through the store
 * adapter the way the queue reaches `henri_jobs`. The three candidates were
 * the configuration, a model the application writes, and this; the first
 * cannot hold a per-tenant secret or a rotation, and the second makes every
 * application carry a migration, a validation and a secret column for a
 * table it did not want to design -- and gets the storage of the secret
 * wrong, which is the whole point of the feature.
 *
 * What that costs, said plainly:
 *
 * - **many tenants** work because an endpoint carries an `owner`, which is
 *   the tenant's id, and `emit(event, data, { owner })` only ever loads and
 *   sends to that tenant's endpoints. The index is on `(owner,
 *   disabled_at)`.
 * - **many endpoints** work up to a point: a lookup loads the enabled
 *   endpoints of one owner (of the whole application when there is no
 *   owner) and matches the event pattern here, because no two of the four
 *   SQL dialects agree on how to ask that of a JSON column. The list is
 *   cached in `henri.cache` for ten seconds, without the secrets, so a busy
 *   event costs one query per owner per ten seconds and not one per event.
 * - the ceiling is `webhooks.maxFanout` (a thousand by default): past it,
 *   `emit()` refuses rather than writing ten thousand rows inside a
 *   request. An application that really has that many endpoints for one
 *   event emits from a job.
 * - an endpoint is a row, not a model: it has no validations of yours, no
 *   hooks and no `paranoid`. `henri.webhooks.register()` is the only way in.
 *
 * ## Where the deliveries live
 *
 * In the queue. A delivery is one `henri/webhook` job, so the retries, the
 * backoff and the dead letter queue are the queue's and there is no second
 * mechanism to learn, no second table to prune and no second answer to
 * "what happened to it". `henri jobs:list --queue webhooks`,
 * `henri jobs:dead` and `henri jobs:show <id>` are the operator's view.
 */

/** The job that performs one delivery */
const DELIVERY_JOB = 'henri/webhook';

/** How long an endpoint lookup is cached */
const CACHE_TTL = 10000;

/** How many event patterns one endpoint may carry */
const MAX_EVENTS = 100;

/** How many headers of its own one endpoint may carry */
const MAX_HEADERS = 10;

/** How long an owner may be: the width of the column it is indexed in */
const MAX_OWNER = 190;

/** What an event name may look like */
const EVENT = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u;

/** What a subscription may look like: an event name, `*`, or `prefix.*` */
const PATTERN = /^(?:\*|[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\.\*)?)$/u;

/**
 * Headers an endpoint may not set: the ones the signature owns, the ones
 * the request owns, and the hop-by-hop ones a proxy would strip anyway
 */
const RESERVED = [
  'connection',
  'content-length',
  'content-type',
  'expect',
  'host',
  'keep-alive',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'webhook-id',
  'webhook-signature',
  'webhook-timestamp',
];

/**
 * Reads a stored JSON column back
 *
 * @param {*} value What the row holds
 * @param {*} [fallback=null] What to answer when there is nothing
 * @returns {*} The value
 */
const parse = (value, fallback = null) => {
  if (value === null || typeof value === 'undefined') {
    return fallback;
  }

  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

/**
 * A number read back from any driver (pg hands BIGINT over as a string)
 *
 * @param {*} value The stored value
 * @returns {?number} The number, or null
 */
const toNumber = (value) => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isNaN(number) ? null : number;
};

/**
 * A moment, as the API hands it out
 *
 * @param {*} value A timestamp in milliseconds
 * @returns {?string} An ISO string, or null
 */
const at = (value) => {
  const number = toNumber(value);

  return number === null ? null : new Date(number).toISOString();
};

/**
 * Whether an endpoint subscribed to an event
 *
 * A subscription is the event name, `*` for everything, or `prefix.*` for a
 * family (`invoice.*` takes `invoice.paid` and `invoice.payment.failed`).
 * Nothing else: a glob language is a second thing to get wrong, and the
 * fan-out policy beyond this is the application's.
 *
 * @param {Array<string>} patterns What the endpoint subscribed to
 * @param {string} event The event name
 * @returns {boolean} Whether it is subscribed
 */
const subscribed = (patterns, event) =>
  (patterns || []).some((pattern) => {
    if (pattern === '*' || pattern === event) {
      return true;
    }

    return pattern.endsWith('.*') && event.startsWith(pattern.slice(0, -1));
  });

/**
 * The endpoints of an application
 *
 * @class Webhooks
 */
class Webhooks {
  /**
   * Creates an instance of Webhooks.
   *
   * @param {object} henri The henri instance
   * @param {object} [options={}] Options
   * @param {object} [options.config] The `webhooks` block
   * @param {object} [options.adapter] The store adapter, when it is not
   *   taken from `henri.model`
   * @param {string} [options.agent] The user agent deliveries carry
   * @memberof Webhooks
   */
  constructor(henri, options = {}) {
    this.henri = henri;
    this.pen = (henri && henri.pen) || null;
    this.config = normalize(options.config || {});
    this.adapter = options.adapter || null;
    this.agent = options.agent || 'henri-webhooks';
    this.ownsAdapter = false;
    this.store = null;
    this.started = false;
    this.keys = null;
  }

  /**
   * Says something, when there is a pen to say it with
   *
   * @param {string} level info, warn or error
   * @param {...*} args What to say
   * @returns {void}
   * @memberof Webhooks
   */
  log(level, ...args) {
    if (this.pen && typeof this.pen[level] === 'function') {
      this.pen[level]('webhooks', ...args);
    }
  }

  /**
   * Prepares the table and the key the secrets are sealed with
   *
   * @param {object} [options={}] `install`, overriding the configuration
   * @returns {Promise<Webhooks>} This instance
   * @throws {WebhookError} When the store cannot hold the endpoints
   * @memberof Webhooks
   */
  async start(options = {}) {
    const adapter = this.resolveAdapter();

    if (this.ownsAdapter) {
      await adapter.start();
    }

    this.store = storeFor(adapter, this.config.tables);
    this.keys = keyring(this.secretOf());

    if (!this.keys) {
      this.log(
        'warn',
        'no "secret" in the configuration: the endpoint signing secrets are stored as they are, not encrypted'
      );
    }

    const install =
      typeof options.install === 'boolean'
        ? options.install
        : this.config.install;

    if (install) {
      try {
        await this.store.install();
      } catch (error) {
        throw new WebhookError(
          'HENRI_WEBHOOK_UNSUPPORTED_STORE',
          `@usehenri/webhooks: unable to create the endpoints table in the "${this.config.store}" store: ${error.message}`,
          {
            cause: error,
            hint: 'Run `henri webhooks:install` once with a user that may create tables, then set "install": false in the webhooks configuration',
          }
        );
      }
    }

    this.started = true;

    return this;
  }

  /**
   * Lets go of what this instance opened
   *
   * @returns {Promise<void>} Resolves when done
   * @memberof Webhooks
   */
  async stop() {
    this.started = false;
  }

  /**
   * The application's own secret, which seals the endpoints' secrets
   *
   * @returns {?string} `config.secret`
   * @memberof Webhooks
   */
  secretOf() {
    const { config } = this.henri || {};

    if (config && typeof config.get === 'function' && config.has('secret')) {
      return config.get('secret');
    }

    return null;
  }

  /**
   * The store adapter holding the endpoints
   *
   * @returns {object} A henri store adapter
   * @throws {WebhookError} STORE_MISSING when the store is unknown
   * @memberof Webhooks
   */
  resolveAdapter() {
    if (this.adapter) {
      return this.adapter;
    }

    const model = this.henri && this.henri.model;
    const stores = (model && model.stores) || {};
    const name = this.config.store;

    if (stores[name]) {
      return stores[name];
    }

    if (model && typeof model.getStore === 'function') {
      let store = null;

      try {
        store = model.getStore(name);
      } catch (error) {
        debug('store %s cannot be built: %s', name, error.message);
      }

      if (store) {
        this.ownsAdapter = true;

        return store;
      }
    }

    throw new WebhookError(
      'HENRI_WEBHOOK_STORE_MISSING',
      `@usehenri/webhooks: no store named "${name}" in the configuration`,
      {
        hint: 'Set webhooks.store to one of the stores of config/default.json',
      }
    );
  }

  /**
   * The store, once this is started
   *
   * @returns {object} The store backend
   * @throws {WebhookError} NOT_STARTED before start()
   * @memberof Webhooks
   */
  storeOrDie() {
    if (!this.store) {
      throw new WebhookError(
        'HENRI_WEBHOOK_NOT_STARTED',
        '@usehenri/webhooks: the endpoints are not ready',
        {
          hint: 'henri starts them for you; outside of henri, call await webhooks.start()',
        }
      );
    }

    return this.store;
  }

  /**
   * The queue, or a readable error
   *
   * @returns {object} `henri.jobs`
   * @throws {Error} HENRI_JOB_QUEUE_UNAVAILABLE without a running queue
   * @memberof Webhooks
   */
  queue() {
    const { jobs } = this.henri || {};

    if (jobs && jobs.enabled) {
      return jobs;
    }

    throw coded(
      'HENRI_JOB_QUEUE_UNAVAILABLE',
      '@usehenri/webhooks: a delivery is a job, and this application has no running queue',
      {
        hint: 'Install @usehenri/jobs, add a "jobs" block to config/default.json, and run a worker with `henri jobs`',
        retryable: false,
      }
    );
  }

  /**
   * A stored row, as the API hands it out
   *
   * The secrets never come out here: `secrets()` is what reveals them, and
   * it is the only thing that does.
   *
   * @param {?object} row A row of the table
   * @returns {?object} The endpoint
   * @memberof Webhooks
   */
  toEndpoint(row) {
    if (!row) {
      return null;
    }

    const disabledAt = toNumber(row.disabled_at);

    return {
      createdAt: at(row.created_at),
      description: row.description || null,
      disabled: disabledAt !== null,
      disabledAt: at(row.disabled_at),
      disabledReason: row.disabled_reason || null,
      events: parse(row.events, []),
      headers: parse(row.headers, {}) || {},
      id: row.id,
      owner: row.owner || null,
      secrets: (parse(row.secrets, []) || []).map((record) => ({
        createdAt: at(record.createdAt),
        expiresAt: at(record.expiresAt),
        id: record.id,
        scheme: record.scheme,
      })),
      updatedAt: at(row.updated_at),
      url: row.url,
    };
  }

  /**
   * Checks what a caller wants to subscribe to
   *
   * @param {*} events The subscriptions
   * @returns {Array<string>} The patterns
   * @throws {WebhookError} INVALID_ENDPOINT when they are not patterns
   * @memberof Webhooks
   */
  events(events) {
    const list = Array.isArray(events) ? events : [events];
    const patterns = list
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (patterns.length === 0 || patterns.length > MAX_EVENTS) {
      throw new WebhookError(
        'HENRI_WEBHOOK_INVALID_ENDPOINT',
        `an endpoint subscribes to between 1 and ${MAX_EVENTS} events`,
        { hint: 'events: ["invoice.paid", "invoice.*"], or ["*"] for all' }
      );
    }

    for (const pattern of patterns) {
      if (!PATTERN.test(pattern)) {
        throw new WebhookError(
          'HENRI_WEBHOOK_INVALID_ENDPOINT',
          `"${pattern}" is not an event pattern`,
          {
            hint: 'An event name (`invoice.paid`), a family (`invoice.*`) or `*`',
          }
        );
      }
    }

    return [...new Set(patterns)];
  }

  /**
   * Checks the headers an endpoint asked to carry
   *
   * A receiver may need one of its own (a routing tag, a token its gateway
   * expects). It may not set the ones the signature owns, the ones the
   * request owns, or a hop-by-hop one: a header a receiver could set to
   * shadow `webhook-signature` would be a hole with a form in front of it.
   *
   * @param {*} headers What the caller asked for
   * @returns {object} The headers
   * @throws {WebhookError} INVALID_ENDPOINT when one is refused
   * @memberof Webhooks
   */
  headers(headers) {
    if (!headers) {
      return {};
    }

    if (typeof headers !== 'object' || Array.isArray(headers)) {
      throw new WebhookError(
        'HENRI_WEBHOOK_INVALID_ENDPOINT',
        'the headers of an endpoint are an object of names and values'
      );
    }

    const names = Object.keys(headers);

    if (names.length > MAX_HEADERS) {
      throw new WebhookError(
        'HENRI_WEBHOOK_INVALID_ENDPOINT',
        `an endpoint carries at most ${MAX_HEADERS} headers of its own`
      );
    }

    const checked = {};

    for (const name of names) {
      const lowered = name.toLowerCase();

      if (
        RESERVED.includes(lowered) ||
        !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u.test(name)
      ) {
        throw new WebhookError(
          'HENRI_WEBHOOK_INVALID_ENDPOINT',
          `an endpoint may not set the "${name}" header`,
          {
            hint: `henri owns ${RESERVED.join(', ')}`,
          }
        );
      }

      checked[lowered] = String(headers[name]);
    }

    return checked;
  }

  /**
   * Checks the tenant an endpoint belongs to
   *
   * An owner is an identifier, and an identifier is never truncated to fit:
   * two tenants sharing a long prefix would then share their endpoints,
   * which is the failure this key exists to prevent. Prose (`description`,
   * a disabled `reason`) is cut to fit; this is refused.
   *
   * @param {*} owner What the caller asked for
   * @returns {?string} The owner, or null
   * @throws {WebhookError} INVALID_ENDPOINT when it cannot be stored whole
   * @memberof Webhooks
   */
  owner(owner) {
    if (owner === null || typeof owner === 'undefined' || owner === '') {
      return null;
    }

    const value = String(owner);

    if (value.length > MAX_OWNER) {
      throw new WebhookError(
        'HENRI_WEBHOOK_INVALID_ENDPOINT',
        `an owner is at most ${MAX_OWNER} characters, and this one is ${value.length}`,
        {
          hint: 'An owner is the tenant identifier, and it is never truncated: two tenants sharing a prefix would share their endpoints',
        }
      );
    }

    return value;
  }

  /**
   * Registers an endpoint, and hands its secret over once
   *
   * The url's shape is checked here; the address it resolves to is checked
   * when a delivery is made, and only then, because DNS answers differently
   * later.
   *
   * @param {object} options Options
   * @param {string} options.url Where the deliveries go
   * @param {(string|Array<string>)} options.events What it subscribes to
   * @param {string} [options.owner] The tenant this endpoint belongs to
   * @param {string} [options.description] What it is, for the operator
   * @param {object} [options.headers] Headers of its own
   * @param {string} [options.secret] A secret of your own; henri generates
   *   one otherwise, which is what you want
   * @returns {Promise<object>} The endpoint, with `secret`
   * @throws {WebhookError} INVALID_ENDPOINT when something is refused
   * @memberof Webhooks
   */
  async register(options = {}) {
    const store = this.storeOrDie();
    const now = Date.now();
    // The scheme, the credentials and the shape, here; the address, later
    const url = parseUrl(options.url, { allowHttp: this.config.allowHttp });
    const record = fresh({ now, secret: options.secret });
    const row = {
      created_at: now,
      description: options.description
        ? String(options.description).slice(0, 190)
        : null,
      disabled_at: null,
      disabled_reason: null,
      events: JSON.stringify(this.events(options.events)),
      headers: JSON.stringify(this.headers(options.headers)),
      id: options.id || randomUUID(),
      owner: this.owner(options.owner),
      secrets: JSON.stringify([
        { ...record, key: seal(record.key, this.keys) },
      ]),
      updated_at: now,
      url: url.href,
    };

    const stored = await store.insert(row);

    await this.forget(row.owner);
    this.log('info', 'endpoint registered', row.id, url.href);

    return { ...this.toEndpoint(stored), secret: record.key };
  }

  /**
   * One endpoint
   *
   * @param {string} id The endpoint id
   * @returns {Promise<?object>} The endpoint, or null
   * @memberof Webhooks
   */
  async endpoint(id) {
    return this.toEndpoint(await this.storeOrDie().find(id));
  }

  /**
   * One endpoint, or a readable error
   *
   * @param {string} id The endpoint id
   * @returns {Promise<object>} The row
   * @throws {WebhookError} UNKNOWN when there is no such endpoint
   * @memberof Webhooks
   */
  async rowOf(id) {
    const row = await this.storeOrDie().find(id);

    if (!row) {
      throw new WebhookError(
        'HENRI_WEBHOOK_UNKNOWN',
        `no webhook endpoint with id "${id}"`,
        { hint: '`henri webhooks:list` shows the endpoints', retryable: false }
      );
    }

    return row;
  }

  /**
   * The endpoints, newest last
   *
   * @param {object} [filter={}] `owner`, `disabled`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The endpoints
   * @memberof Webhooks
   */
  async endpoints(filter = {}) {
    const rows = await this.storeOrDie().list(filter);

    return rows.map((row) => this.toEndpoint(row));
  }

  /**
   * The active secrets of an endpoint, in the clear
   *
   * The only thing that reveals them. An operator needs it when a receiver
   * lost the secret it was given, which is the moment the alternative is a
   * rotation nobody planned.
   *
   * @param {string} id The endpoint id
   * @returns {Promise<Array<string>>} The secrets that still sign
   * @throws {WebhookError} UNKNOWN, or SECRET_UNREADABLE
   * @memberof Webhooks
   */
  async secrets(id) {
    const row = await this.rowOf(id);

    return active(parse(row.secrets, []), Date.now()).map((record) =>
      open(record.key, this.keys)
    );
  }

  /**
   * Changes an endpoint
   *
   * @param {string} id The endpoint id
   * @param {object} [changes={}] `url`, `events`, `description`, `headers`,
   *   `owner`
   * @returns {Promise<object>} The endpoint
   * @throws {WebhookError} UNKNOWN, or INVALID_ENDPOINT
   * @memberof Webhooks
   */
  async update(id, changes = {}) {
    const row = await this.rowOf(id);
    const written = { updated_at: Date.now() };

    if (typeof changes.url === 'string') {
      written.url = parseUrl(changes.url, {
        allowHttp: this.config.allowHttp,
      }).href;
    }

    if (typeof changes.events !== 'undefined') {
      written.events = JSON.stringify(this.events(changes.events));
    }

    if (typeof changes.headers !== 'undefined') {
      written.headers = JSON.stringify(this.headers(changes.headers));
    }

    if (typeof changes.description !== 'undefined') {
      written.description = changes.description
        ? String(changes.description).slice(0, 190)
        : null;
    }

    if (typeof changes.owner !== 'undefined') {
      written.owner = this.owner(changes.owner);
    }

    const stored = await this.storeOrDie().update(id, written);

    await this.forget(row.owner);
    await this.forget(written.owner);

    return this.toEndpoint(stored);
  }

  /**
   * Gives an endpoint a new secret, the old one expiring after a grace
   *
   * Both secrets sign while the grace lasts, so the receiver has that long
   * to install the new one without dropping a delivery. `grace: 0` retires
   * the old secret at once, which is what a leak calls for.
   *
   * @param {string} id The endpoint id
   * @param {object} [options={}] `grace` (milliseconds), `secret`
   * @returns {Promise<object>} The endpoint, with the new `secret`
   * @throws {WebhookError} UNKNOWN when there is no such endpoint
   * @memberof Webhooks
   */
  async rotate(id, options = {}) {
    const row = await this.rowOf(id);
    const now = Date.now();
    const records = (parse(row.secrets, []) || []).map((record) => ({
      ...record,
      key: open(record.key, this.keys),
    }));
    const next = rotate(records, { ...options, now });
    const stored = await this.storeOrDie().update(id, {
      secrets: JSON.stringify(
        next.map((record) => ({ ...record, key: seal(record.key, this.keys) }))
      ),
      updated_at: now,
    });

    await this.forget(row.owner);
    this.log('info', 'endpoint secret rotated', id);

    return { ...this.toEndpoint(stored), secret: next[0].key };
  }

  /**
   * Stops sending to an endpoint
   *
   * @param {string} id The endpoint id
   * @param {object} [options={}] `reason`
   * @returns {Promise<object>} The endpoint
   * @throws {WebhookError} UNKNOWN when there is no such endpoint
   * @memberof Webhooks
   */
  async disable(id, options = {}) {
    const row = await this.rowOf(id);
    const stored = await this.storeOrDie().update(id, {
      disabled_at: Date.now(),
      disabled_reason: options.reason
        ? String(options.reason).slice(0, 190)
        : null,
      updated_at: Date.now(),
    });

    await this.forget(row.owner);
    this.log('warn', 'endpoint disabled', id, options.reason || '');

    return this.toEndpoint(stored);
  }

  /**
   * Sends to an endpoint again
   *
   * @param {string} id The endpoint id
   * @returns {Promise<object>} The endpoint
   * @throws {WebhookError} UNKNOWN when there is no such endpoint
   * @memberof Webhooks
   */
  async enable(id) {
    const row = await this.rowOf(id);
    const stored = await this.storeOrDie().update(id, {
      disabled_at: null,
      disabled_reason: null,
      updated_at: Date.now(),
    });

    await this.forget(row.owner);

    return this.toEndpoint(stored);
  }

  /**
   * Forgets an endpoint for good
   *
   * The deliveries already queued for it stop on their own: the job reads
   * the endpoint back and finds nothing.
   *
   * @param {string} id The endpoint id
   * @returns {Promise<boolean>} Whether there was one to remove
   * @memberof Webhooks
   */
  async remove(id) {
    const row = await this.storeOrDie().find(id);

    if (!row) {
      return false;
    }

    await this.storeOrDie().remove(id);
    await this.forget(row.owner);

    return true;
  }

  /**
   * The cache key of one owner's endpoints
   *
   * @param {?string} owner The owner
   * @returns {Array<string>} The key
   * @memberof Webhooks
   */
  cacheKey(owner) {
    return ['henri', 'webhooks', 'endpoints', owner || '-'];
  }

  /**
   * Drops the cached lookup of one owner
   *
   * @param {?string} owner The owner
   * @returns {Promise<void>} Resolves when it is gone
   * @memberof Webhooks
   */
  async forget(owner) {
    const { cache } = this.henri || {};

    if (cache && typeof cache.delete === 'function') {
      await cache.delete(this.cacheKey(owner)).catch(() => null);
    }
  }

  /**
   * What one owner subscribes to, cached
   *
   * Only the id, the owner and the patterns are cached: a signing secret
   * never reaches the cache, whether it is this process's memory or the
   * Redis of `config.shared`. The delivery job reads the endpoint back from
   * the database when it is about to sign, which is also what makes a
   * disabled endpoint stop being sent to at once.
   *
   * @param {?string} owner The owner
   * @returns {Promise<Array<object>>} `{ events, id, owner }` entries
   * @memberof Webhooks
   */
  async subscriptions(owner) {
    const load = async () => {
      const rows = await this.storeOrDie().list({
        disabled: false,
        limit: this.config.maxFanout + 1,
        owner,
      });

      return rows.map((row) => ({
        events: parse(row.events, []),
        id: row.id,
        owner: row.owner || null,
      }));
    };
    const { cache } = this.henri || {};

    if (!cache || typeof cache.fetch !== 'function') {
      return load();
    }

    return cache.fetch(this.cacheKey(owner), { ttl: CACHE_TTL }, load);
  }

  /**
   * Sends an event to every endpoint subscribed to it
   *
   * Nothing is sent here: one row per endpoint is written to the queue and
   * the call returns. A runner (`henri jobs`) delivers them.
   *
   * @param {string} event The event name (`invoice.paid`)
   * @param {*} [data=null] What the receivers get, under `data`
   * @param {object} [options={}] Options
   * @param {string} [options.owner] Only this tenant's endpoints
   * @param {(number|string)} [options.wait] Deliver that much later
   * @returns {Promise<Array<object>>} One `{ id, endpoint, job }` per
   *   delivery enqueued
   * @throws {WebhookError} INVALID_EVENT, or FANOUT_TOO_LARGE
   * @memberof Webhooks
   */
  async emit(event, data = null, options = {}) {
    if (typeof event !== 'string' || !EVENT.test(event)) {
      throw new WebhookError(
        'HENRI_WEBHOOK_INVALID_EVENT',
        `"${event}" is not an event name`,
        { hint: 'Letters, digits, - and _, in dot separated segments' }
      );
    }

    const owner =
      typeof options.owner === 'undefined' || options.owner === null
        ? null
        : String(options.owner);
    const found = await this.subscriptions(owner);
    const endpoints = found.filter((entry) => subscribed(entry.events, event));

    if (endpoints.length > this.config.maxFanout) {
      throw new WebhookError(
        'HENRI_WEBHOOK_FANOUT_TOO_LARGE',
        `${event} has ${endpoints.length} endpoints, over the ${this.config.maxFanout} of webhooks.maxFanout`,
        {
          hint: 'Emit from a job rather than from a request, or raise webhooks.maxFanout',
        }
      );
    }

    const deliveries = [];

    for (const endpoint of endpoints) {
      deliveries.push(await this.enqueue(endpoint.id, event, data, options));
    }

    debug('%s -> %d endpoint(s)', event, deliveries.length);

    return deliveries;
  }

  /**
   * Enqueues one delivery to one endpoint
   *
   * The body is serialized here, once, and stored with the job: every
   * attempt then signs the same bytes, and the delivery id a receiver
   * deduplicates on is the same on every attempt too. The timestamp is not:
   * it is stamped when the request goes out, so a retry six hours later is
   * still inside the receiver's window.
   *
   * @param {string} id The endpoint id
   * @param {string} event The event name
   * @param {*} [data=null] What the receiver gets, under `data`
   * @param {object} [options={}] `wait`, `at`
   * @returns {Promise<object>} `{ id, endpoint, event, job }`
   * @memberof Webhooks
   */
  async enqueue(id, event, data = null, options = {}) {
    const delivery = randomUUID();
    const body = JSON.stringify({
      data,
      id: delivery,
      timestamp: new Date().toISOString(),
      type: event,
    });
    // The request that caused the emit is over by the time the delivery
    // goes out, so the id has to travel with the job: without it the call
    // log would hold the outbound call and nothing to join it to
    const { calls } = this.henri || {};
    const job = await this.queue().perform(
      DELIVERY_JOB,
      {
        body,
        endpoint: id,
        event,
        id: delivery,
        requestId: (calls && calls.requestId()) || null,
      },
      {
        at: options.at,
        queue: this.config.queue,
        wait: options.wait,
      }
    );

    return { endpoint: id, event, id: delivery, job: job.id };
  }

  /**
   * Performs one delivery: what the `henri/webhook` job does
   *
   * @param {object} args `{ body, endpoint, event, id }`
   * @param {object} [context={}] The job context
   * @returns {Promise<object>} What happened
   * @throws {Error} Whatever the delivery failed with, `retryable` set
   * @memberof Webhooks
   */
  async perform(args, context = {}) {
    const row = await this.storeOrDie().find(args.endpoint);

    // The endpoint was deleted, or disabled, while this was waiting: both
    // are somebody saying "stop", so the delivery ends here and says so
    if (!row) {
      return { endpoint: args.endpoint, id: args.id, skipped: 'removed' };
    }

    if (toNumber(row.disabled_at) !== null) {
      return { endpoint: args.endpoint, id: args.id, skipped: 'disabled' };
    }

    const records = active(parse(row.secrets, []) || [], Date.now());
    const secrets = records.map((record) => open(record.key, this.keys));
    const headers = {
      ...(parse(row.headers, {}) || {}),
      ...headersFor({
        agent: this.agent,
        body: args.body,
        id: args.id,
        secrets,
      }),
    };

    const finish = this.tracked(row.url, args, headers);

    try {
      const answer = await deliver({
        allowHttp: this.config.allowHttp,
        allowPrivate: this.config.allowPrivate,
        body: args.body,
        headers,
        timeout: this.config.timeout,
        url: row.url,
      });

      finish({
        meta: {
          attempt: (context.job && context.job.attempt) || 1,
          endpoint: row.id,
          event: args.event,
        },
        status: answer.status,
      });

      this.log(
        'info',
        args.event,
        args.id,
        `-> ${row.url} ${answer.status} in ${answer.duration}ms`
      );

      return {
        address: answer.address,
        attempt: (context.job && context.job.attempt) || 1,
        duration: answer.duration,
        endpoint: row.id,
        event: args.event,
        id: args.id,
        status: answer.status,
      };
    } catch (error) {
      finish({
        error: error.code || error.name,
        meta: {
          attempt: (context.job && context.job.attempt) || 1,
          endpoint: row.id,
          event: args.event,
        },
        status: error.status || null,
      });

      if (error.gone) {
        await this.disable(row.id, {
          reason: 'the receiver answered 410 Gone',
        });
      }

      throw error;
    }
  }

  /**
   * Starts timing one delivery, when the application keeps a call log.
   *
   * The body is the envelope this package built, parsed back into the
   * object it was: the call log stores a body it can walk and redact, and
   * a JSON string is not one. What the receiver answered is deliberately
   * *not* recorded -- it is untrusted text nothing can redact, and the
   * queue's own job row already holds the excerpt an operator reads.
   *
   * @param {string} url Where the delivery goes
   * @param {object} args The job arguments
   * @param {object} sent The headers of the request
   * @returns {Function} The finisher (a no-op without a call log)
   * @memberof Webhooks
   */
  tracked(url, args, sent) {
    const { calls } = this.henri || {};

    if (!calls || !calls.enabled) {
      return () => null;
    }

    let body;

    try {
      body = JSON.parse(args.body);
    } catch (error) {
      body = null;
    }

    return calls.track({
      method: 'POST',
      request: { body, headers: sent },
      requestId: args.requestId || null,
      service: 'webhooks',
      url,
    });
  }

  /**
   * The endpoints and what the queue holds for them
   *
   * The delivery numbers are the queue's own: there is no second place they
   * could come from, and no second place to keep them in step.
   *
   * @returns {Promise<object>} `{ endpoints, queue, deliveries }`
   * @memberof Webhooks
   */
  async stats() {
    const [total, disabled] = await Promise.all([
      this.storeOrDie().count(),
      this.storeOrDie().count({ disabled: true }),
    ]);
    const { jobs } = this.henri || {};
    let deliveries = null;

    if (jobs && jobs.enabled) {
      const found = await jobs.stats();

      deliveries =
        found.queues.find((entry) => entry.queue === this.config.queue) || null;
    }

    return {
      deliveries,
      endpoints: { disabled, enabled: total - disabled, total },
      queue: this.config.queue,
    };
  }
}

module.exports = {
  CACHE_TTL,
  DELIVERY_JOB,
  EVENT,
  MAX_EVENTS,
  MAX_HEADERS,
  MAX_OWNER,
  PATTERN,
  RESERVED,
  Webhooks,
  subscribed,
};
