// A module of this application: every file of app/modules is loaded into
// the boot. See https://usehenri.io/reference/under-the-hood/
const BaseModule = require('@usehenri/core/src/base/module');

/**
 * It adds a route of its own, so it has to run after the express app exists
 * and before the routes are mounted
 */
class Metrics extends BaseModule {
  /**
   * Creates an instance of Metrics.
   */
  constructor() {
    super();
    this.name = 'metrics';
    this.needs = ['server'];
    this.before = ['router'];
    this.runlevel = 5;
  }

  /**
   * Module initialization
   *
   * @returns {string} the name of the module
   */
  async init() {
    this.henri.addMiddleware('metrics', (router) =>
      router.get('/_metrics', (req, res) => res.json({ up: true }))
    );

    return this.name;
  }
}

module.exports = Metrics;
