const BaseModule = require('./base/module');

const debug = require('debug')('henri:queries');

const {
  Detector,
  bucketOf,
  callsiteOf,
  currentRequestId,
  describe,
  keysOf,
  nested,
  outermost,
  queriesConfig,
  rowsOf,
  shapeOf,
} = require('./base/queries');
const { fail } = require('./base/errors');

/**
 * `henri.queries`: what the adapters ran, and the N+1 that follows from it.
 *
 * The design -- why the seam is at the model call and not at the statement,
 * what an event carries and what it refuses, and why the threshold counts
 * model calls rather than statements -- is in the header of
 * `base/queries.js`. This is the module: the adapters call `record()`, the
 * detector counts, and this decides where a finding goes.
 *
 * It sits at runlevel 0, with the configuration, for the same reason
 * telemetry does: everything that *installs* the instrumentation is above it.
 * The three adapters ask `henri.queries.enabled` once, while they are
 * building their models, and install nothing when the answer is no.
 *
 * ## Where a finding goes, and why each one is there
 *
 * Three destinations, each opting out on its own, and one that was
 * considered and refused:
 *
 * - **The log** (`detect.log`, on). One `pen.warn` per request, at the end,
 *   naming the call, the count, the line and what to do instead. This is the
 *   one a developer actually reads, and end-of-request is when the count is
 *   final: a warning at the moment the threshold is crossed would say "5
 *   times" about something that ran forty.
 * - **A response header** (`detect.header`, on, development only). `X-Henri-
 *   Queries: 47; n+1 Track.findById x40`. It carries counts and the names of
 *   models and methods -- the application's own vocabulary, never a value --
 *   and it exists because a header is what a devtool, a browser extension or
 *   an Inertia dev overlay can read without henri shipping a UI. It is
 *   refused outside development, where an internal count is nobody's
 *   business.
 * - **A thrown error** (`detect.raise`, off). `HENRI_QUERIES_N_PLUS_ONE`,
 *   thrown at the moment the threshold is crossed rather than at the end of
 *   the request, because the point of raising is the stack: the developer
 *   wants the frame that made the fortieth call, not a summary. This is what
 *   turns the detector into a test-suite gate, which is what `Bullet.raise =
 *   true` is for in a Rails suite.
 *
 * **The reporter is not one of them.** `henri.reporter` is the seam for
 * failures henri caught (`base/reporting.js` says so in its own header), and
 * an N+1 is not a failure -- it is an answer that was slower than it needed
 * to be. Sending one there would put a performance note in the same stream as
 * the 500s, and the application that wired Sentry to page someone would be
 * paged for a slow page. An application that wants that anyway has
 * `onQuery()` and four lines.
 *
 * `henri doctor` is not one either, for a duller reason: it does not boot the
 * application and cannot run a request, so it has nothing to count. What it
 * can say -- that the detector is configured on in production -- is
 * `henri audit`'s job, and that is where it is.
 *
 * @class Queries
 * @extends {BaseModule}
 */
class Queries extends BaseModule {
  /**
   * Creates an instance of Queries.
   * @memberof Queries
   */
  constructor() {
    super();

    this.name = 'queries';
    this.runlevel = 0;
    this.needs = ['config'];
    // Naming `config` replaces the number, so everything that installs the
    // instrumentation has to be named too: the model module builds the
    // adapters and the server mounts the middleware. A module that is not
    // there is ignored, which is why this is `before` and not `needs`
    this.before = ['model', 'router', 'server'];
    this.reloadable = true;
    this.henri = null;

    /** `config.queries`, normalized */
    this.settings = { callsites: false, detect: false, enabled: false };
    /** Whether anything is recorded at all */
    this.enabled = false;
    /** Whether an event carries the line it was made on */
    this.callsites = false;
    /** The detector, when one is wanted */
    this.detector = null;
    /** The handler `onQuery()` registered, if any */
    this._handler = null;
    /** What was seen, for `stats()` and for the header */
    this.counters = { events: 0, findings: 0, requests: 0 };

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.record = this.record.bind(this);
    this.onQuery = this.onQuery.bind(this);
    this.middleware = this.middleware.bind(this);
  }

  /**
   * Module initialization
   *
   * @returns {string} The name of the module
   * @memberof Queries
   */
  init() {
    this.build();

    return this.name;
  }

