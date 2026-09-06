const { duration } = require('@usehenri/jobs');

const { coded } = require('./errors');

/**
 * The `webhooks` block of `config/<env>.json`, with every default filled in.
 *
 * The durations are read by the queue's own parser, so `'10s'` means the
 * same thing in `webhooks.timeout` as it does in `jobs.timeout`.
 *
 * The retry policy is the queue's, and only its numbers are different:
 * eight attempts with a base of ten seconds tripling up to six hours is
 * roughly three days of trying, which is what a receiver that is down for a
 * weekend needs and what Stripe settled on. A delivery that runs out of
 * attempts is in the dead letter queue, not gone.
 */

const DEFAULTS = {
  allowHttp: false,
  allowPrivate: false,
  backoff: { base: '10s', factor: 3, jitter: 0.2, max: '6h' },
  install: true,
  maxAttempts: 8,
  maxFanout: 1000,
  queue: 'webhooks',
  store: 'default',
  table: 'henri_webhooks',
  timeout: '10s',
};

/**
 * Checks a table name before it is written into every statement
 *
 * The table name is configuration and not request input, but an application
 * may set any key from the environment, and a name that is not a plain
 * identifier gives a syntax error deep in a query instead of a sentence
 * here.
 *
 * @param {string} value The name
 * @returns {string} The name
 * @throws {Error} HENRI_CONFIG_INVALID when it is not a plain identifier
 */
const table = (value) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw coded(
      'HENRI_CONFIG_INVALID',
      `@usehenri/webhooks: invalid table name "${value}": letters, digits and underscores only`
    );
  }

  return value;
};

/**
 * The webhooks configuration of an application
 *
 * @param {object} [config={}] The `webhooks` block
 * @returns {object} The configuration, with the defaults filled in
 * @throws {Error} When a duration or the table name is invalid
 */
const normalize = (config = {}) => {
  const value = config || {};
  const backoff = { ...DEFAULTS.backoff, ...(value.backoff || {}) };
  const name = table(value.table || DEFAULTS.table);

  return {
    allowHttp: value.allowHttp === true,
    allowPrivate: value.allowPrivate === true,
    backoff: {
      base: duration(backoff.base, 10000),
      factor: Number(backoff.factor) || DEFAULTS.backoff.factor,
      jitter: Math.min(Math.max(Number(backoff.jitter) || 0, 0), 1),
      max: duration(backoff.max, 21600000),
    },
    install: value.install !== false,
    maxAttempts: Math.max(1, Number(value.maxAttempts) || DEFAULTS.maxAttempts),
    maxFanout: Math.max(1, Number(value.maxFanout) || DEFAULTS.maxFanout),
    queue: value.queue || DEFAULTS.queue,
    store: value.store || DEFAULTS.store,
    tables: { endpoints: name },
    timeout: duration(value.timeout, 10000),
  };
};

module.exports = { DEFAULTS, normalize, table };
