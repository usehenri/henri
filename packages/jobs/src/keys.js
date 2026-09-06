/**
 * The unique keys the queue writes for itself.
 *
 * An application's `unique` key belongs to a job only while it is waiting or
 * running: once the job is done, or once it has died, the key is freed and
 * the same work may be enqueued again. That is what people expect of a
 * unique job, and it is what the guide says.
 *
 * The keys the recurring scheduler writes are the exception, and they have
 * to be. A slot is enqueued *before* its schedule moves on, so that an
 * enqueue that fails leaves the schedule due and the next tick tries again;
 * the row already in the queue is what stops a second runner enqueueing the
 * same slot. If that key were freed the moment the job finished, a slot
 * whose job ran to completion in the gap between the enqueue and the
 * schedule moving on would be enqueued a second time. So a key of this
 * shape is kept for the life of the row, and the row is pruned like any
 * other -- by which time that slot, a specific millisecond, can never be due
 * again.
 */

/** What the recurring scheduler prefixes its slots with */
const RECURRING = 'recurring:';

/**
 * The unique key a finished job should keep, if any
 *
 * @param {?string} key The key the job holds
 * @returns {?string} The key to keep, or null to free it
 */
const keep = (key) =>
  typeof key === 'string' && key.startsWith(RECURRING) ? key : null;

/**
 * The unique key of one occurrence of a recurring schedule
 *
 * @param {string} name The schedule name
 * @param {number} due The moment the occurrence was due
 * @returns {string} The key
 */
const slot = (name, due) => `${RECURRING}${name}:${due}`;

module.exports = { RECURRING, keep, slot };
