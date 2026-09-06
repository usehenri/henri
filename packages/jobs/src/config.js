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
      jobs: value.table || DEFAULTS.table,
      schedules: `${value.table || DEFAULTS.table}_schedules`,
    },
    timeout: duration(value.timeout, DEFAULTS.timeout),
  };
};

module.exports = { DEFAULTS, normalize, queues };
