const BaseModule = require('./base/module');
const path = require('path');
const { syntax } = require('./utils');

// eslint-disable-next-line id-length
const _ = require('lodash');

/**
 * Configuration module
 *
 * @class Config
 * @extends {BaseModule}
 */
class Config extends BaseModule {
  /**
   * Creates an instance of Config.
   * @memberof Config
   */
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 0;
    this.name = 'config';
    this.config = null;
    this.reloadable = true;
    this.henri = null;

    this.get = this.get.bind(this);
    this.has = this.has.bind(this);
    this.reload = this.reload.bind(this);
    this.init = this.init.bind(this);
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @returns {!string} The name of the module
   * @memberof Config
   */
  async init() {
    const configPath = path.join(
      this.henri.cwd(),
      'config',
      `${this.henri.env || 'dev'}.json`
    );
    const defaultPath = path.join(this.henri.cwd(), 'config', 'default.json');

    let hasErrors = false;

    try {
      // eslint-disable-next-line global-require
      this.config = require(configPath);

      Object.freeze(this.config);

      return this.name;
    } catch (error) {
      if (await syntax(configPath)) {
        hasErrors = true;
      }
    }

    try {
      // eslint-disable-next-line global-require
      this.config = require(defaultPath);

      Object.freeze(this.config);

      return this.name;
    } catch (error) {
      if (await syntax(defaultPath)) {
        hasErrors = true;
      }
    }

    if (hasErrors) {
      throw new Error('Unable to load configuration');
    }

    this.henri.pen.error('config', 'no configuration has been loaded...');
    this.henri.pen.error('config', 'attempted', configPath);
    this.henri.pen.error('config', 'attempted', defaultPath);
  }

  /**
   * Get the config value
   *
   * @param {!string} key Configuration key
   * @param {?boolean} [safe=false] Do not throw
   * @returns {(any|boolean)} Value
   * @throws
   * @memberof Config
   */
  get(key, safe = false) {
    if (!this.has(key)) {
      if (safe) {
        return false;
      }
      throw new Error(`Config key ${key} does not exist`);
    }

    return _.get(this.config, key);
  }

  /**
   * Check if the config value exists without throwing
   *
   * @param {string} key Configuration key
   * @returns {boolean} Exists or not
   * @memberof Config
   */
  has(key) {
    return _.has(this.config, key);
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Config
   */
  async reload() {
    delete this.config;
    await this.init();

    return this.name;
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {(string|boolean)} Module name or false
   * @memberof Config
   */
  static async stop() {
    return false;
  }
}

module.exports = Config;
