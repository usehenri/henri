const { next, parse } = require('./cron');
const { duration } = require('./duration');

/**
 * The `jobs` block of `config/<env>.json`, with every default filled in.
 */

const DEFAULTS = {
  backoff: { base: '5s', factor: 4, jitter: 0.15, max: '1h' },
  concurrency: 5,
  install: true,
  keepCompleted: '1d',
  mailQueue: 'mailers',
  maxArgsBytes: 512 * 1024,
  maxAttempts: 5,
  pollInterval: '1s',
  priority: 0,
  queue: 'default',
  queues: [],
  recurring: {},
  store: 'default',
  stuckAfter: '5m',
  table: 'henri_jobs',
  timeout: null,
};

/**
 * A list of queue names from a string or an array
 *
 * @param {(string|Array<string>|null)} value `'a,b'`, `['a', 'b']` or nothing
 * @returns {Array<string>} The queue names
 */
const queues = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
};

/**
 * Reads a recurring schedule
 *
 * @param {string} name The schedule name
 * @param {object} entry Its configuration
 * @returns {object} The normalized schedule
 * @throws {Error} When it has neither `cron` nor `every`, or names no job
 */
const recurring = (name, entry) => {
  const value = entry || {};
  const job = value.job || value.name || name;

  if (!value.cron && !value.every) {
    throw new Error(
      `@usehenri/jobs: the recurring schedule "${name}" needs a "cron" or an "every"`
    );
  }

  if (value.cron && value.every) {
    throw new Error(
      `@usehenri/jobs: the recurring schedule "${name}" has both a "cron" and an "every": pick one`
    );
  }

  // Parsed here, not on the first tick of a runner: an expression a runner
  // cannot read would otherwise throw inside its loop, every second, with
  // nothing being claimed while it does
  if (value.cron) {
    try {
      if (next(parse(value.cron)) === null) {
        throw new Error(`"${value.cron}" can never come round`);
      }
    } catch (error) {
      throw new Error(
        `@usehenri/jobs: the recurring schedule "${name}" is invalid: ${error.message}`,
        { cause: error }
      );
    }
  }

  if (value.every && duration(value.every) < 1000) {
    throw new Error(
      `@usehenri/jobs: the recurring schedule "${name}" runs every ${value.every}, which is under a second`
    );
  }

  return {
    args: typeof value.args === 'undefined' ? null : value.args,
    cron: value.cron || null,
    every: value.every ? duration(value.every) : null,
    job,
    name,
    priority: typeof value.priority === 'number' ? value.priority : null,
    queue: value.queue || null,
    spec: value.cron ? `cron:${value.cron}` : `every:${duration(value.every)}`,
  };
};

/**
 * Checks a table name before it is written into every statement
 *
 * The queue interpolates its table names: they are configuration, not
 * request input, but an application may now set any key from the
 * environment, and a name that is not a plain identifier gives a syntax
 * error deep in a query instead of a sentence here.
 *
 * @param {string} value The name
 * @returns {string} The name
 * @throws {Error} When it is not a plain identifier
 */
const table = (value) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(
      `@usehenri/jobs: invalid table name "${value}": letters, digits and underscores only`
    );
  }

  return value;
};

/**
 * The jobs configuration of an application
 *
 * @param {object} [config={}] The `jobs` block of the configuration
 * @returns {object} The configuration, with the defaults filled in
 * @throws {Error} When a duration or a schedule is invalid
 */
const normalize = (config = {}) => {
  const value = config || {};
  const backoff = { ...DEFAULTS.backoff, ...(value.backoff || {}) };
  const schedules = value.recurring || DEFAULTS.recurring;

  return {
    backoff: {
      base: duration(backoff.base, 5000),
      factor: Number(backoff.factor) || 4,
      jitter: Math.min(Math.max(Number(backoff.jitter) || 0, 0), 1),
      max: duration(backoff.max, 3600000),
    },
    concurrency: Math.max(1, Number(value.concurrency) || DEFAULTS.concurrency),
    install: value.install !== false,
    keepCompleted: duration(
      value.keepCompleted,
      duration(DEFAULTS.keepCompleted)
    ),
    mailQueue: value.mailQueue || DEFAULTS.mailQueue,
    maxArgsBytes: Number(value.maxArgsBytes) || DEFAULTS.maxArgsBytes,
    maxAttempts: Math.max(1, Number(value.maxAttempts) || DEFAULTS.maxAttempts),
    pollInterval: Math.max(
      50,
      duration(value.pollInterval, duration(DEFAULTS.pollInterval))
    ),
    priority: Number(value.priority) || DEFAULTS.priority,
    queue: value.queue || DEFAULTS.queue,
    queues: queues(value.queues),
    recurring: Object.keys(schedules)
      .sort()
      .map((name) => recurring(name, schedules[name])),
    store: value.store || DEFAULTS.store,
    stuckAfter: duration(value.stuckAfter, duration(DEFAULTS.stuckAfter)),
    tables: {
      jobs: table(value.table || DEFAULTS.table),
      schedules: `${table(value.table || DEFAULTS.table)}_schedules`,
    },
    timeout: duration(value.timeout, DEFAULTS.timeout),
  };
};

module.exports = { DEFAULTS, normalize, queues, table };
