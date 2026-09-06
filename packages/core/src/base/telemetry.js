/**
 * OpenTelemetry, when somebody is listening.
 *
 * henri answers three observability questions already, and each of them
 * from one process: `pen` says what happened (`base/logs.js`),
 * `henri.reporter` says what failed (`base/reporting.js`) and
 * `henri.analyze()` says what the boot did. None of them says where the
 * time went inside one request, and none of them follows that request into
 * the queue, the mail transport or a webhook receiver. A trace does, and
 * OpenTelemetry is the only vendor neutral way to hand one to whatever the
 * deployment already runs.
 *
 * ## What henri ships, and what it deliberately does not
 *
 * `@opentelemetry/api` is a **peer dependency, and never a hard one**. It is
 * the interface -- a tracer, a meter, a propagator, and a global registry
 * for whoever implements them. henri ships **no SDK, no exporter, no
 * sampler, no resource, no collector configuration and no endpoint**: those
 * belong to the application and to the deployment, which know the service
 * name, the environment, the collector's address and how much of the
 * traffic they can afford to keep. The guide (`guides/telemetry.md`) shows
 * the smallest bootstrap that works, and it is the application's file.
 *
 * **An application that does not install the api pays nothing**, and
 * "nothing" here is not a flag tested on the request path. Nothing is
 * installed at all: the middleware is not mounted (`2.server.js`), the
 * adapter is not wrapped (`3.model.js`), no instrument is created, no
 * handler is registered, and `@opentelemetry/api` is never required. There
 * is no boot line either, because there is nothing to say. That is the
 * shape to keep for anything added here: **instrument at install time,
 * never branch on the hot path.**
 *
 * ## What a span carries, and what it never carries
 *
 * The rule is `base/reporting.js`', word for word, and the reason it is
 * repeated rather than relaxed is that a span attribute is a log field with
 * a different name on it: **everything henri adds is either henri's own or
 * an identifier that means nothing on its own.** The method and the *route
 * pattern* (`GET /artworks/:id`) are what the application declared and henri
 * matched, the status is henri's answer, the request id is a uuid.
 *
 * Nothing that came from the client is in a span: no url, no path, no query
 * string, no body, no parameters, no headers, no cookies, no session, no
 * user, no SQL text, no mail recipient, no job arguments and no webhook
 * body. `requestOf()` -- the reporter's own function -- is what the request
 * span asks for its fields, so the two cannot drift apart: adding a field
 * there adds it in both places, on purpose, and under one review.
 *
 * That is a **deliberate departure from the HTTP semantic conventions**,
 * which ask a server span for `url.path` and offer `url.query`,
 * `client.address` and `user_agent.original` beside it. henri does not send
 * them, for the reason the reporter gives: `/users/ada@example.com` is a
 * path in some applications and a personal field in all of them, and a
 * trace backend is one more place it would then live. An application that
 * wants them adds them inside a span of its own, having decided that for
 * its own paths.
 *
 * The one thing henri hands over unexamined is an **error**, exactly as the
 * reporter does: `recordException()` gets the application's Error, because
 * a framework that rewrote it would be recording something that never
 * happened.
 *
 * Attributes an *application* passes to `span()` go through the masking of
 * `base/redact.js` -- `filterParameters` as substrings, the fields the
 * models marked `personal` exactly -- the way `report()`'s `meta` does.
 * henri's own attributes skip it, because henri chose every one of them.
 *
 * ## The boundaries henri knows
 *
 * One span per request, and children only where henri already knows a
 * boundary without reaching into somebody else's driver:
 *
 * - `http` -- the request. `<METHOD> <route pattern>`, kind SERVER. Named
 *   for the method alone until the router has matched, then renamed: a span
 *   named for a url is a cardinality accident, and a span named for a url
 *   with an id in it is the leak above.
 * - `boot` -- `henri.boot` and a child per module, **reconstructed from
 *   `henri.analyze()` once the boot is over**, with the timings it already
 *   measured. Nothing is timed twice and nothing runs during the boot: the
 *   spans are written afterwards with explicit start and end times, which
 *   is what `startSpan({ startTime })` is for. A boot that failed is
 *   emitted too, with the module that failed carrying the error.
 * - `stores` -- `adapter.query()`, the one store call henri makes on its own
 *   behalf (the queue's claim, the trail's insert, a webhook lookup). The
 *   statement is *not* an attribute: it carries values.
 * - `views` -- `view.engine.render()`.
 * - `mail` -- `henri.mail.send()`.
 * - `jobs` -- one span per job run, in `@usehenri/jobs`.
 * - `webhooks` -- one span per delivery attempt, in `@usehenri/webhooks`.
 *
 * **A model call an application makes is not one of them**, and that is the
 * honest gap: covering it means wrapping Drizzle, Mongoose and Sequelize
 * from the outside, which is what their own instrumentation packages exist
 * for. An application that wants it registers
 * `@opentelemetry/instrumentation-pg` (or its ORM's) in the same SDK
 * bootstrap, and those spans land under henri's request span, because the
 * context is already active when the query runs.
 *
 * ## Propagation, and which identifier wins
 *
 * An incoming `traceparent` is honoured through `propagation.extract()`, so
 * a request that arrives inside somebody else's trace continues it rather
 * than starting a second one. Outgoing, `inject()` writes the current
 * context into a header bag, which is how a webhook delivery carries the
 * trace of whatever emitted it.
 *
 * `traceparent` and `X-Request-Id` are both present on a well-run request
 * and **neither is derived from the other**:
 *
 * - `traceparent` decides the **trace**. It is a caller's statement about a
 *   span it has already created; inventing a trace id from a request id
 *   would orphan the parent that is waiting for us.
 * - `X-Request-Id` decides the **request id**, as it always did
 *   (`base/request-id.js`). It is what a load balancer stamped and what
 *   every `pen` line already carries.
 *
 * The span carries the request id as `henri.request_id`, which is the join
 * between the two and costs one attribute. henri does **not** fall back to
 * the trace id when no `X-Request-Id` arrives: a trace usually spans
 * several requests, so a trace id is not unique per request and using it
 * would quietly merge two requests' logs into one.
 *
 * `traceparent` is not written onto the **response** either. It would hand
 * an internal identifier to whoever asked; `X-Request-Id` is the identifier
 * henri already hands out, and it is enough to find the trace from a log
 * line.
 *
 * ## The metrics, and only these
 *
 * A log line already carries what happened; a metric is worth having only
 * when the answer is a rate or a distribution nobody can afford to compute
 * from lines:
 *
 * - `http.server.request.duration` -- a histogram, in seconds, by method,
 *   route and status. Its **count is the request count**, which is why
 *   there is no counter beside it: the same number twice is two things to
 *   keep in step.
 * - `henri.jobs.queue.depth` -- an observable gauge, by queue and state.
 * - `henri.jobs.claim.duration` -- a histogram: how long claiming took,
 *   which is the number that says a queue is contended.
 * - `henri.cache.operations` -- an observable counter by outcome (`hit`,
 *   `miss`, `write`, `error`), read straight off the counters
 *   `henri.cache.stats()` already keeps. The hit rate is hits over hits
 *   plus misses, computed where it is read.
 *
 * The last two are free on the hot path by construction: they are
 * **observable** instruments, so nothing is recorded while a request runs
 * and the callback reads counters that already existed.
 *
 * ## When the exporter is down, or slow
 *
 * The cache's rule is the precedent: a backend that is down is a miss,
 * because a cache holds no truth. A tracer that is down is a **dropped
 * span**, because a trace is not the request. henri makes that true by
 * owning none of the pipeline:
 *
 * - **Nothing is ever awaited.** `span.end()` hands the span to the SDK's
 *   span processor and returns; henri never calls `forceFlush()`, never
 *   waits on an export and never joins the SDK's shutdown.
 * - **Nothing is buffered here.** henri keeps no queue, no map of open
 *   spans and no retry: the only reference to a span is the local variable
 *   of the operation that made it, and every one of them ends in a
 *   `finally` or when `res` closes. A batching processor's bounded queue is
 *   where a slow exporter is absorbed, and dropping there is the SDK's
 *   documented behaviour.
 * - **A sampled-out span costs an object.** The api answers a
 *   non-recording span, whose `setAttribute` and `end` do nothing, so a
 *   sampler set to 1% is a 1% cost.
 * - **A tracer that throws cannot fail a request.** Every call into the api
 *   is guarded; the first failures are logged, and after `MAX_FAILURES` of
 *   them telemetry turns itself off for the life of the process and says so
 *   once. An instrumentation that is misbehaving is worth less than the
 *   traffic it is instrumenting.
 *
 * @module base/telemetry
 */

