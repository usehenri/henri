const BaseModule = require('./base/module');
const credentials = require('./base/credentials');
const fs = require('fs');
const path = require('path');
const { syntax } = require('./utils');
const { fail } = require('./base/errors');
const { MASK, filterParameters, isFiltered, redact } = require('./base/redact');
const {
  ConfigurationError,
  coercionFor,
  validate,
} = require('./base/config-validate');

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
  // Comma separated, primary first, because a rotation needs two of them
  // at once and a shell variable holds one string
  { key: 'encryption.keys', split: true, variable: 'HENRI_ENCRYPTION_KEYS' },
];

/**
 * Configuration paths whose value is a secret whatever `filterParameters`
 * says, because their *name* does not read like one.
 *
 * `encryption.keys` is the whole point of the list: a key that reaches a
 * log line, a boot report or a validation message is a key that has to be
 * rotated. A path here is masked wherever it is printed, and so is
 * everything under it.
 *
 * This covers the paths henri prints itself. What an application prints --
 * `pen.info('boot', henri.config.get())`, which a structured line
 * serializes faithfully -- is covered by the `ALWAYS_MASKED` of
 * `base/redact.js`, the same names as a substring rule over any object.
 */
const ALWAYS_MASKED = ['encryption.keys'];

/**
 * Is this configuration path one that is never printed?
 *
 * The index form matters as much as the dotted one: a list of keys is
 * validated item by item, so the path that reaches a message is
 * `encryption.keys[0]`, and a *nearly* correct key -- one with a newline
 * around it, or 63 characters instead of 64 -- is the value a validation
 * message would otherwise quote.
 *
 * @param {string} key a configuration path
 * @returns {boolean} true when it, or a path above it, is always masked
 */
const isSecretPath = (key) =>
  ALWAYS_MASKED.some(
    (owned) =>
      key === owned ||
      String(key).startsWith(`${owned}.`) ||
      String(key).startsWith(`${owned}[`)
  );

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
    throw fail('HENRI_CONFIG_ENV_NOT_JSON', `${variable} is not valid JSON`);
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
 * The type a value already has, as the schema names it
 *
 * @param {any} value the value
 * @returns {string} `number`, `boolean`, `object` or `string`
 */
function kindOf(value) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return typeof value;
  }

  return value !== null && typeof value === 'object' ? 'object' : 'string';
}

/**
 * The value of an environment variable, as the type that key already has
 *
 * The type comes from the configuration file when it has a value at that
 * path, and from henri's schema when it does not (`port` is a number even
 * in an application whose file never names it). A key henri does not own
 * and the file does not have is a string: henri never guesses. Use
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
  const known = typeof current !== 'undefined';
  const kind = known ? kindOf(current) : coercionFor(key, raw);
  const where = known ? 'in the configuration' : "in henri's schema";

  if (kind === 'number') {
    const value = Number(raw);

    if (!Number.isFinite(value)) {
      throw fail(
        'HENRI_CONFIG_ENV_TYPE',
        `${variable} is not a number, and "${key}" is one ${where}`
      );
    }

    return value;
  }

  if (kind === 'boolean') {
    if (/^(true|false)$/i.test(raw)) {
      return /^true$/i.test(raw);
    }

    throw fail(
      'HENRI_CONFIG_ENV_TYPE',
      `${variable} is not true or false, and "${key}" is a boolean ${where}`
    );
  }

  if (kind === 'object') {
    const value = tryJson(raw);

    if (value === null || typeof value !== 'object') {
      throw fail(
        'HENRI_CONFIG_ENV_TYPE',
        `${variable} is not a JSON object, and "${key}" is one ${where}`
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
      throw fail(
        'HENRI_CONFIG_ENV_NO_KEY',
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
 * Precedence, lowest first: the configuration file, the credentials of the
 * environment (applyCredentials), the named shorthands (HENRI_SECRET,
 * HENRI_HOST, DATABASE_URL), then the generic overrides
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

    const value = alias.split
      ? raw
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== '')
      : coerce(raw, getPath(result, alias.key), alias);

    result = setPath(result, alias.key, value);
    applied.push({ key: alias.key, value, variable: alias.variable });
  }

  for (const entry of overrides(env)) {
    const raw = env[entry.variable];

    if (raw.trim() === '') {
      throw fail(
        'HENRI_CONFIG_ENV_EMPTY',
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
 * The configuration, with `config/credentials/<env>.json.enc` applied over it
 *
 * Every leaf of the decrypted object replaces the value the file has at that
 * path, so a credentials file holding `{ "mail": { "auth": { "pass": "x" } } }`
 * leaves the rest of `mail` alone.
 *
 * @param {object} config parsed configuration
 * @param {string} cwd the application directory
 * @param {string} env the environment
 * @param {object} [environment=process.env] the environment variables
 * @returns {{applied: Array<string>, config: object, file: ?string, source: ?string}}
 *   the configuration, the paths the credentials provided, the file they
 *   came from and where the key came from
 * @throws {Error} when the file exists and cannot be opened
 */
