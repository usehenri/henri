const BaseModule = require('./base/module');

const debug = require('debug')('henri:calls');
const { randomUUID } = require('node:crypto');

const { check } = require('./base/arguments');
const { describeAddress } = require('./base/address');
const { fail } = require('./base/errors');
const { currentRequestId } = require('./base/request-id');
const { storeFor } = require('./base/call-store');
const {
  BUCKETS,
  Ceiling,
  actorOf,
  always,
  callsConfig,
  checkPartition,
  contextOf,
  hash32,
  outcomeOf,
  seedOf,
  toCall,
  toRow,
  track,
} = require('./base/calls');

/**
 * The call log: `henri.calls`, the calls an application answered and the
 * calls it made.
 *
 * The design -- why it is not the access trail, the four bounds that keep
 * it from being a denial of service, and exactly what the redaction refuses
 * -- is in the header of `base/calls.js`, and the storage, the partitions
 * and the sweep are in `base/call-store.js`. This is the module: it owns
 * the table, buffers, flushes, reads back and prunes.
 *
 * It is off unless `config.calls` says otherwise, and off means off: no
 * table is created, `2.server.js` mounts no middleware, and every entry
 * point here answers without allocating. Everything inside core that
 * records a call goes through `outbound()` or `track()`, which are no-ops
 * on a disabled log, so nothing in the framework has to ask first.
 *
 * @class Calls
 * @extends {BaseModule}
 */
class Calls extends BaseModule {
  /**
   * Creates an instance of Calls.
   * @memberof Calls
   */
  constructor() {
    super();

    this.reloadable = true;
    // The models are where the table lives, and the privacy map is what
    // says which field names are masked in a captured body
    this.needs = ['config', 'model'];
    this.after = ['privacy'];
    // The middleware is mounted by 2.server.js, but the router is what
    // turns a request into a route, and a row carries the route
    this.before = ['router'];
    this.runlevel = 4;
    this.name = 'calls';
    this.henri = null;

    /** `config.calls`, normalized */
    this.settings = callsConfig(null);
    /** Whether anything is being recorded */
    this.enabled = false;
    /** The backend (`base/call-store.js`), or null */
    this.store = null;
    /** The rows waiting to be written */
    this.buffer = [];
    /** The absolute per-process ceiling */
    this.ceiling = new Ceiling(0);
    /** The redaction context, built once rather than once per row */
    this.context = null;
    /** What the sampling hashes with */
    this.seed = 0;
    /** The flush timer */
    this.timer = null;
    /** The flush in flight, so two never interleave */
    this.flushing = null;
    /** What was written, and what was not */
    this.counters = { buffer: 0, failed: 0, rate: 0, written: 0 };
    /** Whether a failed flush has already been reported */
    this.complained = false;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
    this.finished = this.finished.bind(this);
    this.outbound = this.outbound.bind(this);
    this.track = this.track.bind(this);
    this.list = this.list.bind(this);
    this.about = this.about.bind(this);
    this.forPerson = this.forPerson.bind(this);
    this.forget = this.forget.bind(this);
    this.prune = this.prune.bind(this);

    debug('constructor initialized');
  }

  /**
   * Module initialization: prepares the table when the log is on
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @throws HENRI_CALLS_UNSUPPORTED_STORE when the store cannot hold it
   * @throws HENRI_CALLS_PARTITION_UNSUPPORTED on a dialect without ranges
   * @memberof Calls
   */
  async init() {
    const { config, pen } = this.henri;

    this.settings = callsConfig(config);

    if (!this.settings.enabled) {
      debug('no config.calls: nothing is recorded');

      return this.name;
    }

    const stores = (this.henri.model && this.henri.model.stores) || {};
    const adapter = stores[this.settings.store];

    if (!adapter) {
      throw fail(
        'HENRI_CALLS_UNSUPPORTED_STORE',
        `config.calls.store names "${this.settings.store}", which is not one of this application's stores`
      );
    }

    this.store = storeFor(adapter, this.settings);

    checkPartition(this.store.dialect, this.settings.partition);

    await this.store.install();

    this.context = contextOf(this.henri, this.settings);
    this.seed = seedOf(config);
    this.ceiling = new Ceiling(this.settings.maxPerSecond);
    this.enabled = true;

    this.timer = setInterval(() => {
      this.flush().catch(() => null);
    }, this.settings.flush);

    /* istanbul ignore else */
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    pen.info(
      'calls',
      `writing to ${this.settings.table}`,
      this.settings.partition
        ? `${this.settings.partition} partitions`
        : 'swept by deleting rows',
      `sample ${this.settings.sample}, at most ${this.settings.maxPerSecond}/s`,
      // Where an address comes from is a decision an operator has to be
      // able to read back without opening the configuration
      describeAddress(
        this.settings.address,
        config.has('trustProxy') ? config.get('trustProxy') : true
      )
    );

    return this.name;
  }