const { check } = require('./arguments');
const { fail } = require('./errors');
const { redactor } = require('./redact');
const { requestOf } = require('./reporting');

/** The package that carries the interface; henri never ships an SDK */
const PACKAGE = '@opentelemetry/api';

/** The instrumentation scope every span and instrument of henri's is under */
const SCOPE = 'henri';

/** The boundaries henri knows, and what `telemetry.spans` accepts */
const BOUNDARIES = Object.freeze([
  'boot',
  'http',
  'jobs',
  'mail',
  'stores',
  'views',
  'webhooks',
]);

/** How many failures of the api it takes before henri stops calling it */
const MAX_FAILURES = 5;

/** `SpanKind`, by name, so a missing api is never a missing constant */
const KINDS = Object.freeze({
  client: 3,
  consumer: 5,
  internal: 0,
  producer: 4,
  server: 1,
});

/** `SpanStatusCode.ERROR` */
const ERROR = 2;

/**
 * The methods that are their own attribute value. Anything else is
 * `_OTHER`, which is what the HTTP conventions ask for and what keeps a
 * scanner from inventing one metric dimension per request.
 */
const METHODS = new Set([
  'CONNECT',
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
  'TRACE',
]);

/** What the whole thing is when `config.telemetry` is `false` */
const OFF = Object.freeze({
  enabled: false,
  metrics: false,
  propagate: false,
  required: false,
  spans: Object.freeze([]),
});