function applyCredentials(config, cwd, env, environment = process.env) {
  const secrets = credentials.read(cwd, env, environment);

  if (!secrets) {
    return { applied: [], config, file: null, source: null };
  }

  return {
    applied: secrets.entries.map((entry) => entry.key),
    config: secrets.entries.reduce(
      (current, entry) => setPath(current, entry.key, entry.value),
      config
    ),
    file: path.relative(cwd, secrets.file),
    source: secrets.source,
  };
}

/**
 * Where every value of a configuration came from
 *
 * A source registered at a path answers for everything under it, so the
 * `rateLimit` an environment variable set is also the source of
 * `rateLimit.max`. Anything no source claims comes from the file.
 *
 * @param {string} file the configuration file that loaded
 * @param {object} secrets what applyCredentials() returned
 * @param {Array<object>} applied what applyEnv() applied
 * @returns {function} `(key) => string`, the source of a key
 */
function provenance(file, secrets, applied) {
  const owners = [];

  for (const key of secrets.applied) {
    owners.push([key, `the credentials (${secrets.file})`]);
  }

  for (const entry of applied) {
    if (!entry.ignored) {
      owners.push([entry.key, entry.variable]);
    }
  }

  return (key) => {
    let found = file;
    let longest = -1;

    for (const [owned, label] of owners) {
      const covers =
        key === owned ||
        key.startsWith(`${owned}.`) ||
        key.startsWith(`${owned}[`);

      if (covers && owned.length > longest) {
        found = label;
        longest = owned.length;
      }
    }

    return found;
  };
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
/** The password of a connection string: `postgres://user:secret@host/db` */
const CREDENTIALS = /^([a-z][a-z0-9+.-]*:\/\/[^:@/\s]+):[^@\s/]*@/iu;

/** How deep the walk goes, the same bound `base/redact.js` uses */
const CREDENTIALS_DEPTH = 8;

/**
 * The same value with the password of every connection string in it masked.
 *
 * A url is the one secret no filter list ever names: nobody writes `url` in
 * `filterParameters`, and the password lives inside the string rather than
 * under a key of its own. The scalar case was always masked -- `DATABASE_URL`
 * prints `postgres://henri:[FILTERED]@...` -- but the same value arriving as
 * part of an object (`HENRI_CONFIG_JSON__stores`, a credentials file) went
 * through the key-name redaction, which has no key to match here, and printed
 * the password in the clear.
 *
 * @param {*} value a configuration value, of any shape
 * @param {number} [depth=0] how deep the walk is
 * @returns {*} the value, with every connection string masked
 */
function withoutCredentials(value, depth = 0) {
  if (typeof value === 'string') {
    return value.replace(CREDENTIALS, `$1:${MASK}@`);
  }

  if (
    value === null ||
    typeof value !== 'object' ||
    depth >= CREDENTIALS_DEPTH
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => withoutCredentials(entry, depth + 1));
  }

  const copy = {};

  for (const [key, held] of Object.entries(value)) {
    copy[key] = withoutCredentials(held, depth + 1);
  }

  return copy;
}

