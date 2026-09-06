const BaseModule = require('./base/module');
const fs = require('fs');
const path = require('path');
const { syntax } = require('./utils');
const { MASK, filterParameters, isFiltered, redact } = require('./base/redact');

/**
 * Prefix of the generic environment overrides. The rest of the name is the
 * configuration path, `__` between the segments, verbatim (configuration
 * keys are camelCase and environment variable names are case sensitive):
 * `HENRI_CONFIG__stores__default__url` sets `stores.default.url`.
 */
const ENV_PREFIX = 'HENRI_CONFIG__';

/**
 * Same, with the value parsed as JSON instead of coerced to the type the
 * configuration file already uses: `HENRI_CONFIG_JSON__inertia={"ssr":true}`
 */
const ENV_JSON_PREFIX = 'HENRI_CONFIG_JSON__';

/** Segment separator inside those names (a shell name cannot hold a dot) */
const ENV_SEPARATOR = '__';

/**
 * The named shorthands, applied in this order and before the generic
 * overrides. `requires` is a path the configuration must already have for
 * the variable to mean anything.
 */
const ALIASES = [
  { key: 'secret', variable: 'HENRI_SECRET' },
  { key: 'host', variable: 'HENRI_HOST' },
  {
    key: 'stores.default.url',
    requires: 'stores.default',
    variable: 'DATABASE_URL',
  },
];

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
 * A copy of the object with the value set at the given path
 *
 * Only the containers along the path are copied, the rest is shared: the
 * object the caller passed (the required configuration file, which node
 * caches) is never modified. Missing containers are created.
 *
 * @param {object} object the object to copy
 * @param {string} key the path (ex: 'stores.default.url')
 * @param {any} value the value to set
 * @returns {object} the copy
 */
function setPath(object, key, value) {
  const parts = segments(key);
  const copy = (node) => {
    if (Array.isArray(node)) {
      return node.slice();
    }

    return node !== null && typeof node === 'object' ? { ...node } : {};
  };
  const root = copy(object);
  let current = root;

  for (const part of parts.slice(0, -1)) {
    current[part] = copy(current[part]);
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;

  return root;
}

/**
 * Parse a JSON value coming from the environment
 *
 * The value itself is never part of the error: it may be a secret.
 *
 * @param {string} raw the value of the variable
 * @param {string} variable the name of the variable
 * @returns {any} the parsed value
 * @throws {Error} when the value is not valid JSON
 */
function parseJson(raw, variable) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    // No cause and no parser message on purpose: both quote the value, and
    // the value of an environment variable may be a secret
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`${variable} is not valid JSON`);
  }
}

/**
 * JSON.parse, or undefined when the value is not JSON
 *
 * @param {string} raw the value of the variable
 * @returns {any} the parsed value, or undefined
 */
function tryJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The value of an environment variable, as the type the configuration file
 * already uses at that path
 *
 * A path the file does not have is a string: henri does not guess. Use
 * `HENRI_CONFIG_JSON__<path>` for anything else.
 *
 * @param {string} raw the value of the variable
 * @param {any} current the value the configuration file has at that path
 * @param {object} entry the override ({ key, variable })
 * @returns {any} the value to set
 * @throws {Error} when the value does not fit the type of the current one
 */
function coerce(raw, current, entry) {
  const { key, variable } = entry;

  if (typeof current === 'number') {
    const value = Number(raw);

    if (!Number.isFinite(value)) {
      throw new Error(
        `${variable} is not a number, and "${key}" is one in the configuration`
      );
    }

    return value;
  }

  if (typeof current === 'boolean') {
    if (/^(true|false)$/i.test(raw)) {
      return /^true$/i.test(raw);
    }

    throw new Error(
      `${variable} is not true or false, and "${key}" is a boolean in the configuration`
    );
  }

  if (current !== null && typeof current === 'object') {
    const value = tryJson(raw);

    if (value === null || typeof value !== 'object') {
      throw new Error(
        `${variable} is not a JSON object, and "${key}" is one in the configuration`
      );
    }

    return value;
  }

  return raw;
}

/**
 * The generic overrides present in an environment, sorted by variable name
 * so a boot is reproducible
 *
 * @param {object} env the environment (process.env)
 * @returns {Array<object>} the overrides ({ json, key, variable })
 * @throws {Error} when a variable carries no configuration path
 */
function overrides(env) {
  const found = [];

  for (const variable of Object.keys(env).sort()) {
    const json = variable.startsWith(ENV_JSON_PREFIX);
    const prefix = json ? ENV_JSON_PREFIX : ENV_PREFIX;

    if (!json && !variable.startsWith(ENV_PREFIX)) {
      continue;
    }

    const key = variable
      .slice(prefix.length)
      .split(ENV_SEPARATOR)
      .filter((part) => part.length > 0)
      .join('.');

    if (key === '') {
      throw new Error(
        `${variable} names no configuration key: ${prefix}<key> (${prefix}stores${ENV_SEPARATOR}default${ENV_SEPARATOR}url)`
      );
    }

    found.push({ json, key, variable });
  }

  return found;
}