/**
 * `config.telemetry`, normalized
 *
 * `enabled` absent is the interesting case, and the default one: telemetry
 * is on when `@opentelemetry/api` resolves from the application and off
 * when it does not, which is what makes installing the package the whole
 * opt-in. `enabled: true` says the application requires it, and a boot
 * without the package then fails rather than going quiet.
 *
 * @param {object} config the config module
 * @returns {object} `{ enabled, metrics, propagate, required, spans }`
 */
function telemetryConfig(config) {
  const reads =
    config &&
    typeof config.has === 'function' &&
    typeof config.get === 'function';
  const raw = reads && config.has('telemetry') ? config.get('telemetry') : {};

  if (raw === false) {
    return OFF;
  }

  const given = raw && typeof raw === 'object' ? raw : {};
  const asked = given.spans;
  let spans = [...BOUNDARIES];

  if (asked === false) {
    spans = [];
  } else if (Array.isArray(asked)) {
    spans = BOUNDARIES.filter((boundary) => asked.includes(boundary));
  }

  return {
    enabled: given.enabled !== false,
    metrics: given.metrics !== false,
    propagate: given.propagate !== false,
    required: given.enabled === true,
    spans,
  };
}

/**
 * The failure a boot that asked for telemetry it does not have raises
 *
 * @param {string} reason what went wrong
 * @returns {Error} the error, coded
 */
function unavailable(reason) {
  const error = fail(
    'HENRI_TELEMETRY_UNAVAILABLE',
    `telemetry is enabled but ${reason}`
  );

  error.hint = `Add the interface with: npm install ${PACKAGE} -- henri ships no SDK, so the exporter is the application's own (see /guides/telemetry/). Leave "telemetry.enabled" out to instrument only when the package is there, or set "telemetry": false.`;

  return error;
}

/**
 * The telemetry of an application, or the refusal to pretend
 *
 * The one decision `0.telemetry.js` does not make itself: it knows where
 * the api comes from, this knows what to do when it is not there. An
 * application that only said "instrument if you can" gets a Telemetry that
 * does nothing; one that said `enabled: true` gets a failed boot, because
 * a deployment that requires tracing would rather not start than start
 * blind.
 *
 * @param {object} options `api`, `henri` and `settings`
 * @returns {Telemetry} the telemetry
 * @throws when the settings require an api and there is none
 */
