const BaseModule = require('./base/module');
const runJest = require('jest-cli/build/cli/index');

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

    this.initialized = false;

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
   * @memberof Tests
   */
  async init() {
    this.henri.pen.info('tests', 'running tests');

    const options = [
      '--testPathPattern=/test/',
      '--detectOpenHandles',
      '--passWithNoTests',
      //    '--coverage',
      //    '--collectCoverageFrom=["app/**/**/*.js", "!app/views/**/*.js", "!app/routes.js"]',
    ];

    if (!this.initialized) {
      this.henri.pen.info('tests', 'silent first run...');
      options.push('--silent');
      this.initialized = true;
    }

    await runJest.run(options);

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