  /**
   * Rebuilds the module after a reload
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @memberof Calls
   */
  async reload() {
    await this.stop();

    return this.init();
  }

  /**
   * Writes what is buffered and stops the timer
   *
   * @async
   * @returns {Promise<string|boolean>} the module name, or false
   * @memberof Calls
   */
  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (!this.enabled) {
      return false;
    }

    await this.flush();

    this.enabled = false;
    this.store = null;
    this.buffer = [];

    return this.name;
  }

  /**
   * Is this request one of the sampled ones?
   *
   * A seeded hash of the request id rather than a coin flip, so the inbound
   * call and every outbound call it caused answer the same in every process
   * without carrying state. The seed is `config.secret`, because the
   * request id comes from a header a client can choose (`base/calls.js`
   * says more).
   *
   * @param {?string} requestId the id of the request
   * @returns {boolean} whether it is recorded
   * @memberof Calls
   */
  samples(requestId) {
    const { sample } = this.settings;

    if (sample >= 1) {
      return true;
    }

    if (sample <= 0) {
      return false;
    }

    if (typeof requestId !== 'string' || requestId === '') {
      return Math.random() < sample;
    }

    return (
      hash32(requestId, this.seed) % BUCKETS < Math.round(sample * BUCKETS)
    );
  }

  /**
   * The id of the request being handled, when there is one.
   *
   * The seam a package outside core reaches for: `@usehenri/webhooks`
   * stamps it into the delivery job it enqueues, so the delivery that goes
   * out ten seconds later still joins the request that caused it. It
   * answers whether or not the log is on, because it is a fact about the
   * request rather than about the log.
   *
   * @returns {?string} the id, or null outside a request
   * @memberof Calls
   */
  requestId() {
    return currentRequestId();
  }

  /**
   * Records one finished inbound call.
   *
   * Called from `res.on('close')`, so the answer is already on its way out
   * and nothing here is on the hot path. A request the sampling dropped is
   * still recorded when it matches `calls.always` -- without its bodies,
   * because the decision not to capture them was made before the status was
   * known and there is nothing to go back for.
   *
   * @param {object} req the request
   * @param {object} res the response
   * @param {object} state `at`, `started`, `body`, `keep`
   * @returns {boolean} whether a row was buffered
   * @memberof Calls
   */
  finished(req, res, state) {
    if (!this.enabled) {
      return false;
    }

    const aborted = res.writableFinished === false;
    const status = aborted ? null : res.statusCode;
    const outcome = outcomeOf({ aborted, status });

    if (!state.keep && !always({ outcome, status }, this.settings.always)) {
      return false;
    }

    const duration = Number(
      (process.hrtime.bigint() - state.started) / 1000000n
    );

    return this.record({
      actor: actorOf(req.user),
      // Read by the middleware, while the socket was still open
      address: state.address,
      at: state.at,
      direction: 'in',
      duration,
      id: randomUUID(),
      method: req.method,
      outcome,
      request: {
        body: state.keep ? req.body : null,
        headers: req.headers,
      },
      requestBytes: Number(req.headers['content-length']) || undefined,
      requestId: req.id || null,
      response: {
        body: state.keep ? state.body : null,
        headers: typeof res.getHeaders === 'function' ? res.getHeaders() : null,
      },
      responseBytes: Number(res.getHeader('content-length')) || undefined,
      route: req.route && req.route.path ? req.route.path : null,
      status,
      url: req.originalUrl || req.url,
    });
  }

  /**
   * Records one finished outbound call.
   *
   * The seam an application's own HTTP client goes through, and the one
   * henri's webhook deliveries and mail sends go through themselves. henri
   * wraps nobody's client: there is nothing to install.
   *
   * @param {object} call `service`, `method`, `url`, `status`, `duration`,
   *   `request`, `response`, `error`, `requestId`, `meta`
   * @returns {boolean} whether a row was buffered
   * @memberof Calls
   */
  outbound(call) {
    check('henri.calls.outbound', [call]);

    return this.write(call);
  }

  /**
   * The same, unchecked: what `track()`'s finisher calls, so one call is
   * not checked twice
   *
   * @param {object} call the call
   * @returns {boolean} whether a row was buffered
   * @memberof Calls
   */
  write(call) {
    if (!this.enabled || !this.settings.outbound) {
      return false;
    }

    const requestId =
      call.requestId === null ? null : call.requestId || currentRequestId();
    const row = {
      ...call,
      at: call.at || Date.now(),
      direction: 'out',
      id: randomUUID(),
      requestId,
    };

    if (this.samples(requestId)) {
      return this.record(row);
    }

    const outcome = call.outcome || outcomeOf(call);

    if (!always({ outcome, status: call.status }, this.settings.always)) {
      return false;
    }

    // Sampling said no and `calls.always` said yes: the row is written
    // without its bodies, which is the same answer the inbound half gives
    return this.record({
      ...row,
      request: { headers: call.request && call.request.headers },
      response: { headers: call.response && call.response.headers },
    });
  }

  /**
   * Times one outbound call: `const finish = calls.track({...})`, then
   * `finish({ status, headers, body })` when the answer arrives
   *
   * @param {object} details `service`, `method`, `url`, `request`
   * @returns {function} the finisher
   * @memberof Calls
   */
  track(details) {
    check('henri.calls.track', [details]);

    return track(this, details);
  }

  /**
   * Buffers one row.
   *
   * The two bounds of decision 4 live here: the per-second ceiling, then
   * the buffer itself. Neither of them throws and neither of them is
   * silent -- what they dropped is counted and `stats()` says so.
   *
   * @param {object} call the call
   * @returns {boolean} whether it was buffered
   * @memberof Calls
   */
  record(call) {
    if (!this.enabled) {
      return false;
    }

    if (!this.ceiling.take(call.at)) {
      this.counters.rate += 1;

      return false;
    }

    if (this.buffer.length >= this.settings.buffer) {
      this.counters.buffer += 1;

      return false;
    }

    try {
      this.buffer.push(toRow(call, this.context));
    } catch (error) {
      // A row henri cannot build is a row nobody gets: a call log must not
      // be able to fail the thing it was watching
      debug('unable to build a row: %s', error.message);
      this.counters.failed += 1;

      return false;
    }

    if (this.buffer.length >= this.settings.batch) {
      this.flush().catch(() => null);
    }

    return true;
  }

  /**
   * Writes what is buffered.
   *
   * Never rejects: a call log that can fail a request, a job or a shutdown
   * is a liability. A failure is counted, reported once, and the rows are
   * dropped rather than retried -- a retry queue for debugging rows is a
   * second thing to run out of memory.
   *
   * @async
   * @returns {Promise<number>} how many rows were written
   * @memberof Calls
   */
  async flush() {
    if (this.flushing) {
      return this.flushing;
    }

    if (!this.enabled || !this.store || this.buffer.length === 0) {
      return 0;
    }

    const rows = this.buffer;

    this.buffer = [];

    this.flushing = (async () => {
      try {
        // A process that ran past the periods created at boot would write
        // into the catch-all; topping the plan up here costs a number
        // comparison per flush and nothing at all when there are none
        if (this.store.covered && Date.now() >= this.store.covered) {
          await this.store.ensure();
        }

        await this.store.insert(rows);
        this.counters.written += rows.length;
        this.complained = false;

        return rows.length;
      } catch (error) {
        this.counters.failed += rows.length;

        if (!this.complained) {
          this.complained = true;
          this.henri.pen.warn(
            'calls',
            `unable to write ${rows.length} rows; they are dropped`,
            error.message
          );
        }

        return 0;
      } finally {
        this.flushing = null;
      }
    })();

    return this.flushing;
  }

  /**
   * The calls matching a filter
   *
   * @async
   * @param {object} [filter={}] `requestId`, `direction`, `service`,
   *   `actor`, `outcome`, `status`, `since`, `until`, `limit`, `offset`
   * @returns {Promise<Array<object>>} the calls
   * @memberof Calls
   */
  async list(filter = {}) {
    check('henri.calls.list', [filter]);

    const rows = await this.ready().list(this.filter(filter));

    return rows.map(toCall);
  }

  /**
   * How many calls match a filter
   *
   * @async
   * @param {object} [filter={}] the filter
   * @returns {Promise<number>} the count
   * @memberof Calls
   */
  async count(filter = {}) {
    check('henri.calls.count', [filter]);

    return this.ready().count(this.filter(filter));
  }

  /**
   * Everything that happened during one request: the call that came in and
   * every call that went out because of it, oldest first
   *
   * @async
   * @param {string} requestId the request id
   * @param {object} [filter={}] the rest of the filter
   * @returns {Promise<Array<object>>} the calls
   * @memberof Calls
   */
  async about(requestId, filter = {}) {
    check('henri.calls.about', [requestId, filter]);

    return this.list({ ...filter, requestId });
  }

  /**
   * A filter with its moments turned into milliseconds
   *
   * @param {object} filter the filter
   * @returns {object} the filter the store reads
   * @memberof Calls
   */
  filter(filter) {
    const moment = (value) =>
      typeof value === 'undefined' || value === null
        ? undefined
        : new Date(value).getTime();

    return {
      ...filter,
      since: moment(filter.since),
      until: moment(filter.until),
    };
  }

  /**
   * Everything the log holds about one person.
   *
   * The call log holds **values**, which is the whole difference between
   * it and the access trail: the trail can outlive an erasure because it
   * holds field names and digests, and this one cannot. So a person's rows
   * answer a data subject request like any other record about them --
   * `henri privacy:export` reads them here and `henri privacy:erase`
   * writes over them.
   *
   * A row is theirs when it carries their `externalId` as its `actor`,
   * which is the only join there is: an anonymous request is an address
   * and nothing henri can tie to a person.
   *
   * @async
   * @param {string} actor the person's `externalId`
   * @param {object} [filter={}] the rest of the filter (`limit`, `since`)
   * @returns {Promise<Array<object>>} their calls
   * @memberof Calls
   */
  async forPerson(actor, filter = {}) {
    check('henri.calls.forPerson', [actor, filter]);

    return this.list({ ...filter, actor });
  }

  /**
   * Takes one person out of the rows that named them.
   *
   * The row survives and the person does not: the `actor`, the two
   * addresses and the four payload columns are written over, and the
   * moment, the method, the url, the route, the status and the request id
   * are left, because a request did happen and that record names nobody.
   *
   * @async
   * @param {string} actor the person's `externalId`
   * @returns {Promise<number>} how many rows named them
   * @memberof Calls
   */
  async forget(actor) {
    check('henri.calls.forget', [actor]);

    await this.flush();

    return this.ready().forget(actor);
  }

  /**
   * Takes the calls past `config.calls.keep` away.
   *
   * Called by the retention sweep, the way the trail's prune is. Where the
   * dialect partitions, this drops whole periods and the rest is a bounded
   * delete over what is left; everywhere else it is only the delete.
   *
   * @async
   * @param {object} [options={}] `now`
   * @returns {Promise<object>} `{ removed, partitions, before }`
   * @memberof Calls
   */
  async prune(options = {}) {
    check('henri.calls.prune', [options]);

    const { now = Date.now() } = options;

    if (!this.enabled || !this.store || !this.settings.keep) {
      return { before: null, partitions: [], removed: 0 };
    }

    await this.flush();

    const before = now - this.settings.keep;
    const result = await this.store.sweep(before, {
      batch: this.settings.sweep,
      now,
    });

    return { before, ...result };
  }

  /**
   * What has been written, and what was dropped rather than written
   *
   * @async
   * @returns {Promise<object>} the counters, the buffer and the partitions
   * @memberof Calls
   */
  async stats() {
    if (!this.enabled || !this.store) {
      return {
        buffered: 0,
        dropped: { buffer: 0, failed: 0, rate: 0 },
        enabled: false,
        partitions: [],
        total: 0,
        written: 0,
      };
    }

    return {
      buffered: this.buffer.length,
      dropped: {
        buffer: this.counters.buffer,
        failed: this.counters.failed,
        rate: this.counters.rate,
      },
      enabled: true,
      partitions: await this.store.partitions(),
      total: await this.store.count(),
      written: this.counters.written,
    };
  }

  /**
   * The backend, or a readable error
   *
   * @returns {object} the backend
   * @throws HENRI_CALLS_DISABLED when nothing is being recorded
   * @memberof Calls
   */
  ready() {
    if (!this.enabled || !this.store) {
      const error = fail(
        'HENRI_CALLS_DISABLED',
        'this application keeps no call log, so there is nothing to read back'
      );

      error.hint =
        'Turn it on with "calls": {} in config/<env>.json; henri creates its table on the next boot';

      throw error;
    }

    return this.store;
  }
}

module.exports = Calls;