function createTelemetry({ api = null, henri = null, settings = OFF } = {}) {
  if (settings.required && !api) {
    throw unavailable(`${PACKAGE} is not installed`);
  }

  return new Telemetry({ api, henri, settings });
}

/** Reading an incoming header bag, for `propagation.extract()` */
const GETTER = {
  /**
   * The value of one header
   *
   * @param {object} carrier the headers
   * @param {string} key the header name, lowercased
   * @returns {(string|undefined)} the value
   */
  get: (carrier, key) => (carrier ? carrier[key] : undefined),

  /**
   * Every header name
   *
   * @param {object} carrier the headers
   * @returns {Array<string>} the names
   */
  keys: (carrier) => (carrier ? Object.keys(carrier) : []),
};

/**
 * An attribute value a span may carry, or undefined
 *
 * OpenTelemetry takes a string, a number, a boolean, or a homogeneous list
 * of those. Anything else is dropped rather than stringified: an `[object
 * Object]` in a trace backend is a field nobody can query and a shape
 * nobody meant to send.
 *
 * @param {*} value what the caller passed
 * @returns {*} the value, or undefined when it is not one
 */
function attributeValue(value) {
  const kind = typeof value;

  if (kind === 'string' || kind === 'boolean') {
    return value;
  }

  if (kind === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    const items = value.filter(
      (item) => typeof attributeValue(item) !== 'undefined'
    );

    return items.length === value.length ? items : undefined;
  }

  return undefined;
}

/**
 * An object as span attributes: the values a span may carry, and no others
 *
 * @param {*} source what the caller passed
 * @returns {?object} the attributes, or null when there are none
 */
function attributesOf(source) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const found = {};
  let count = 0;

  for (const [key, value] of Object.entries(source)) {
    const kept = attributeValue(value);

    if (typeof kept !== 'undefined') {
      found[key] = kept;
      count += 1;
    }
  }

  return count > 0 ? found : null;
}

/**
 * The method as an attribute: one of the nine, or `_OTHER`
 *
 * @param {*} method what the request called itself
 * @returns {string} the value
 */
function methodOf(method) {
  const name = typeof method === 'string' ? method.toUpperCase() : '';

  return METHODS.has(name) ? name : '_OTHER';
}

/**
 * Telemetry: the spans and the metrics henri emits, when an api is there.
 *
 * Built by `0.telemetry.js`, which is the only thing that knows where
 * `@opentelemetry/api` comes from. Everything this does with one is here,
 * and everything it refuses to do is in the header.
 *
 * @class Telemetry
 */
class Telemetry {
  /**
   * Creates an instance of Telemetry.
   *
   * @param {object} [options={}] options
   * @param {?object} [options.api] `@opentelemetry/api`, or null
   * @param {?object} [options.henri] the henri instance
   * @param {object} [options.settings] what `telemetryConfig()` answered
   * @memberof Telemetry
   */
  constructor({ api = null, henri = null, settings = OFF } = {}) {
    this.henri = henri;
    this.name = 'telemetry';
    this.settings = settings;

    /** The api, when the application has it and the settings want it */
    this.api = settings.enabled ? api || null : null;
    /** The tracer, or null when no span is wanted */
    this.tracer = null;
    /** The meter, or null when the metrics are off */
    this.meter = null;
    /** How many times the api has thrown at us */
    this.failures = 0;
    /** The instruments, by name, so each one is built once */
    this.instruments = new Map();

    if (!this.api) {
      return;
    }

    const version = this.version();

    this.tracer =
      settings.spans.length > 0 && this.api.trace
        ? this.api.trace.getTracer(SCOPE, version)
        : null;
    this.meter =
      settings.metrics && this.api.metrics
        ? this.api.metrics.getMeter(SCOPE, version)
        : null;
  }

  /**
   * Is anything instrumented?
   *
   * @readonly
   * @returns {boolean} true when a tracer or a meter is there
   * @memberof Telemetry
   */
  get enabled() {
    return Boolean(this.tracer || this.meter);
  }

  /**
   * The boundaries this instance instruments
   *
   * @readonly
   * @returns {Array<string>} the names, a subset of `BOUNDARIES`
   * @memberof Telemetry
   */
  get spans() {
    return this.tracer ? this.settings.spans : [];
  }

