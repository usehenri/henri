const HenriBase = require('./base/henri');
const Modules = require('./0.modules');
const Pen = require('./0.pen');
const utils = require('./utils');
const validator = require('validator');

const Config = require('./0.config');
const Mailer = require('./1.mailer');
const Graphql = require('./1.graphql');
const Controllers = require('./2.controllers');
const Server = require('./2.server');
const Model = require('./3.model');
const View = require('./3.view');
const User = require('./4.user');
const Router = require('./5.router');
const Workers = require('./5.workers');
const Tests = require('./7.tests');

const path = require('path');
const bounce = require('bounce');

/**
 * Henri
 * @module henri
 */
class Henri extends HenriBase {
  /**
   * Creates an instance of Henri.
   * @param {object} props options sent to super
   * @memberof Henri
   */
  constructor(props) {
    super(props);

    this.pen = new Pen();
    this.modules = new Modules(this);

    this.validator = validator;
    this.utils = utils;
    this.status = new Map();

    this._middlewares = [];

    !this.isTest && (global['henri'] = this);

    this.changeDirectory();

    /** Warn if Henri is started with a restricted run level */
    if (this.runlevel < 7) {
      this.pen.warn('henri', 'running at limited level', this.runlevel);
    }
  }

  /**
   * Module initialization
   *
   * @async
   * @returns {Promise<boolean>} success or not
   * @memberof Henri
   */
  async init() {
    return new Promise(async resolve => {
      this.modules.add(new Config());
      this.modules.add(new Mailer());
      this.modules.add(new Graphql());
      this.modules.add(new Controllers());
      this.modules.add(new Server());
      this.modules.add(new Model());
      this.modules.add(new Router());
      this.modules.add(new User());
      this.modules.add(new View());
      this.modules.add(new Workers());
      this.modules.add(new Tests());

      try {
        await this.modules.init();
      } catch (error) {
        bounce.rethrow(error, 'system');
        throw new Error('henri - unable to execute init()');
      }

      return resolve(true);
    });
  }

  /**
   * Change the current working directory.
   * Used for testing purposes
   *
   * @returns {boolean} success or not
   * @memberof Henri
   */
  changeDirectory() {
    if (
      this.prefix !== '.' &&
      // eslint-disable-next-line global-require
      require(path.join(process.cwd(), './package.json')).onboard !== true
    ) {
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
   * Reloads the modules
   *
   * @async
   * @returns {Promise} Module name
   * @memberof Henri
   */
  async reload() {
    return this.modules.reload();
  }

  /**
   * Stops the modules
   *
   * @async
   * @returns {Promise} Modules stop promise
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
  addMiddleware(func) {
    this._middlewares.push(func);

    return true;
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
