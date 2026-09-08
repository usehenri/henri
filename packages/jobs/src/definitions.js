const path = require('path');
const { globSync } = require('glob');

const { duration } = require('./duration');
const { JobError } = require('./errors');

/**
 * Job definitions live in `app/jobs`, in the shape henri already uses for
 * models and controllers: a file exports an object. The name of a job is its
 * path under `app/jobs` without the extension, so `app/jobs/mail/welcome.js`
 * is the job `mail/welcome`.
 */

/** The widest a concurrency key may be: the column that holds it */
const KEY_LENGTH = 190;

/**
 * Reads a job's `concurrency` declaration
 *
 * `1` is `{ limit: 1 }`; a `key` is a field of the arguments or a function
 * of them, and a `group` is the name several jobs share a bound under. The
 * default group is the job's own name, so a limit is that job's alone
 * unless it says otherwise.
 *
 * The limit belongs to the **job**, never to the call: an option of
 * `perform()` would let one caller step outside a bound the job declared,
 * which is the one thing a bound is for.
 *
 * @param {string} name The job name
 * @param {(number|object|null)} value What the file declared
 * @returns {?object} `{ group, key, limit }`, or null
 * @throws {JobError} HENRI_JOB_INVALID_CONCURRENCY on anything else
 */
const concurrency = (name, value) => {
  if (value === null || typeof value === 'undefined' || value === false) {
    return null;
  }

  const declared = typeof value === 'number' ? { limit: value } : value;
  const refuse = (why) => {
    throw new JobError(
      'HENRI_JOB_INVALID_CONCURRENCY',
      `The job "${name}" declares a concurrency limit that cannot be read: ${why}`,
      {
        hint: '`concurrency: 3`, or `concurrency: { limit: 3, key: "tenantId" }` to bound each key of its own',
        job: name,
      }
    );
  };

  if (typeof declared !== 'object') {
    refuse('it is neither a number nor an object');
  }

  const limit = Number(declared.limit);

  if (!Number.isInteger(limit) || limit < 1) {
    refuse(
      `its limit is ${JSON.stringify(declared.limit)}, not a whole number above zero`
    );
  }

  const group =
    typeof declared.group === 'undefined' || declared.group === null
      ? name
      : declared.group;

  if (typeof group !== 'string' || group === '') {
    refuse('its group is not a name');
  }

  if (group.length > KEY_LENGTH) {
    refuse(`its group is longer than ${KEY_LENGTH} characters`);
  }

  const { key } = declared;

  if (
    typeof key !== 'undefined' &&
    key !== null &&
    typeof key !== 'string' &&
    typeof key !== 'function'
  ) {
    refuse('its key is neither the name of an argument nor a function of them');
  }

  return {
    group,
    key:
      typeof key === 'string'
        ? (args) => (args ? args[key] : null)
        : key || null,
    limit,
  };
};

/**
 * The concurrency key of one call, or null when the job is unbounded
 *
 * A key that resolves to nothing is the group's own bucket, which is also
 * where a job enqueued before the limit was declared sits: the two mean the
 * same thing, so they share a bound rather than each getting one.
 *
 * @param {object} definition A validated definition
 * @param {*} args What perform() will receive
 * @returns {?string} The key to store
 * @throws {JobError} HENRI_JOB_INVALID_CONCURRENCY when the key cannot be read
 */
const keyOf = (definition, args) => {
  const bound = definition && definition.concurrency;

  if (!bound) {
    return null;
  }

  if (!bound.key) {
    return bound.group;
  }

  let value;

  try {
    value = bound.key(args);
  } catch (error) {
    throw new JobError(
      'HENRI_JOB_INVALID_CONCURRENCY',
      `The concurrency key of "${definition.name}" could not be read: ${error.message}`,
      { cause: error, job: definition.name }
    );
  }

  if (value === null || typeof value === 'undefined' || value === '') {
    return bound.group;
  }

  if (typeof value === 'object') {
    throw new JobError(
      'HENRI_JOB_INVALID_CONCURRENCY',
      `The concurrency key of "${definition.name}" is an object; it has to be a value that names one bound`,
      { job: definition.name }
    );
  }

  const key = `${bound.group}:${String(value)}`;

  if (key.length > KEY_LENGTH) {
    throw new JobError(
      'HENRI_JOB_INVALID_CONCURRENCY',
      `The concurrency key of "${definition.name}" is ${key.length} characters, over the ${KEY_LENGTH} that are stored`,
      {
        hint: 'A key names a bound, so it is an id or a tenant name; hash it yourself if it has to be longer',
        job: definition.name,
      }
    );
  }

  return key;
};

/**
 * Reads and checks one definition
 *
 * @param {string} name The job name
 * @param {object} definition What the file exports
 * @param {object} defaults The queue defaults (`queue`, `maxAttempts`, ...)
 * @returns {object} The definition, with the defaults filled in
 * @throws {JobError} HENRI_JOB_INVALID_DEFINITION without a `perform`
 */
const validate = (name, definition, defaults) => {
  if (!definition || typeof definition.perform !== 'function') {
    throw new JobError(
      'HENRI_JOB_INVALID_DEFINITION',
      `app/jobs/${name}.js does not export a perform(args, context) function`,
      { job: name }
    );
  }

  const backoff = definition.backoff || {};

  return {
    backoff: {
      base: duration(backoff.base, defaults.backoff.base),
      factor: Number(backoff.factor) || defaults.backoff.factor,
      jitter:
        typeof backoff.jitter === 'number'
          ? backoff.jitter
          : defaults.backoff.jitter,
      max: duration(backoff.max, defaults.backoff.max),
    },
    concurrency: concurrency(name, definition.concurrency),
    maxAttempts: Math.max(
      1,
      Number(definition.maxAttempts) || defaults.maxAttempts
    ),
    name,
    perform: definition.perform,
    priority:
      typeof definition.priority === 'number'
        ? definition.priority
        : defaults.priority,
    queue: definition.queue || defaults.queue,
    timeout: duration(definition.timeout, defaults.timeout),
  };
};

/**
 * Loads every job of an application
 *
 * @param {string} location The `app/jobs` directory
 * @param {object} defaults The queue defaults
 * @returns {object} The definitions, by name
 * @throws {JobError} BAD_JOB when a file is not a job
 */
const load = (location, defaults) => {
  const dirname = path.resolve(location);
  const definitions = {};
  const files = globSync('**/*.js', {
    cwd: dirname,
    ignore: ['**/node_modules/**'],
    nodir: true,
    posix: true,
  }).sort();

  for (const file of files) {
    const full = path.join(dirname, file);
    const name = file.replace(/\.js$/, '');

    delete require.cache[require.resolve(full)];

    definitions[name] = validate(name, require(full), defaults);
  }

  return definitions;
};

module.exports = { KEY_LENGTH, concurrency, keyOf, load, validate };