  /**
   * The version of henri the instrumentation scope carries
   *
   * @returns {?string} the version, when it can be read
   * @memberof Telemetry
   */
  version() {
    try {
      return require('../../package.json').version || null;
    } catch (error) {
      /* istanbul ignore next */
      return null;
    }
  }

  /**
   * Is this boundary instrumented?
   *
   * The one question every call site asks, and the one that decides whether
   * an instrumentation is *installed* -- not whether it runs.
   *
   * @param {string} boundary one of `BOUNDARIES`
   * @returns {boolean} true when spans of that boundary are wanted
   * @memberof Telemetry
   */
  on(boundary) {
    return Boolean(this.tracer) && this.settings.spans.includes(boundary);
  }

  /**
   * Run something inside a span
   *
   * The entry point an application uses, and the shape henri's own call
   * sites use for the boundaries that are not a middleware. Without a
   * tracer it calls the function and does nothing else.
   *
   * The span ends when the function returns, or when the promise it
   * answered settles. A failure is recorded on the span and rethrown
   * untouched: this observes, it does not handle.
   *
   * `boundary` is how henri's own call sites say which of `BOUNDARIES` they
   * are, so `telemetry.spans` can turn them off one at a time. An
   * application's span names none and follows the tracer.
   *
   * @param {string} name the span name
   * @param {(object|function)} [options={}] `attributes`, `boundary` and `kind`, or the function
   * @param {function} [fn] what to run
   * @returns {*} whatever the function answered
   * @memberof Telemetry
   */
  span(name, options = {}, fn = null) {
    const run = typeof options === 'function' ? options : fn;
    const given = typeof options === 'function' ? {} : options;

    check('henri.telemetry.span', [name, given, run]);

    if (!this.tracer || (given.boundary && !this.on(given.boundary))) {
      return run();
    }

    // The masking is built per call, the way `report()`'s is: what is
    // filtered and which fields the models marked personal are both read
    // live. A span with no attributes of its own never builds one
    const span = this.begin(name, {
      attributes: given.attributes
        ? attributesOf(redactor(this.henri)(given.attributes))
        : undefined,
      kind: KINDS[given.kind] || KINDS.internal,
    });

    return span ? this.around(span, run) : run();
  }

  /**
   * Start a span, or answer null when the api would not
   *
   * @param {string} name the span name
   * @param {object} [options={}] what `startSpan` takes
   * @param {*} [parent] the context to start it in
   * @returns {?object} the span
   * @memberof Telemetry
   */
  begin(name, options = {}, parent = undefined) {
    return this.guard('startSpan', () =>
      this.tracer.startSpan(name, options, parent)
    );
  }

  /**
   * Run a function with a span active, ending it whatever happens
   *
   * @param {object} span the span
   * @param {function} run what to run
   * @returns {*} whatever the function answered
   * @memberof Telemetry
   */
  around(span, run) {
    const active = this.guard('setSpan', () =>
      this.api.trace.setSpan(this.api.context.active(), span)
    );

    /**
     * The call itself, with the span ended on every way out of it
     *
     * @returns {*} whatever the function answered
     */
    const call = () => {
      let answer;

      try {
        answer = run();
      } catch (error) {
        this.failure(span, error);
        this.end(span);

        throw error;
      }

      if (!answer || typeof answer.then !== 'function') {
        this.end(span);

        return answer;
      }

      return answer.then(
        (value) => {
          this.end(span);

          return value;
        },
        (error) => {
          this.failure(span, error);
          this.end(span);

          throw error;
        }
      );
    };

    return active ? this.api.context.with(active, call) : call();
  }

  /**
   * Mark a span as the failure it was
   *
   * The error is handed over as it is, the way the reporter hands it over:
   * a framework that rewrote the application's own Error would be recording
   * something that never happened.
   *
   * @param {object} span the span
   * @param {*} error what failed
   * @returns {void}
   * @memberof Telemetry
   */
  failure(span, error) {
    this.guard('recordException', () => {
      if (error instanceof Error) {
        span.recordException(error);
        span.setAttribute(
          'error.type',
          typeof error.code === 'string' ? error.code : error.name || 'Error'
        );
      }

      span.setStatus({
        code: this.code('ERROR', ERROR),
        message: (error && error.message) || undefined,
      });
    });
  }