  /**
   * Reads the configuration back, and says what it decided
   *
   * @returns {object} The settings
   * @memberof Queries
   */
  build() {
    const { config, pen } = this.henri;

    this.settings = queriesConfig(config, this.henri.isProduction);
    this.enabled = this.settings.enabled;
    this.callsites = this.settings.callsites;
    this.detector = this.settings.detect
      ? new Detector(this.settings.detect)
      : null;

    debug('enabled=%s detect=%s', this.enabled, Boolean(this.detector));

    // A boot line only when there is something to say. An application that
    // is not counting has nothing to read, and a line saying so on every
    // production boot is noise
    if (this.enabled && this.detector) {
      pen.info(
        'queries',
        `counting model calls; the same call ${this.settings.detect.threshold} times in one request is reported`,
        this.settings.detect.raise ? '(and raises)' : ''
      );
    } else if (this.enabled) {
      pen.info('queries', 'recording model calls; nothing is detected');
    }

    return this.settings;
  }

  /**
   * Reloads the configuration.
   *
   * What it cannot do is install or uninstall the adapters' hooks: those were
   * decided when the models were built, and a model module reload is what
   * changes them. Turning the seam on in a running process therefore needs a
   * restart, and saying so is better than half-working.
   *
   * @returns {string} The name of the module
   * @memberof Queries
   */
  reload() {
    const before = this.enabled;

    this.build();

    if (before !== this.enabled) {
      this.henri.pen.warn(
        'queries',
        'config.queries changed; the adapters keep the instrumentation they were built with until a restart'
      );
    }

    return this.name;
  }

  /**
   * Register the handler every query event is given to.
   *
   * One handler: registering another replaces it, `null` removes it. It
   * follows `henri.reporter.onError()` and `henri.mailers.onDeliverLater()`
   * -- one rather than a list, because two handlers means an order and an
   * order means a contract about it.
   *
   * It is called synchronously, inside the call it describes, so a handler
   * that blocks blocks a query. A handler that throws is logged once and
   * removed: this is a development instrument and it does not get to break
   * the application it is measuring.
   *
   * @param {?function} handler The handler, or null to remove it
   * @returns {boolean} success
   * @memberof Queries
   */
  onQuery(handler) {
    if (handler !== null && typeof handler !== 'function') {
      this.henri.pen.error('queries', 'the query handler must be a function');

      return false;
    }

    this._handler = handler;

    return true;
  }

  /**
   * One model call, as the adapters report it.
   *
   * This is the hot path and the only method the adapters call. It is never
   * reached on a disabled seam, because a disabled seam is not installed --
   * there is no early return here doing the work of a flag.
   *
   * The adapter passes what it knows and this fills in what is henri's: the
   * duration, the shape, the request id and the line. The filter arrives as
   * the application wrote it and `keysOf()` takes its key names; the values
   * never leave this call.
   *
   * @param {object} query What the adapter ran
   * @param {string} query.adapter `drizzle`, `mongoose` or `sequelize`
   * @param {string} query.operation One of `OPERATIONS`
   * @param {string} query.method The adapter's own name for it
   * @param {?string} query.model The model, or null for a raw query
   * @param {*} [query.filter] The filter, for its key names only
   * @param {?number} [query.rows] How many rows came back
   * @param {number} query.started `performance.now()` when it began
   * @param {?Error} [query.at] An Error captured at the call site
   * @param {string} [query.source='application'] Who asked
   * @param {?string} [query.store] The store name
   * @param {?string} [query.dialect] The dialect, on SQL
   * @returns {?object} The event, or null when nothing was recorded
   * @memberof Queries
   */
  record(query) {
    const duration = performance.now() - query.started;
    const keys = query.filter ? keysOf(query.filter) : [];
    const event = {
      adapter: query.adapter,
      at: Date.now(),
      callsite: this.callsites ? callsiteOf(query.at, this.henri.cwd()) : null,
      dialect: query.dialect || null,
      duration,
      keys,
      method: query.method,
      model: query.model || null,
      operation: query.operation,
      requestId: currentRequestId(),
      rows: typeof query.rows === 'number' ? query.rows : null,
      shape: shapeOf({
        adapter: query.adapter,
        keys,
        model: query.model,
        operation: query.operation,
      }),
      source: query.source || 'application',
      store: query.store || null,
    };

    this.counters.events += 1;

