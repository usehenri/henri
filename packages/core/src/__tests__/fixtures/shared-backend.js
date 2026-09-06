/**
 * A shared store adapter an application could ship itself: `config.shared`
 * naming a path instead of a package (`{ "adapter": "./lib/backend" }`).
 *
 * @class FixtureBackend
 */
class FixtureBackend {
  /**
   * Creates an instance of FixtureBackend.
   *
   * @param {object} [settings={}] the normalized `config.shared`
   * @memberof FixtureBackend
   */
  constructor(settings = {}) {
    this.name = 'fixture';
    this.prefix = settings.prefix || 'henri:';
    this.counters = new Map();
    this.entries = new Map();
  }

  /**
   * What it is talking to
   *
   * @returns {string} a description
   * @memberof FixtureBackend
   */
  describe() {
    return `fixture://${this.prefix}`;
  }

  /**
   * An express-rate-limit store
   *
   * @returns {object} the store
   * @memberof FixtureBackend
   */
  rateLimitStore() {
    return { decrement() {}, increment() {}, resetKey() {} };
  }

  /**
   * A key/value store
   *
   * @returns {object} the store
   * @memberof FixtureBackend
   */
  keyValueStore() {
    return { add() {}, delete() {}, get() {}, set() {} };
  }
}

module.exports = FixtureBackend;