  /**
   * End a span
   *
   * @param {object} span the span
   * @param {number} [at] when it ended, in epoch milliseconds
   * @returns {void}
   * @memberof Telemetry
   */
  end(span, at = undefined) {
    this.guard('end', () => span.end(at));
  }

  /**
   * A `SpanStatusCode` out of the api, or the number it stands for
   *
   * @param {string} name the member name
   * @param {number} known what it is, when the api does not say
   * @returns {number} the code
   * @memberof Telemetry
   */
  code(name, known) {
    const codes = this.api && this.api.SpanStatusCode;

    return codes && typeof codes[name] === 'number' ? codes[name] : known;
  }

  /**
   * The context an incoming request belongs to
   *
   * Without a propagator registered by an SDK, the api's own is a no-op and
   * this answers the active context unchanged -- which is right: with no
   * SDK there is no trace to continue.
   *
   * @param {object} headers the incoming headers
   * @returns {*} the context to start the request's span in
   * @memberof Telemetry
   */
  extract(headers) {
    return (
      this.guard('extract', () =>
        this.api.propagation.extract(this.api.context.active(), headers, GETTER)
      ) || undefined
    );
  }

  /**
   * Write the current trace context into an outgoing header bag
   *
   * The other half of `extract()`: `traceparent` (and `tracestate`) on the
   * requests henri makes for the application, which today is a webhook
   * delivery. It writes nothing when telemetry is off, when `propagate` is
   * false, or when no span is active.
   *
   * @param {object} carrier the headers to write into
   * @returns {object} the same headers
   * @memberof Telemetry
   */
  inject(carrier) {
    check('henri.telemetry.inject', [carrier]);

    if (!this.tracer || !this.settings.propagate) {
      return carrier;
    }

    this.guard('inject', () =>
      this.api.propagation.inject(this.api.context.active(), carrier)
    );

    return carrier;
  }

  /**
   * A histogram, or something that looks like one and does nothing
   *
   * Always answers a recorder, so a call site never branches: with the
   * metrics off, `record()` is an empty function.
   *
   * @param {string} name the instrument name
   * @param {object} [options={}] `description` and `unit`
   * @returns {object} `{ record(value, attributes) }`
   * @memberof Telemetry
   */
  histogram(name, options = {}) {
    check('henri.telemetry.histogram', [name, options]);

    const made = this.instrument(name, () => {
      const found = this.guard('createHistogram', () =>
        this.meter.createHistogram(name, options)
      );

      return found
        ? {
            /**
             * Record one measurement
             *
             * @param {number} value the measurement
             * @param {object} [attributes] its dimensions
             * @returns {void}
             */
            record: (value, attributes) =>
              this.guard('record', () => found.record(value, attributes)),
          }
        : null;
    });

    return made || { record: () => {} };
  }

  /**
   * Register a callback the metrics pipeline asks for a value
   *
   * The instruments that cost nothing while a request runs: the callback is
   * only called when something is collecting, and henri's own two read
   * counters that already existed.
   *
   * @param {string} name the instrument name
   * @param {object} options `description`, `unit`, and `kind` (`gauge` or `counter`)
   * @param {function} callback called with `(observe)`, where
   *   `observe(value, attributes)` records one
   * @returns {boolean} whether it was registered
   * @memberof Telemetry
   */
  observe(name, options, callback) {
    check('henri.telemetry.observe', [name, options, callback]);

    const made = this.instrument(name, () =>
      this.guard('createObservable', () => {
        const { kind = 'gauge', ...rest } = options;
        const create =
          kind === 'counter'
            ? this.meter.createObservableCounter
            : this.meter.createObservableGauge;
        const instrument = create.call(this.meter, name, rest);

        instrument.addCallback((result) => {
          // The answer is handed back rather than dropped: a callback that
          // has to read a database (the queue's depth) answers a promise,
          // and the pipeline is the one that waits for it
          try {
            const answer = callback((value, attributes) =>
              result.observe(value, attributes)
            );

            return answer && typeof answer.then === 'function'
              ? answer.catch((error) => this.failed('observe', error))
              : answer;
          } catch (error) {
            this.failed('observe', error);

            return undefined;
          }
        });

        return instrument;
      })
    );

    return Boolean(made);
  }