function display(entry, filters) {
  const { key, value, variable } = entry;
  const last = segments(key).pop();

  if (
    isSecretPath(key) ||
    isFiltered(last, filters) ||
    isFiltered(variable, filters)
  ) {
    return MASK;
  }

  if (value !== null && typeof value === 'object') {
    return JSON.stringify(withoutCredentials(redact(value, filters)));
  }

  return withoutCredentials(String(value));
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
    this.fromCredentials = [];
    /** `(key) => where the value came from`, set once the file has loaded */
    this.provenance = null;

    this.get = this.get.bind(this);
    this.sourceOf = this.sourceOf.bind(this);
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

    const env = this.henri.env || 'dev';
    const configPath = path.join(this.henri.cwd(), 'config', `${env}.json`);
    const defaultPath = path.join(this.henri.cwd(), 'config', 'default.json');

    let hasErrors = false;
    let loaded = null;
    let source = null;

    for (const file of [configPath, defaultPath]) {
      if (loaded) {
        break;
      }

      try {
        loaded = require(file);
        source = path.relative(this.henri.cwd(), file);
      } catch (error) {
        if (await syntax(file, null, this.henri)) {
          hasErrors = true;
        }
      }
    }

    if (loaded) {
      // Outside the try above: a credentials file that will not open, and a
      // wrong environment variable, are boot failures of their own, never a
      // reason to fall back to another file
      const secrets = applyCredentials(loaded, this.henri.cwd(), env);
      const { applied, config } = applyEnv(secrets.config);

      this.config = config;
      this.fromEnv = applied.map(({ key, variable }) => ({ key, variable }));
      this.fromCredentials = secrets.applied;
      this.provenance = provenance(source, secrets, applied);

      Object.freeze(this.config);
      this.report(applied, secrets);
      this.check(this.provenance);

      return this.name;
    }

    if (hasErrors) {
      throw fail('HENRI_CONFIG_UNREADABLE', 'Unable to load configuration');
    }

    this.henri.pen.error('config', 'no configuration has been loaded...');
    this.henri.pen.error('config', 'attempted', configPath);
    this.henri.pen.error('config', 'attempted', defaultPath);
  }

  /**
   * Prints the keys the environment and the credentials provided, so nobody
   * debugs a value they cannot see. Filtered parameters are masked, and a
   * credentials line is names only: every value in that file is a secret.
   *
   * @param {Array<object>} applied what applyEnv() applied
   * @param {object} [secrets] what applyCredentials() applied
   * @returns {void}
   * @memberof Config
   */
  report(applied, secrets = { applied: [], source: null }) {
    const filters = filterParameters({
      get: (key) => getPath(this.config, key),
      has: (key) => hasPath(this.config, key),
    });

    if (secrets.applied.length > 0) {
      this.henri.pen.info(
        'config',
        'from the credentials',
        secrets.applied.join(', '),
        `key: ${secrets.source}`
      );
    }

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
   * Runs the whole configuration through the schema, before any other
   * module starts. `config` is the first module of runlevel 0 and every
   * other one is above it, so nothing has read a wrong value yet.
   *
   * Every problem is reported, not the first: warnings are printed and the
   * boot goes on, errors are printed and thrown together as one
   * ConfigurationError naming the key, what was expected, what arrived and
   * where it came from -- the file, the credentials or the variable.
   *
   * @param {function} source `(key) => string`, where a value came from
   * @returns {Array<object>} the warnings
   * @throws {ConfigurationError} when a value is not what henri accepts
   * @memberof Config
   */
  check(source) {
    const { pen } = this.henri;
    const filters = filterParameters({
      get: (key) => getPath(this.config, key),
      has: (key) => hasPath(this.config, key),
    });
    const mask = (key) =>
      isSecretPath(key) ||
      isFiltered(segments(key).pop() || key, filters) ||
      String(source(key)).startsWith('the credentials');
    const { errors, warnings } = validate(this.config, { mask, source });

    for (const problem of [...warnings, ...errors]) {
      const write = problem.level === 'error' ? pen.error : pen.warn;

      write.call(pen, 'config', problem.message, `from ${problem.source}`);

      if (problem.hint) {
        write.call(pen, 'config', problem.hint);
      }
    }

    if (errors.length > 0) {
      throw new ConfigurationError(errors);
    }

    return warnings;
  }

  /**
   * Where a value came from: the configuration file, the credentials or
   * the environment variable that set it.
   *
   * It is a name, never a value, so it is safe to put in an error message
   * about a key nobody may print -- which is what `henri.encryption` does
   * when it says where it read its keys.
   *
   * @param {string} key Configuration key
   * @returns {string} What set it
   * @memberof Config
   */
  sourceOf(key) {
    return this.provenance ? this.provenance(key) : `config.${key}`;
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
      throw fail(
        'HENRI_CONFIG_UNKNOWN_KEY',
        `Config key ${key} does not exist`
      );
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
module.exports.ALWAYS_MASKED = ALWAYS_MASKED;
module.exports.applyCredentials = applyCredentials;
module.exports.display = display;
module.exports.isSecretPath = isSecretPath;
module.exports.provenance = provenance;
module.exports.applyEnv = applyEnv;
module.exports.loadDotEnv = loadDotEnv;
module.exports.withEnv = withEnv;
