/**
 * The server this package's suites run against.
 *
 * Nothing set: the live suites are skipped and `pnpm test` stays offline,
 * like the SQL adapters (`packages/sequelize/__tests__/targets.js`). With
 * `HENRI_TEST_REDIS_URL` in the environment they run against that server,
 * in a database of their own so nothing else on it is touched, and every
 * key gets a prefix unique to the worker so parallel files never collide.
 *
 * ```bash
 * pnpm db:up                 # compose.yaml starts one on 6379
 * pnpm test:redis            # the suites against it
 * ```
 */

/** The server, or null when the suites should skip */
const url = process.env.HENRI_TEST_REDIS_URL || null;

/** Whether a live server was named */
const live = Boolean(url);

// One prefix per process, so parallel workers never read each other's keys
const RUN = `${process.pid.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * A prefix nothing else in this run uses
 *
 * @param {string} name what the keys are for
 * @returns {string} the prefix
 */
const prefix = (name) => `henri-test:${RUN}:${name}:`;

/**
 * Removes every key of a prefix, so a file leaves the server as it found it
 *
 * @param {object} backend a started RedisBackend
 * @param {string} pattern the prefix to clear
 * @returns {Promise<number>} how many keys were removed
 */
async function clear(backend, pattern) {
  const client = await backend.connected();
  const keys = await client.keys(`${pattern}*`);

  if (keys.length > 0) {
    await client.del(keys);
  }

  return keys.length;
}

module.exports = { clear, live, prefix, url };