  /**
   * One instrument per name, built once
   *
   * @param {string} name the instrument name
   * @param {function} build what makes it
   * @returns {*} the instrument, or null
   * @memberof Telemetry
   */
  instrument(name, build) {
    if (!this.meter) {
      return null;
    }

    if (this.instruments.has(name)) {
      return this.instruments.get(name);
    }

    const made = build() || null;

    this.instruments.set(name, made);

    return made;
  }

  /**
   * The boot, as spans, out of what `henri.analyze()` already measured
   *
   * Nothing is timed here and nothing ran during the boot: the analysis
   * holds the moment the walk started and, per module, its offset and its
   * duration, so every span is written afterwards with explicit start and
   * end times. A boot that failed is worth more than one that did not, so
   * it is emitted too, with the module that failed carrying the error.
   *
   * @param {?object} analysis what `henri.analyze()` answered
   * @param {*} [error=null] the failure, when the boot did not finish
   * @returns {boolean} whether anything was emitted
   * @memberof Telemetry
   */
  boot(analysis, error = null) {
    if (!this.on('boot') || !analysis || !analysis.startedAt) {
      return false;
    }

    const started = Date.parse(analysis.startedAt);

    /* istanbul ignore next */
    if (!Number.isFinite(started)) {
      return false;
    }

    const root = this.begin('henri.boot', {
      attributes: {
        'henri.boot.ok': Boolean(analysis.ok),
        'henri.runlevel': analysis.ceiling,
      },
      startTime: started,
    });

    if (!root) {
      return false;
    }

    const parent = this.guard('setSpan', () =>
      this.api.trace.setSpan(this.api.context.active(), root)
    );

    for (const found of analysis.modules) {
      // A module whose turn never came, because the boot failed first
      if (found.startedAt !== null) {
        this.module(found, started + found.startedAt, parent);
      }
    }

    if (error) {
      this.failure(root, error);
    }

    this.end(root, started + (analysis.duration || 0));

    return true;
  }

  /**
   * One module of the boot, as a span
   *
   * @param {object} found what `analyze()` said about it
   * @param {number} at when it started, in epoch milliseconds
   * @param {*} parent the context of the boot span
   * @returns {void}
   * @memberof Telemetry
   */
  module(found, at, parent) {
    const span = this.begin(
      `henri.module ${found.name}`,
      {
        attributes: {
          'henri.module': found.name,
          'henri.module.state': found.state,
          'henri.runlevel': found.runlevel,
        },
        startTime: at,
      },
      parent
    );

    if (!span) {
      return;
    }

    if (found.error) {
      this.guard('setStatus', () =>
        span.setStatus({
          code: this.code('ERROR', ERROR),
          message: found.error,
        })
      );
    }

    this.end(span, at + (found.duration || 0));
  }

  /**
   * The express middleware: one span and one measurement per request
   *
   * Mounted by `2.server.js` right after `base/request-id.js`, and only
   * when there is something to do -- an application with no api never has
   * this in its stack at all.
   *
   * The span is named for the method until the router has matched, and
   * renamed with the route pattern when the response is done. That is the
   * only moment the pattern is known, and it is the same moment the status
   * is: one handler, at the end, reading `requestOf()`.
   *
   * It answers **null** when there is nothing to do -- telemetry on, and
   * neither the `http` boundary nor the metrics wanted -- so a
   * configuration that only traces its jobs does not carry a middleware
   * frame per request for nothing.
   *
   * @returns {?function} the middleware, or null
   * @memberof Telemetry
   */
  middleware() {
    const traced = this.on('http');
    const duration = this.meter
      ? this.histogram('http.server.request.duration', {
          description: 'How long henri took to answer a request',
          unit: 's',
        })
      : null;

    if (!traced && !duration) {
      return null;
    }

    return (req, res, next) => {
      const method = methodOf(req.method);
      const started = process.hrtime.bigint();
      const span = traced
        ? this.begin(
            method,
            {
              attributes: {
                'henri.request_id': req.id || undefined,
                'http.request.method': method,
              },
              kind: KINDS.server,
            },
            this.extract(req.headers)
          )
        : null;
      let done = false;

      /**
       * The route pattern, the status, and nothing else
       *
       * @returns {void}
       */
      const finish = () => {
        if (done) {
          return;
        }

        done = true;
        this.answered(span, duration, requestOf(req, res.statusCode), started);
      };

      res.on('finish', finish);
      res.on('close', finish);

      if (!span) {
        return next();
      }

      const active = this.guard('setSpan', () =>
        this.api.trace.setSpan(this.api.context.active(), span)
      );

      return active ? this.api.context.with(active, next) : next();
    };
  }

