const BaseModule = require('./base/module');

/**
 * Workers management module
 *
 * @class Tests
 * @extends {BaseModule}
 */
class Tests extends BaseModule {
  /**
   * Creates an instance of Workers.
   * @memberof Tests
   */
  constructor() {
    super();

    this.reloadable = true;
    this.runlevel = 7;
    this.name = 'tests';
    this.henri = undefined;

    this.init = this.init.bind(this);
    this.stop = this.stop.bind(this);
    this.reload = this.reload.bind(this);
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof Workers
   */
  async init() {
    this.henri.pen.warn('tests', 'running tests');

    return this.name;
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {(string|Promise|boolean)} Module name or false
   * @memberof Tests
   */
  async stop() {
    return new Promise(resolve => resolve(this.name));
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Tests
   */
  async reload() {
    await this.stop();
    await this.init();

    return this.name;
  }
}

module.exports = Tests;
