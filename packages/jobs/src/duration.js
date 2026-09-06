/**
 * Durations are written the way a human says them (`'30s'`, `'5m'`, `'2h'`,
 * `'1d'`) or in milliseconds. Everything the queue stores is milliseconds.
 */

// A Map, not an object: the keys are one letter long on purpose
const UNITS = new Map([
  ['ms', 1],
  ['s', 1000],
  ['m', 60000],
  ['h', 3600000],
  ['d', 86400000],
  ['w', 604800000],
]);

const PATTERN = /^\s*(\d+(?:\.\d+)?)\s*(ms|[smhdw])?\s*$/i;

/**
 * Milliseconds of a duration
 *
 * @param {(number|string|null)} value `'5m'`, `300000`, or nothing
 * @param {?number} [fallback=null] What to answer for an empty value
 * @returns {?number} The duration in milliseconds
 * @throws {Error} When the value is not a duration
 */
const duration = (value, fallback = null) => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return fallback;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid duration: ${value}`);
    }

    return Math.round(value);
  }

  const match = PATTERN.exec(String(value));

  if (!match) {
    throw new Error(
      `Invalid duration "${value}": use a number of milliseconds or 30s, 5m, 2h, 1d`
    );
  }

  const [, amount, unit] = match;

  return Math.round(Number(amount) * UNITS.get((unit || 'ms').toLowerCase()));
};

/**
 * The moment a job should run, from `at` or `wait`
 *
 * @param {object} [options={}] `at` (a Date, an ISO string or a timestamp)
 *   and `wait` (a duration from now)
 * @param {number} [now=Date.now()] The current time
 * @returns {number} A timestamp in milliseconds
 * @throws {Error} When `at` is not a date
 */
const runAt = (options = {}, now = Date.now()) => {
  const { at, wait } = options;

  if (typeof at !== 'undefined' && at !== null) {
    const date = at instanceof Date ? at : new Date(at);
    const time = date.getTime();

    if (Number.isNaN(time)) {
      throw new Error(`Invalid date: ${String(at)}`);
    }

    return time;
  }

  return now + (duration(wait, 0) || 0);
};

module.exports = { duration, runAt };