/**
 * The configuration, with the environment applied over it
 *
 * Precedence, lowest first: the configuration file, the named shorthands
 * (HENRI_SECRET, HENRI_HOST, DATABASE_URL), then the generic overrides
 * (HENRI_CONFIG__<path>), which name the key they set and win.
 *
 * @param {object} config the parsed configuration
 * @param {object} [env=process.env] the environment
 * @returns {{applied: Array<object>, config: object}} the configuration and
 *   what the environment provided (one entry per variable)
 * @throws {Error} when a variable is empty or does not fit its key
 */
function applyEnv(config, env = process.env) {
  const applied = [];
  let result = config;

  for (const alias of ALIASES) {
    const raw = env[alias.variable];

    // An unset or empty shorthand is simply not an override
    if (typeof raw !== 'string' || raw.trim() === '') {
      continue;
    }

    if (alias.requires && !hasPath(result, alias.requires)) {
      applied.push({
        ignored: `the configuration has no "${alias.requires}"`,
        key: alias.key,
        variable: alias.variable,
      });
      continue;
    }

    const value = coerce(raw, getPath(result, alias.key), alias);

    result = setPath(result, alias.key, value);
    applied.push({ key: alias.key, value, variable: alias.variable });
  }

  for (const entry of overrides(env)) {
    const raw = env[entry.variable];

    if (raw.trim() === '') {
      throw new Error(
        `${entry.variable} is set but empty: give it a value or unset it`
      );
    }

    const value = entry.json
      ? parseJson(raw, entry.variable)
      : coerce(raw, getPath(result, entry.key), entry);

    result = setPath(result, entry.key, value);
    applied.push({ key: entry.key, value, variable: entry.variable });
  }

  return { applied, config: result };
}

/**
 * The configuration, with the environment applied over it
 *
 * @param {object} config parsed configuration
 * @param {object} [env=process.env] the environment
 * @returns {object} the configuration with the overrides applied
 * @throws {Error} when a variable is empty or does not fit its key
 */
function withEnv(config, env = process.env) {
  return applyEnv(config, env).config;
}

/**
 * A value of the environment, ready to be printed
 *
 * A key `config.filterParameters` matches (`secret`, `password`, `token`
 * and `authorization` by default) is masked, in the path and in the name of
 * the variable; the password of a connection string always is, since a url
 * carries one without ever being named like a secret.
 *
 * @param {object} entry an applied override ({ key, value, variable })
 * @param {Array<string>} filters the filtered parameter names
 * @returns {string} what to print
 */
function display(entry, filters) {
  const { key, value, variable } = entry;
  const last = segments(key).pop();

  if (isFiltered(last, filters) || isFiltered(variable, filters)) {
    return MASK;
  }

  if (value !== null && typeof value === 'object') {
    return JSON.stringify(redact(value, filters));
  }

  return String(value).replace(
    /^([a-z][a-z0-9+.-]*:\/\/[^:@/\s]+):[^@\s/]*@/i,
    `$1:${MASK}@`
  );
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
    this.fromEnv = [];

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
   * @throws {Error} when a file cannot be parsed or the environment is wrong
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
    let loaded = null;

    for (const file of [configPath, defaultPath]) {
      if (loaded) {
        break;
      }

      try {
        loaded = require(file);
      } catch (error) {
        if (await syntax(file, null, this.henri)) {
          hasErrors = true;
        }
      }
    }

    if (loaded) {
      // Outside the try above: a wrong environment variable is a boot
      // failure of its own, never a reason to fall back to another file
      const { applied, config } = applyEnv(loaded);

      this.config = config;
      this.fromEnv = applied.map(({ key, variable }) => ({ key, variable }));

      Object.freeze(this.config);
      this.report(applied);

      return this.name;
    }

    if (hasErrors) {
      throw new Error('Unable to load configuration');
    }

    this.henri.pen.error('config', 'no configuration has been loaded...');
    this.henri.pen.error('config', 'attempted', configPath);
    this.henri.pen.error('config', 'attempted', defaultPath);
  }

  /**
   * Prints the keys the environment provided, so nobody debugs a value they
   * cannot see. Filtered parameters are masked.
   *
   * @param {Array<object>} applied what applyEnv() applied
   * @returns {void}
   * @memberof Config
   */
  report(applied) {
    const filters = filterParameters({
      get: (key) => getPath(this.config, key),
      has: (key) => hasPath(this.config, key),
    });

    for (const entry of applied) {
      if (entry.ignored) {
        this.henri.pen.warn(
          'config',
          entry.variable,
          `ignored: ${entry.ignored}`
        );
        continue;
      }

      this.henri.pen.info(
        'config',
        'from the environment',
        `${entry.key} = ${display(entry, filters)}`,
        entry.variable
      );
    }
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
module.exports.ALIASES = ALIASES;
module.exports.ENV_JSON_PREFIX = ENV_JSON_PREFIX;
module.exports.ENV_PREFIX = ENV_PREFIX;
module.exports.applyEnv = applyEnv;
module.exports.loadDotEnv = loadDotEnv;
module.exports.withEnv = withEnv;
