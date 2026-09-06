const BaseModule = require('./base/module');

const debug = require('debug')('henri:telemetry');

const { createTelemetry, telemetryConfig } = require('./base/telemetry');
const { resolveFrom } = require('./utils');

/** The package that carries the interface; henri never ships an SDK */
const PACKAGE = '@opentelemetry/api';

/**
 * Resolve `@opentelemetry/api` from the application, or answer null
 *
 * The way an adapter and a renderer are resolved (`utils.resolveFrom`), and
 * for the same reason: the api holds a *global registry* that the SDK
 * registers its provider into, so henri and the application have to be
 * looking at the same copy. Resolving from the application's own directory
 * is what guarantees that; requiring it from core's would find a second
 * copy in a hoisted install and quietly trace into nothing.
 *
 * @param {string} cwd the application directory
 * @returns {?object} the api, or null when the application does not have it
 */
function resolve(cwd) {
  try {
    return require(resolveFrom(PACKAGE, cwd));
  } catch (error) {
    debug('%s is not installed: %s', PACKAGE, error.message);

    return null;
  }
}

/**
 * The telemetry module: `henri.telemetry`.
 *
 * What telemetry *is* -- what a span carries, what it never carries, which
 * boundaries henri knows, which identifier wins when a `traceparent` and an
 * `X-Request-Id` both arrive, and what happens when the exporter is down --
 * is in `base/telemetry.js`, and its header is the document. This is the
 * module around it: where it sits in the boot, where the api comes from,
 * what the boot line says and what a reload does.
 *
 * It sits at runlevel 0 with the configuration, because everything above it
 * asks whether it is on: the server mounts a middleware (2), the model
 * module wraps the store's `query()` (3), the router spans a render (5) and
 * the packages that ship their own modules ask for an instrument of their
 * own (4). Asking at install time rather than per call is the whole cost
 * model, so the answer has to exist before anything installs anything.
 *
 * **It is not reloadable**, which is the one thing worth explaining. An
 * observable instrument is registered once, by name, against a meter that
 * is a process-wide singleton: rebuilding this module would leave every
 * callback registered and the modules that re-register would count twice.
 * A change to `config.telemetry` needs a restart, like the SDK bootstrap it
 * sits next to.
 *
 * @class TelemetryModule
 * @extends {BaseModule}
 */
class TelemetryModule extends BaseModule {
  /**
   * Creates an instance of TelemetryModule.
   * @memberof TelemetryModule
   */
  constructor() {
    super();

    this.name = 'telemetry';
    this.runlevel = 0;
    this.needs = ['config'];
    // Naming `config` replaces the number, so everything that *installs* an
    // instrumentation has to be named too: the server mounts a middleware,
    // the model module wraps the store's query(), the router spans a
    // render, the mailer a send, and the cache and the queue register an
    // instrument of their own. A module that is not there is ignored, which
    // is why this is `before` and not `needs`
    this.before = [
      'cache',
      'jobs',
      'mail',
      'model',
      'router',
      'server',
      'webhooks',
    ];
    this.henri = null;

    /** The telemetry itself; until init() there is none */
    this.telemetry = null;

    this.init = this.init.bind(this);
    this.span = this.span.bind(this);
    this.inject = this.inject.bind(this);
    this.histogram = this.histogram.bind(this);
    this.observe = this.observe.bind(this);
    this.boot = this.boot.bind(this);
    this.middleware = this.middleware.bind(this);
  }

  /**
   * Module initialization
   *
   * @async
   * @returns {!string} The name of the module
   * @throws when the configuration requires telemetry the application does not have
   * @memberof TelemetryModule
   */
  async init() {
    this.build();

    return this.name;
  }

  /**
   * Build the telemetry from the configuration and whatever api is there
   *
   * @returns {Telemetry} the telemetry
   * @throws when `telemetry.enabled` is true and the api is missing
   * @memberof TelemetryModule
   */
  build() {
    const { pen } = this.henri;
    const settings = telemetryConfig(this.henri.config);
    const api = settings.enabled ? resolve(this.henri.cwd()) : null;

    this.telemetry = createTelemetry({ api, henri: this.henri, settings });

    // Silence is the point: an application without the api gets no line,
    // because there is nothing it could act on
    if (this.telemetry.enabled) {
      pen.info('telemetry', PACKAGE, this.telemetry.describe());
      debug('%o', settings);
    }

    return this.telemetry;
  }

  /**
   * Is anything instrumented?
   *
   * @readonly
   * @returns {boolean} true when a tracer or a meter is there
   * @memberof TelemetryModule
   */
  get enabled() {
    return Boolean(this.telemetry && this.telemetry.enabled);
  }

  /**
   * The boundaries this application instruments
   *
   * @readonly
   * @returns {Array<string>} the names
   * @memberof TelemetryModule
   */
  get spans() {
    return this.telemetry ? this.telemetry.spans : [];
  }

  /**
   * Is this boundary instrumented?
   *
   * @param {string} boundary one of the boundaries of `base/telemetry.js`
   * @returns {boolean} true when spans of that boundary are wanted
   * @memberof TelemetryModule
   */
  on(boundary) {
    return Boolean(this.telemetry && this.telemetry.on(boundary));
  }

  /**
   * Run something inside a span
   *
   * @param {string} name the span name
   * @param {(object|function)} [options={}] `attributes` and `kind`, or the function
   * @param {function} [fn] what to run
   * @returns {*} whatever the function answered
   * @memberof TelemetryModule
   */
  span(name, options = {}, fn = null) {
    return this.telemetry.span(name, options, fn);
  }

  /**
   * Write the current trace context into an outgoing header bag
   *
   * @param {object} carrier the headers to write into
   * @returns {object} the same headers
   * @memberof TelemetryModule
   */
  inject(carrier) {
    return this.telemetry.inject(carrier);
  }

  /**
   * A histogram, or something that looks like one and does nothing
   *
   * @param {string} name the instrument name
   * @param {object} [options={}] `description` and `unit`
   * @returns {object} `{ record(value, attributes) }`
   * @memberof TelemetryModule
   */
  histogram(name, options = {}) {
    return this.telemetry.histogram(name, options);
  }

  /**
   * Register a callback the metrics pipeline asks for a value
   *
   * @param {string} name the instrument name
   * @param {object} options `description`, `unit` and `kind`
   * @param {function} callback called with `(observe)`
   * @returns {boolean} whether it was registered
   * @memberof TelemetryModule
   */
  observe(name, options, callback) {
    return this.telemetry.observe(name, options, callback);
  }

  /**
   * The express middleware, one span and one measurement per request
   *
   * @returns {function} the middleware
   * @memberof TelemetryModule
   */
  middleware() {
    return this.telemetry.middleware();
  }

  /**
   * The boot, as spans, out of what `henri.analyze()` already measured
   *
   * @param {?object} analysis what `henri.analyze()` answered
   * @param {*} [error=null] the failure, when the boot did not finish
   * @returns {boolean} whether anything was emitted
   * @memberof TelemetryModule
   */
  boot(analysis, error = null) {
    return Boolean(this.telemetry) && this.telemetry.boot(analysis, error);
  }
}

module.exports = TelemetryModule;
