const HenriBase = require('./base/henri');
const Modules = require('./0.modules');
const Pen = require('./0.pen');
const utils = require('./utils');
const validator = require('validator');

const Config = require('./0.config');
const Mailer = require('./1.mailer');
const Graphql = require('./1.graphql');
const Controllers = require('./2.controllers');
const Mailers = require('./2.mailers');
const Server = require('./2.server');
const Model = require('./3.model');
const View = require('./3.view');
const User = require('./4.user');
const Router = require('./5.router');
const Workers = require('./5.workers');
const Testing = require('./7.tests');

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
    this.modules.add(new Config());
    this.modules.add(new Mailer());
    this.modules.add(new Graphql());
    this.modules.add(new Controllers());
    this.modules.add(new Mailers());
    this.modules.add(new Server());
    this.modules.add(new Model());
    this.modules.add(new Router());
    this.modules.add(new User());
    this.modules.add(new View());
    this.modules.add(new Workers());
    this.modules.add(new Testing());

    try {
      await this.modules.init();
    } catch (error) {
      const reason = error && error.message ? error.message : String(error);

      throw new Error(`henri - unable to execute init(): ${reason}`, {
        cause: error,
      });
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
        'Run henri from the root of your application, or create one with: henri new <name>'
      );
    }

    return true;
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
   * Helper method to help prettier parse ans indent Graphql calls
   *
   * @static
   * @param {Graphql} ast Graphql statement to be evaluated
   * @returns {string} same as 'ast' parameter
   * @memberof Henri
   */
  gql(ast) {
    return `${ast}`;
  }
}

module.exports = Henri;
