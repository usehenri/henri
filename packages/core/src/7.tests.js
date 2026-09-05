const BaseModule = require('./base/module');

/**
 * Tests module (runlevel 7)
 *
 * The in-process test runner is gone: `henri test` runs Vitest in the app
 * and `@usehenri/testing` boots henri from there. This module is only kept so
 * that starting henri with HENRI_TESTING points at the new command; it can be
 * removed from the module list in henri.js.
 *
 * @class Tests
 * @extends {BaseModule}
 */
class Tests extends BaseModule {
  /**
   * Creates an instance of Tests.
   * @memberof Tests
   */
  constructor() {
    super();

    this.reloadable = false;
    this.runlevel = 7;
    this.name = 'tests';
    this.henri = undefined;

    this.init = this.init.bind(this);
    this.stop = this.stop.bind(this);
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
    this.henri.pen.warn(
      'tests',
      'tests are no longer run in-process',
      'run `henri test` instead (vitest + @usehenri/testing)'
    );

    return this.name;
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Tests
   */
  async stop() {
    return this.name;
  }
}

module.exports = Tests;
