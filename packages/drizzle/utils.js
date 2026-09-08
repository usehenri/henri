// Keys whose values must never reach the logs
const SECRET_KEYS = /^(pass(word)?|secret|token|auth)$/i;

/**
 * Masks the password of a connection url (user:secret@host -> user:***@host)
 *
 * @param {string} url A connection url
 * @returns {string} The url with its password masked
 */
const redactUrl = (url) =>
  url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^:/@]*):[^@]*@/i, '$1:***@');

/**
 * Returns a copy of a configuration value with credentials masked, for logs
 *
 * @param {*} value A configuration value (string, array or plain object)
 * @returns {*} The redacted copy
 */
const redact = (value) => {
  if (typeof value === 'string') {
    return redactUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (isPlainObject(value)) {
    return Object.keys(value).reduce((copy, key) => {
      copy[key] = SECRET_KEYS.test(key) ? '***' : redact(value[key]);

      return copy;
    }, {});
  }

  return value;
};

/**
 * Normalizes an email the way the user model stores it
 *
 * @param {*} email An email
 * @returns {*} The trimmed, lowercased email (other values untouched)
 */
const normalizeEmail = (email) =>
  typeof email === 'string' ? email.trim().toLowerCase() : email;

/**
 * An Error carrying one of henri's error codes
 *
 * A code is a string and nothing more (`@usehenri/core/error-codes.json` is
 * the catalogue), so an adapter names its failures without depending on core.
 *
 * @param {string} code The henri error code (HENRI_MODEL_UNKNOWN_TYPE, ...)
 * @param {string} message What went wrong
 * @param {string} [hint] What to do about it, for the command line
 * @returns {Error} The error to throw
 */
const coded = (code, message, hint) =>
  Object.assign(new Error(message), hint ? { code, hint } : { code });

/**
 * Logs a fatal error through henri's pen and returns the Error to throw
 *
 * @param {Henri} thisHenri Current henri instance
 * @param {string} name Adapter name
 * @param {string} message The error message
 * @param {?string} [code=null] The henri error code of this failure
 * @returns {Error} The error to throw
 */
const fatal = (thisHenri, name, message, code = null) => {
  const pen = thisHenri && thisHenri.pen;
  const args = code ? [name, message, null, null, code] : [name, message];
  const logged =
    pen && typeof pen.fatal === 'function' ? pen.fatal(...args) : null;

  return logged instanceof Error
    ? logged
    : (code && coded(code, message)) || new Error(message);
};

/**
 * Is the value a plain object (a field definition, a where clause, ...)?
 *
 * @param {*} value Any value
 * @returns {boolean} true for plain objects
 */
const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

/**
 * Camel or Pascal case to snake_case (`createdAt` -> `created_at`,
 * `HighScore` -> `high_score`)
 *
 * @param {string} name A name
 * @returns {string} Its snake_case form
 */
const snakeCase = (name) =>
  String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();

/**
 * Lowercases the first letter (`HighScore` -> `highScore`)
 *
 * @param {string} name A name
 * @returns {string} The name with a lowercase first letter
 */
const lowerFirst = (name) => name.charAt(0).toLowerCase() + name.slice(1);

/**
 * Pluralize an english word (the same rules as the CLI generators:
 * task -> tasks, category -> categories, box -> boxes, person -> people)
 *
 * @param {string} word A singular word
 * @returns {string} Its plural
 */
const pluralize = (word) => {
  const irregulars = {
    child: 'children',
    man: 'men',
    person: 'people',
    woman: 'women',
  };
  const lower = word.toLowerCase();
  const tail = lower.split('_').pop();

  if (irregulars[tail]) {
    return lower.slice(0, lower.length - tail.length) + irregulars[tail];
  }

  if (/(s|x|z|ch|sh)$/.test(lower)) {
    return `${lower}es`;
  }

  if (/[^aeiou]y$/.test(lower)) {
    return `${lower.slice(0, -1)}ies`;
  }

  return `${lower}s`;
};

/**
 * The table of a model: its `name` export, or the Rails convention
 * (`HighScore` -> `high_scores`)
 *
 * @param {object} model A model file with its `globalId`
 * @returns {string} The table name
 */
const tableNameOf = (model) =>
  model.name || pluralize(snakeCase(model.globalId || model.identity));

/**
 * Coerces any stored roles value to a list of roles
 *
 * @param {*} value A list, a JSON string, a single role or null
 * @returns {Array<string>} The roles
 */
const toRoles = (value) => {
  if (Array.isArray(value)) {
    return value.flat();
  }

  if (value === null || typeof value === 'undefined') {
    return [];
  }

  if (typeof value === 'string') {
    try {
      return toRoles(JSON.parse(value));
    } catch (error) {
      return [value];
    }
  }

  return [value];
};

/**
 * Runs a function with the drizzle-kit progress spinners silenced (they are
 * written to stdout even without a terminal)
 *
 * @param {function} fn The function to run
 * @returns {Promise<*>} What fn returns
 */
const quiet = async (fn) => {
  const { write } = process.stdout;
  const escape = String.fromCharCode(27);
  const clearLine = `${escape}[2K${escape}[1G`;

  process.stdout.write = (chunk, ...rest) => {
    if (
      typeof chunk === 'string' &&
      (chunk.includes('Pulling schema from database') || chunk === clearLine)
    ) {
      return true;
    }

    return write.call(process.stdout, chunk, ...rest);
  };

  try {
    return await fn();
  } finally {
    process.stdout.write = write;
  }
};

/**
 * Runs a function that must not be allowed to end this process.
 *
 * drizzle-kit renders its progress with a terminal view, and the one thing
 * that view does with a task that rejects is `process.exit(1)`: the error
 * is handed to a renderer that prints a spinner and is then thrown away. So
 * a failure inside `pushMySQLSchema` -- a schema it cannot read back --
 * takes `henri db:push`, the development boot and the test worker down with
 * exit code 1 and not one word about what happened, which is the worst
 * failure henri has: nothing to read and nothing to search for.
 *
 * There is no hook to register and no error to catch, so the exit itself is
 * what is caught: `process.exit` is replaced for the length of the call
 * and, when the library reaches for it, throws instead -- inside the catch
 * block that was about to exit, so the rejection surfaces at the caller.
 * The cause is gone by then (the library discarded it) and the message says
 * so rather than inventing one.
 *
 * @param {string} code The henri error code to raise
 * @param {string} message What to say when the call ends the process
 * @param {string} hint What to do about it
 * @param {function} fn The function to run
 * @returns {Promise<*>} What fn returns
 * @throws {Error} The coded error, when fn ended the process
 */
const guarded = async (code, message, hint, fn) => {
  const { exit } = process;
  const marker = Symbol('henri.exit');

  process.exit = (status) => {
    throw Object.assign(new Error(message), { [marker]: status });
  };

  try {
    return await fn();
  } catch (error) {
    if (error && typeof error === 'object' && marker in error) {
      throw coded(code, message, hint);
    }

    throw error;
  } finally {
    process.exit = exit;
  }
};

module.exports = {
  coded,
  fatal,
  guarded,
  isPlainObject,
  lowerFirst,
  normalizeEmail,
  pluralize,
  quiet,
  redact,
  redactUrl,
  snakeCase,
  tableNameOf,
  toRoles,
};