  /**
   * What the request turned out to be: the metric, then the span
   *
   * @param {?object} span the request span, when there is one
   * @param {?object} duration the histogram, when the metrics are on
   * @param {object} found what `requestOf()` said: method, route, status
   * @param {bigint} started `process.hrtime.bigint()` at the first middleware
   * @returns {void}
   * @memberof Telemetry
   */
  answered(span, duration, found, started) {
    const attributes = { 'http.request.method': methodOf(found.method) };

    if (found.route) {
      attributes['http.route'] = found.route;
    }

    if (found.status) {
      attributes['http.response.status_code'] = found.status;
    }

    if (duration) {
      duration.record(
        Number(process.hrtime.bigint() - started) / 1e9,
        attributes
      );
    }

    if (!span) {
      return;
    }

    this.guard('finish', () => {
      if (found.route) {
        span.updateName(`${attributes['http.request.method']} ${found.route}`);
        span.setAttribute('http.route', found.route);
      }

      if (found.status) {
        span.setAttribute('http.response.status_code', found.status);

        // A 4xx is an answer, not a failure -- the line the error reporter
        // already draws, and the one the conventions ask of a server
        if (found.status >= 500) {
          span.setStatus({ code: this.code('ERROR', ERROR) });
          span.setAttribute('error.type', String(found.status));
        }
      }
    });

    this.end(span);
  }

  /**
   * Call the api, and never let it take the caller down with it
   *
   * @param {string} what the call, for the log line
   * @param {function} fn the call
   * @returns {*} whatever it answered, or null
   * @memberof Telemetry
   */
  guard(what, fn) {
    if (!this.api) {
      return null;
    }

    try {
      return fn();
    } catch (error) {
      this.failed(what, error);

      return null;
    }
  }

  /**
   * The api misbehaved. Count it, and stop calling it if it keeps at it.
   *
   * @param {string} what the call that failed
   * @param {*} error what it threw
   * @returns {void}
   * @memberof Telemetry
   */
  failed(what, error) {
    this.failures += 1;

    const message = (error && error.message) || String(error);

    if (this.failures < MAX_FAILURES) {
      this.log('warn', `${what} failed`, message);

      return;
    }

    if (this.failures === MAX_FAILURES) {
      this.log(
        'error',
        `${what} failed ${MAX_FAILURES} times; telemetry is off for this process`,
        message
      );
      this.tracer = null;
      this.meter = null;
      this.api = null;
    }
  }

  /**
   * One line, when there is a pen to write it with
   *
   * @param {string} level the level
   * @param {...any} args the line
   * @returns {void}
   * @memberof Telemetry
   */
  log(level, ...args) {
    const pen = this.henri && this.henri.pen;

    if (pen && typeof pen[level] === 'function') {
      pen[level](this.name, ...args);
    }
  }

  /**
   * What the boot line says
   *
   * @returns {string} the description
   * @memberof Telemetry
   */
  describe() {
    const parts = [];

    if (this.tracer) {
      parts.push(`spans: ${this.settings.spans.join(', ')}`);
    }

    if (this.meter) {
      parts.push('metrics');
    }

    return parts.join(', ') || 'nothing instrumented';
  }
}

module.exports = {
  BOUNDARIES,
  ERROR,
  KINDS,
  MAX_FAILURES,
  METHODS,
  OFF,
  PACKAGE,
  SCOPE,
  Telemetry,
  attributeValue,
  attributesOf,
  createTelemetry,
  methodOf,
  telemetryConfig,
  unavailable,
};
