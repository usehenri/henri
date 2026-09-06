const HenriBase = require('./base/henri');
const Modules = require('./0.modules');
const Pen = require('./0.pen');
const { Reporter } = require('./base/reporting');
const utils = require('./utils');
const { fallback } = require('./base/errors');
const validator = require('validator');

const Config = require('./0.config');
const Queries = require('./0.queries');
const Telemetry = require('./0.telemetry');
const Encryption = require('./1.encryption');
const I18n = require('./1.i18n');
const Mailer = require('./1.mailer');
const Controllers = require('./2.controllers');
const Mailers = require('./2.mailers');
const Server = require('./2.server');
const Cache = require('./3.cache');
const Model = require('./3.model');
const Policies = require('./3.policies');
const Privacy = require('./3.privacy');
const View = require('./3.view');
const Calls = require('./4.calls');
const Retention = require('./4.retention');
const Trail = require('./4.trail');
const User = require('./4.user');
const Versions = require('./4.versions');
const Router = require('./5.router');
const Workers = require('./5.workers');

const fs = require('fs');
const path = require('path');

/**
 * Henri
 * @module henri
 */
class Henri extends HenriBase {
  /**
   * Creates an instance of Henri.
   * @param {object} props options sent to super
   * @throws when the working directory is not a henri application
   * @memberof Henri
   */
  constructor(props) {
    super(props);

    this.pen = new Pen(true, this);
    // Built here rather than registered as a module: the first failure
    // worth reporting is a module that would not start (see
    // base/reporting.js)
    this.reporter = new Reporter(this);
    this.modules = new Modules(this);

    this.validator = validator;
    this.utils = utils;
    this.status = new Map();

    this._middlewares = [];

    !this.isTest && (global['henri'] = this);

    this.changeDirectory();
    this.checkApplication();

    /** Warn if Henri is started with a restricted run level */
    if (this.runlevel < 6) {
      this.pen.warn('henri', 'running at limited level', this.runlevel);
    }
  }

  /**
   * Module initialization
   *
   * @async
   * @returns {Promise<boolean>} success or not
   * @throws an Error whose `cause` is the failing module's error
   * @memberof Henri
   */
  async init() {
    this.modules.add(new Cache());
    this.modules.add(new Calls());
    this.modules.add(new Config());
    this.modules.add(new Encryption());
    this.modules.add(new I18n());
    this.modules.add(new Mailer());
    this.modules.add(new Controllers());
    this.modules.add(new Mailers());
    this.modules.add(new Server());
    this.modules.add(new Model());
    this.modules.add(new Policies());
    this.modules.add(new Privacy());
    this.modules.add(new Queries());
    this.modules.add(new Retention());
    this.modules.add(new Router());
    this.modules.add(new Telemetry());
    this.modules.add(new Trail());
    this.modules.add(new User());
    this.modules.add(new Versions());
    this.modules.add(new View());
    this.modules.add(new Workers());

    try {
      await this.modules.discover();
      await this.modules.init();

      // The boot, as spans, written after the fact out of the timings
      // `analyze()` already took: nothing runs during the boot for this
      // (see base/telemetry.js)
      this.telemetry.boot(this.analyze());
    } catch (error) {
      const reason = error && error.message ? error.message : String(error);
      const failure = fallback(
        new Error(`henri - unable to execute init(): ${reason}`, {
          cause: error,
        }),
        'HENRI_BOOT_FAILED'
      );

      // A boot that failed is the one worth having a span of. `telemetry`
      // is a module of runlevel 0, so it is there unless it is what failed
      this.telemetry &&
        typeof this.telemetry.boot === 'function' &&
        this.telemetry.boot(this.analyze(), failure);

      // Awaited, unlike the request path: the process usually exits right
      // after this, and an asynchronous reporter needs its flush in first.
      // `report()` bounds the wait itself, so a handler that hangs does not
      // take the boot with it (base/reporting.js)
      await this.reporter.report(failure, { source: 'boot' });

      throw failure;
    }

    return true;
  }

  /**
   * Change the current working directory.
   * Used for testing purposes
   *
   * @returns {boolean} success or not
   * @memberof Henri
   */
  changeDirectory() {
    let onboard;

    try {
      onboard = Boolean(
        require(path.join(process.cwd(), './package.json')).onboard
      );
    } catch (error) {
      onboard = false;
    }

    if (this.prefix !== '.' && onboard !== true) {
      const target = path.resolve(process.cwd(), this.prefix);

      try {
        process.chdir(target);
        this.pen.warn('henri', 'cwd change', process.cwd());

        return true;
      } catch (error) {
        this.pen.error('henri', 'invalid directory', target);

        return false;
      }
    }

    return true;
  }

  /**
   * Make sure the working directory looks like an application
   *
   * @returns {boolean} true when a package.json exists
   * @throws when there is no package.json in the working directory
   * @memberof Henri
   */
  checkApplication() {
    const cwd = this.cwd();

    if (!fs.existsSync(path.join(cwd, 'package.json'))) {
      throw this.pen.fatal(
        'henri',
        `${cwd} is not a henri application: no package.json found`,
        'Run henri from the root of your application, or create one with: henri new <name>',
        null,
        'HENRI_BOOT_NOT_AN_APPLICATION'
      );
    }

    return true;
  }

  /**
   * What the boot did: the order, the timings, what each module waited on
   * and the chain that decided how long it took. `henri analyze` prints it.
   *
   * @param {string} [name] one module, instead of all of them
   * @returns {?object} the analysis, null before init()
   * @memberof Henri
   */
  analyze(name) {
    return this.modules.analyze(name);
  }

  /**
   * Reloads the modules
   * Reloads are serialized: while one is in flight, callers get the single
   * queued run (see Modules.reload).
   *
   * @returns {Promise<boolean>} reload status
   * @memberof Henri
   */
  reload() {
    return this.modules.reload();
  }

  /**
   * Stops the modules
   *
   * @async
   * @returns {Promise<Array<Error>>} the errors of the modules that failed to stop (empty when clean)
   * @memberof Henri
   */
  async stop() {
    return this.modules.stop();
  }

  /**
   * Add a middleware to be registered later
   *
   * @param {function} func function to be added to the express middlewares
   * @return {boolean} success or not
   * @memberof Henri
   */
  addMiddleware(name, func) {
    if (typeof func === 'function') {
      this._middlewares.push({ func, name });

      return true;
    }
    this.pen.error('middleware', `${name} is not a function (${typeof func})`);

    return false;
  }

  /**
   * May this user take this action on this record?
   *
   * The one way to ask, wherever the answer is needed: a controller, a
   * `before` hook, a view's data, a job. `req.can()` is the same question
   * with `req.user` already filled in. It answers false for everything it
   * cannot answer true for -- no policy, no rule, a rule that threw -- so
   * there is no accidental yes to get (see base/policies.js).
   *
   * @param {*} user the user, or null
   * @param {string} action the action (`update`)
   * @param {*} [record=null] the record, when there is one
   * @param {(object|string)} [options={}] `{ policy, type }`, or a policy name
   * @returns {Promise<boolean>} allowed or not
   * @memberof Henri
   */
  can(user, action, record = null, options = {}) {
    return this.policies.can(user, action, record, options);
  }

  /**
   * Helper method to help prettier parse ans indent Graphql calls
   *
   * @static
   * @param {string} ast Graphql statement to be evaluated
   * @returns {string} same as 'ast' parameter
   * @memberof Henri
   */
  gql(ast) {
    return `${ast}`;
  }
}

module.exports = Henri;
