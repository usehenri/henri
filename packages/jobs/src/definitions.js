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

/**
 * Reads and checks one definition
 *
 * @param {string} name The job name
 * @param {object} definition What the file exports
 * @param {object} defaults The queue defaults (`queue`, `maxAttempts`, ...)
 * @returns {object} The definition, with the defaults filled in
 * @throws {JobError} BAD_JOB when the file does not export a `perform`
 */
const validate = (name, definition, defaults) => {
  if (!definition || typeof definition.perform !== 'function') {
    throw new JobError(
      'BAD_JOB',
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

module.exports = { load, validate };