    if (this.detector) {
      this.watch(event);
    }

    if (this._handler) {
      this.hand(event);
    }

    return event;
  }

  /**
   * Wraps a set of methods so that each call reports itself.
   *
   * This is the one API the adapters use, and it exists so that "what a model
   * call is" is decided once, in core, rather than three times in three
   * packages that would drift. An adapter says which methods of which object
   * are model calls and what each one means; everything else -- the nesting
   * rule, the timing, the row count, the filter's key names, the call site --
   * happens here.
   *
   *     henri.queries.instrument(Klass, {
   *       findById: { filter: (args) => ({ id: args[0] }), operation: 'select' },
   *       create: { operation: 'insert' },
   *     }, { adapter: 'drizzle', dialect: 'postgres', model: 'Proposal' });
   *
   * A spec entry takes `operation` (one of `OPERATIONS`), an optional
   * `method` (the reported name, defaulting to the key), an optional `filter`
   * reading the arguments for their **key names**, and an optional `rows`
   * reading the answer for a count.
   *
   * It is never called on a disabled seam: the adapters ask `enabled` first,
   * and an application that is not counting has its methods untouched.
   *
   * ## Two kinds of target, and why the second one needs care
   *
   * A per-model class is the easy case: it belongs to one adapter, which
   * belongs to one henri, and closing over this module is right.
   *
   * A **shared prototype** is not. `Relation.prototype` in the Drizzle
   * adapter is one object for every model of every store in the process, and
   * a test suite boots several henri instances into that process. A wrapper
   * that closed over the first one would report a second instance's queries
   * to the first instance's detector, which is a wrong answer rather than a
   * missing one. So `context.queries` may be a **function of the receiver**
   * that finds the right module at call time (`(self) =>
   * self.Model.adapter.henri.queries`), and `context.once` is a key on the
   * target that keeps a second instance from wrapping what the first already
   * wrapped. A resolved module that is disabled calls straight through.
   *
   * @param {object} target The object holding the methods (a class, a prototype)
   * @param {object} spec What each method means
   * @param {object} context `{ adapter, dialect, store, model, queries, once }`;
   *   `model` and `queries` may be functions of the receiver, for a prototype
   *   shared by every model
   * @returns {object} The same target
   * @memberof Queries
   */
  instrument(target, spec, context) {
    const owner = this;
    const resolve =
      typeof context.queries === 'function' ? context.queries : () => owner;

    if (context.once) {
      if (target[context.once]) {
        return target;
      }

      Object.defineProperty(target, context.once, { value: true });
    }

    for (const name of Object.keys(spec)) {
      const original = target[name];

      if (typeof original !== 'function') {
        continue;
      }

      const entry = spec[name];
      const method = entry.method || name;
      const { operation } = entry;

      /**
       * The instrumented method
       *
       * @param {...*} args Whatever the caller passed
       * @returns {*} Whatever the method answers
       */
      function measured(...args) {
        const queries = resolve(this);

        // A layer of a call already being measured: call through, add
        // nothing. `Model.findById()` is one event, not three. A henri whose
        // seam is off calls through for the same price
        if (!queries || !queries.enabled || nested()) {
          return original.apply(this, args);
        }

        const started = performance.now();
        // Allocated, never formatted: callsiteOf() reads .stack only when a
        // shape is actually reported
        const at = queries.callsites ? new Error('query') : null;
        // Everything that identifies the store may be a function of the
        // receiver, because a shared prototype answers for several of them
        const self = this;
        /**
         * One field of the context, read off the receiver when it varies
         *
         * @param {*} value What the adapter declared
         * @returns {*} The value for this call
         */
        const of = (value) =>
          typeof value === 'function' ? value(self) : value;
        const model = of(context.model);
        /**
         * Reports the finished call
         *
         * @param {*} answer What it resolved with
         * @returns {void}
         */
        const done = (answer) => {
          queries.record({
            adapter: of(context.adapter),
            at,
            dialect: of(context.dialect),
            filter: entry.filter ? entry.filter(args) : null,
            method,
            model,
            operation,
            rows: entry.rows ? entry.rows(answer) : rowsOf(answer),
            source: context.source,
            started,
            store: of(context.store),
          });
        };

        return outermost(() => {
          let answer;

          try {
            answer = original.apply(this, args);
          } catch (error) {
            done(null);

            throw error;
          }

          if (answer && typeof answer.then === 'function') {
            return answer.then(
              (value) => {
                done(value);

                return value;
              },
              (error) => {
                done(null);

                throw error;
              }
            );
          }

          done(answer);

          return answer;
        });
      }

      target[name] = measured;
    }

    return target;
  }

