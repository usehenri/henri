/**
 * A five field cron parser (minute hour day-of-month month day-of-week).
 *
 * Everything is computed in UTC: a recurring job runs at the same absolute
 * moment wherever the runner is deployed, and no daylight saving change can
 * make an hourly schedule fire twice or not at all. The documentation says
 * so; if a schedule has to follow a wall clock, `every` is not the answer
 * either -- enqueue from a job that knows the zone.
 */

const { coded } = require('./errors');

const MONTHS = {
  apr: 4,
  aug: 8,
  dec: 12,
  feb: 2,
  jan: 1,
  jul: 7,
  jun: 6,
  mar: 3,
  may: 5,
  nov: 11,
  oct: 10,
  sep: 9,
};

const DAYS = { fri: 5, mon: 1, sat: 6, sun: 0, thu: 4, tue: 2, wed: 3 };

const ALIASES = {
  '@annually': '0 0 1 1 *',
  '@daily': '0 0 * * *',
  '@hourly': '0 * * * *',
  '@midnight': '0 0 * * *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@yearly': '0 0 1 1 *',
};

const MINUTE = 60000;

/** Four years of minutes is enough for `0 0 29 2 *` (a leap day) */
const HORIZON = 4 * 366 * 24 * 60;

/**
 * The numeric value of one entry of a field
 *
 * @param {string} token The entry (a number or a name)
 * @param {object} names The names this field accepts
 * @param {string} field The field name, for the error
 * @returns {number} The value
 * @throws {Error} When the entry is not a number or a known name
 */
const value = (token, names, field) => {
  const lower = token.toLowerCase();

  if (Object.prototype.hasOwnProperty.call(names, lower)) {
    return names[lower];
  }

  if (!/^\d+$/.test(token)) {
    throw coded(
      'HENRI_JOB_INVALID_CRON',
      `Invalid ${field} "${token}" in cron expression`
    );
  }

  return Number(token);
};

/**
 * The allowed values of one cron field
 *
 * @param {string} spec The field (`*`, `1-5`, `0/15`, `mon,wed`)
 * @param {number} min The lowest value of the field
 * @param {number} max The highest value of the field
 * @param {string} name The field name, for the errors
 * @param {object} [names={}] The names the field accepts
 * @returns {Set<number>} The values that match
 * @throws {Error} When the field cannot be parsed
 */
const field = (spec, min, max, name, names = {}) => {
  const values = new Set();

  for (const part of String(spec).split(',')) {
    const [range, step = '1'] = part.split('/');

    if (!/^\d+$/.test(step) || Number(step) < 1) {
      throw coded(
        'HENRI_JOB_INVALID_CRON',
        `Invalid step "${step}" in ${name} of a cron expression`
      );
    }

    const by = Number(step);
    let from = min;
    let to = max;

    if (range !== '*' && range !== '') {
      const [start, end] = range.split('-');

      from = value(start, names, name);
      to = typeof end === 'undefined' ? from : value(end, names, name);

      // `5/10` means "from 5 to the end of the field, every 10"
      if (typeof end === 'undefined' && part.includes('/')) {
        to = max;
      }
    }

    if (from < min || to > max || from > to) {
      throw coded(
        'HENRI_JOB_INVALID_CRON',
        `Out of range "${part}" in ${name} of a cron expression (${min}-${max})`
      );
    }

    for (let entry = from; entry <= to; entry += by) {
      values.add(entry);
    }
  }

  return values;
};

/**
 * Parses a cron expression
 *
 * @param {string} expression Five fields, or `@daily`, `@hourly`, ...
 * @returns {object} The parsed schedule
 * @throws {Error} When the expression is invalid
 */
const parse = (expression) => {
  const text = String(expression || '').trim();
  const normalized = ALIASES[text.toLowerCase()] || text;
  const parts = normalized.split(/\s+/);

  if (parts.length !== 5) {
    throw coded(
      'HENRI_JOB_INVALID_CRON',
      `Invalid cron expression "${expression}": expected 5 fields (minute hour day month weekday)`
    );
  }

  const [minute, hour, day, month, weekday] = parts;
  const weekdays = field(weekday, 0, 7, 'weekday', DAYS);

  // Both 0 and 7 are Sunday
  if (weekdays.has(7)) {
    weekdays.add(0);
    weekdays.delete(7);
  }

  return {
    days: field(day, 1, 31, 'day of month'),
    everyDay: day === '*',
    everyWeekday: weekday === '*',
    hours: field(hour, 0, 23, 'hour'),
    minutes: field(minute, 0, 59, 'minute'),
    months: field(month, 1, 12, 'month', MONTHS),
    weekdays,
  };
};

/**
 * Does this date fall on a day the schedule wants?
 *
 * Cron's oddity: when both the day of the month and the weekday are
 * restricted, either one matching is enough.
 *
 * @param {object} schedule A parsed schedule
 * @param {Date} date The date to test (read in UTC)
 * @returns {boolean} Whether the day matches
 */
const matchesDay = (schedule, date) => {
  const day = schedule.days.has(date.getUTCDate());
  const weekday = schedule.weekdays.has(date.getUTCDay());

  if (schedule.everyDay && schedule.everyWeekday) {
    return true;
  }

  if (schedule.everyDay) {
    return weekday;
  }

  if (schedule.everyWeekday) {
    return day;
  }

  return day || weekday;
};

/**
 * The first moment after `from` that the expression matches
 *
 * @param {(string|object)} expression A cron expression or a parsed schedule
 * @param {number} [from=Date.now()] The moment to start from (exclusive)
 * @returns {?number} A timestamp in milliseconds, or null when the
 *   expression can never match again (`0 0 30 2 *`)
 * @throws {Error} When the expression is invalid
 */
const next = (expression, from = Date.now()) => {
  const schedule =
    typeof expression === 'string' ? parse(expression) : expression;
  const date = new Date(Math.floor(from / MINUTE) * MINUTE + MINUTE);

  for (let guard = 0; guard < HORIZON; guard += 1) {
    if (!schedule.months.has(date.getUTCMonth() + 1)) {
      date.setUTCMonth(date.getUTCMonth() + 1, 1);
      date.setUTCHours(0, 0, 0, 0);
      continue;
    }

    if (!matchesDay(schedule, date)) {
      date.setUTCDate(date.getUTCDate() + 1);
      date.setUTCHours(0, 0, 0, 0);
      continue;
    }

    if (!schedule.hours.has(date.getUTCHours())) {
      date.setUTCHours(date.getUTCHours() + 1, 0, 0, 0);
      continue;
    }

    if (!schedule.minutes.has(date.getUTCMinutes())) {
      date.setUTCMinutes(date.getUTCMinutes() + 1, 0, 0);
      continue;
    }

    return date.getTime();
  }

  return null;
};

module.exports = { next, parse };
