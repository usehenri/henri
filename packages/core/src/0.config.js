const BaseModule = require('./base/module');
const fs = require('fs');
const path = require('path');
const { syntax } = require('./utils');

/**
 * Load the KEY=value lines of <cwd>/.env into process.env
 * Variables already set in the environment win (like dotenv). No dependency.
 *
 * @param {string} cwd application directory
 * @returns {number} the number of variables loaded
 */
function loadDotEnv(cwd) {
  const file = path.join(cwd, '.env');
  let loaded = 0;

  if (!fs.existsSync(file)) {
    return loaded;
  }

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match =
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);

    if (!match || line.trim().startsWith('#')) {
      continue;
    }

    const [, key, raw] = match;
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');

    if (typeof process.env[key] === 'undefined') {
      process.env[key] = value;
      loaded++;
    }
  }

  return loaded;
}

/**
 * Environment overrides: HENRI_SECRET provides (or replaces) `secret`
 *
 * @param {object} config parsed configuration
 * @returns {object} the configuration with the overrides applied
 */
function withEnv(config) {
  if (process.env.HENRI_SECRET) {
    return Object.assign({}, config, { secret: process.env.HENRI_SECRET });
  }

  return config;
}

/**
 * Split a configuration key into path segments
 * Supports dots and brackets: 'stores.default.adapter', 'list[0].name'
 *
 * @param {string} key the configuration key
 * @returns {Array<string>} the path segments
 */
const segments = (key) =>
  String(key)
    .split(/[.[\]]/)
    .filter((part) => part.length > 0);

/**
 * Does the object have a value at the given path?
 *
 * @param {object} object the object to walk
 * @param {string} key the path (ex: 'stores.default')
 * @returns {boolean} exists or not
 */
function hasPath(object, key) {
  let current = object;

  for (const part of segments(key)) {
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return false;
    }
    current = current[part];
  }

  return true;
}

/**
 * Get the value at the given path
 *
 * @param {object} object the object to walk
 * @param {string} key the path (ex: 'stores.default')
 * @returns {any} the value, or undefined
 */
function getPath(object, key) {
  return hasPath(object, key)
    ? segments(key).reduce((current, part) => current[part], object)
    : undefined;
}

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
    loadDotEnv(this.henri.cwd());

    const configPath = path.join(
      this.henri.cwd(),
      'config',
      `${this.henri.env || 'dev'}.json`
    );
    const defaultPath = path.join(this.henri.cwd(), 'config', 'default.json');

    let hasErrors = false;

    try {
      this.config = withEnv(require(configPath));

      Object.freeze(this.config);

      return this.name;
    } catch (error) {
      if (await syntax(configPath, null, this.henri)) {
        hasErrors = true;
      }
    }

    try {
      this.config = withEnv(require(defaultPath));

      Object.freeze(this.config);

      return this.name;
    } catch (error) {
      if (await syntax(defaultPath, null, this.henri)) {
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

    return getPath(this.config, key);
  }

  /**
   * Check if the config value exists without throwing
   *
   * @param {string} key Configuration key
   * @returns {boolean} Exists or not
   * @memberof Config
   */
  has(key) {
    return hasPath(this.config, key);
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
module.exports.loadDotEnv = loadDotEnv;
module.exports.withEnv = withEnv;