  /**
   * Counts an event, and raises the moment the threshold is crossed.
   *
   * Raising here rather than at the end of the request is the whole point of
   * raising: the stack of this throw is the call that went one too far, which
   * is the line the developer is looking for.
   *
   * @param {object} event The event
   * @returns {void}
   * @throws {Error} `HENRI_QUERIES_N_PLUS_ONE` when `detect.raise` is set
   * @memberof Queries
   */
  watch(event) {
    const entry = this.detector.count(event);

    if (
      !entry ||
      !this.settings.detect.raise ||
      entry.count !== this.detector.threshold
    ) {
      return;
    }

    throw fail(
      'HENRI_QUERIES_N_PLUS_ONE',
      `${describe(entry)} (config.queries.detect.raise)`
    );
  }

  /**
   * Hands an event to the application's handler, which is not trusted
   *
   * @param {object} event The event
   * @returns {void}
   * @memberof Queries
   */
  hand(event) {
    try {
      this._handler(event);
    } catch (error) {
      this._handler = null;
      this.henri.pen.error(
        'queries',
        'the query handler threw and was removed',
        error.message
      );
    }
  }

  /**
   * What has been seen since the boot
   *
   * @returns {object} `{ enabled, detecting, events, findings, requests }`
   * @memberof Queries
   */
  stats() {
    return {
      detecting: Boolean(this.detector),
      enabled: this.enabled,
      ...this.counters,
    };
  }

  /**
   * The express middleware: one report per request, or none at all.
   *
   * Mounted by `2.server.js` only when there is a detector, so an application
   * that records without detecting has nothing in its stack. It does no work
   * on the way in: the bucket is made by the first query, in
   * `base/queries.js`, on the request-id store that already exists.
   *
   * @returns {?function} The middleware, or null when nothing detects
   * @memberof Queries
   */
  middleware() {
    if (!this.detector) {
      return null;
    }

    const { header, log } = this.settings.detect;
    // A header has to be written before the headers go out, and express
    // gives no hook for that. Wrapping writeHead is the smallest thing that
    // works on both an express response and a raw one, and it is undone by
    // the response ending
    const wantsHeader = header && this.henri.isDev;

    return (req, res, next) => {
      this.counters.requests += 1;

      if (wantsHeader) {
        const writeHead = res.writeHead.bind(res);

        res.writeHead = (...args) => {
          const line = this.summarize();

          if (line && !res.headersSent) {
            res.setHeader('X-Henri-Queries', line);
          }

          return writeHead(...args);
        };
      }

      if (log) {
        res.on('finish', () => this.complain(req));
      }

      next();
    };
  }

  /**
   * The header line: counts and names, and nothing else.
   *
   * Everything in it is a number henri measured or a name the application
   * chose for one of its own models, which is the rule of `base/reporting.js`
   * applied to a header. No filter value, no path and no identifier reaches
   * it.
   *
   * @returns {?string} The line, or null when there is nothing to say
   * @memberof Queries
   */
  summarize() {
    const bucket = bucketOf(false);

    if (!bucket || bucket.size === 0) {
      return null;
    }

    let total = 0;

    for (const entry of bucket.values()) {
      total += entry.count;
    }

    const parts = [`${total}`];

    for (const finding of this.detector.findings(bucket).slice(0, 3)) {
      parts.push(
        `n+1 ${finding.model || 'query'}.${finding.method} x${finding.count}`
      );
    }

    return parts.join('; ');
  }

  /**
   * One warning per request, at the end, when something repeated
   *
   * @param {object} req The express request
   * @returns {number} How many findings there were
   * @memberof Queries
   */
  complain(req) {
    const findings = this.detector.findings(bucketOf(false));

    if (findings.length === 0) {
      return 0;
    }

    this.counters.findings += findings.length;

    const where = req.route
      ? `${req.method} ${req.baseUrl || ''}${req.route.path}`
      : req.method;

    for (const finding of findings) {
      this.henri.pen.warn('queries', where, describe(finding));
    }

    return findings.length;
  }
}

module.exports = Queries;
