/**
 * How many jobs of a key were running at the same moment.
 *
 * A concurrency limit is a **negative** property -- never more than N at
 * once -- and a count taken after the fact cannot see it: two jobs that
 * overlapped for a millisecond and two that never met leave the same rows
 * behind. So the jobs themselves say when they enter and when they leave,
 * and this keeps the high-water mark per key.
 *
 * The state is on `global` rather than in this module's closure because the
 * job fixtures are loaded by `require()` from each queue's own `app/jobs`,
 * and every queue of a suite has to count into the same place.
 */

/**
 * The counters of this process
 *
 * @returns {object} `{ live, max, order }` by key
 */
const state = () => {
  global.__henriJobsLive = global.__henriJobsLive || {
    live: {},
    max: {},
    order: [],
  };

  return global.__henriJobsLive;
};

/**
 * Forgets everything counted so far
 *
 * @returns {void}
 */
const reset = () => {
  global.__henriJobsLive = { live: {}, max: {}, order: [] };
};

/**
 * Runs inside the counted window
 *
 * @param {string} key What the bound is on
 * @param {string} token What identifies this run
 * @param {number} [wait=25] How long to stay inside, so runs overlap
 * @returns {Promise<string>} The token
 */
const inside = async (key, token, wait = 25) => {
  const counters = state();

  counters.live[key] = (counters.live[key] || 0) + 1;
  counters.max[key] = Math.max(counters.max[key] || 0, counters.live[key]);
  counters.order.push(token);

  try {
    await new Promise((resolve) => setTimeout(resolve, wait));
  } finally {
    counters.live[key] -= 1;
  }

  return token;
};

/**
 * The most that ran at once under a key
 *
 * @param {string} key The key
 * @returns {number} The high-water mark
 */
const most = (key) => state().max[key] || 0;

/**
 * Every token that was performed, in the order they started
 *
 * @returns {Array<string>} The tokens
 */
const performed = () => [...state().order];

module.exports = { inside, most, performed, reset, state };
