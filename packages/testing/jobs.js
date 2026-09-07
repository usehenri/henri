/**
 * The queue, as a test reads it: what an action enqueued, and with what.
 *
 *   const { enqueued } = require('@usehenri/testing');
 *
 *   await request().post('/reports').send({ month: '2026-08' });
 *
 *   const [job] = await enqueued('report');
 *
 *   expect(await enqueued()).toHaveLength(1);
 *   expect(job.args).toEqual({ month: '2026-08' });
 *   expect(job.queue).toBe('reports');
 *
 * Plain values again, and asynchronous ones: unlike the inbox, this is not
 * a copy of what went past -- it is `henri_jobs`, read back through
 * `henri.jobs.list()`. The row is what a runner will claim, its `args` have
 * been through JSON exactly as they will be, and a job enqueued by a model
 * hook three layers down is in it like any other. Nothing is intercepted,
 * so there is nothing to get out of step.
 *
 * ## `@usehenri/jobs` is optional, and this does not change that
 *
 * Core carries no queue: `henri.jobs` is a module `@usehenri/jobs` ships,
 * and an application without the package has no such module. This file adds
 * no dependency -- it reads `henri.jobs` when it is there and answers
 * `HENRI_JOB_QUEUE_UNAVAILABLE` with the install line when it is not, the
 * way `base/jobs.js` does in core.
 *
 * The answer is an error rather than an empty list on purpose. `expect(await
 * enqueued()).toHaveLength(0)` has to fail in an application that cannot
 * enqueue anything at all; a helper that passes because the feature is
 * missing is worse than no helper.
 *
 * @module @usehenri/testing/jobs
 */

const { notRunning, stamp } = require('./errors');

/** The package that carries the queue */
const PACKAGE = '@usehenri/jobs';

/** What `enqueued({ ... })` filters on, which is what `list()` takes */
const FILTERS = ['limit', 'name', 'offset', 'queue', 'state'];

/**
 * How many jobs a test reads at once. `list()` stops at 50 of its own,
 * which is a console default rather than a test one: a suite asserting that
 * nothing was enqueued wants to see everything there is.
 */
const LIMIT = 500;

/**
 * The queue of the running application, or a failure naming what is missing
 *
 * @returns {object} `henri.jobs`
 * @throws when nothing booted the application, or it has no queue
 */
const queue = () => {
  // Lazily, so this module and index.js may require each other
  const { henri } = require('./index.js');

  if (!henri) {
    throw notRunning();
  }

  const { jobs } = henri;

  if (!jobs) {
    throw stamp(
      new Error(
        `@usehenri/testing: this application has no job queue, so there is nothing to assert on. Install it with: npm install ${PACKAGE}`
      ),
      'HENRI_JOB_QUEUE_UNAVAILABLE'
    );
  }

  if (!jobs.enabled) {
    throw stamp(
      new Error(
        `@usehenri/testing: ${PACKAGE} is installed but this application asked for no queue: it has neither app/jobs nor a \`jobs\` block in its configuration. Write a job with: henri generate job <name>`
      ),
      'HENRI_JOB_QUEUE_UNAVAILABLE'
    );
  }

  return jobs;
};

/**
 * What the caller asked for: a job name, a filter, or nothing
 *
 * @param {(string|object)} [filter] the filter
 * @param {string} caller the helper being called, for the error message
 * @returns {object} the filter `list()` is given
 * @throws when the filter names something the queue does not hold
 */
const wanted = (filter, caller) => {
  if (typeof filter === 'undefined' || filter === null) {
    return {};
  }

  if (typeof filter === 'string') {
    return { name: filter };
  }

  if (typeof filter !== 'object') {
    throw stamp(
      new Error(
        `@usehenri/testing: ${caller} takes a job name or a filter object, not ${typeof filter}`
      ),
      'HENRI_ARGUMENT_INVALID'
    );
  }

  const unknown = Object.keys(filter).filter((key) => !FILTERS.includes(key));

  // Silently ignoring it would make the assertion pass for the wrong reason
  if (unknown.length > 0) {
    throw stamp(
      new Error(
        `@usehenri/testing: ${caller} does not filter on ${unknown.join(', ')} (it filters on ${FILTERS.join(', ')})`
      ),
      'HENRI_ARGUMENT_INVALID'
    );
  }

  return filter;
};

/**
 * The jobs the queue is holding, newest change first.
 *
 *     expect(await enqueued()).toHaveLength(1);
 *     expect(await enqueued('welcome')).toHaveLength(1);
 *     expect(await enqueued({ queue: 'mail' })).toHaveLength(1);
 *
 * Waiting jobs by default, which is what "enqueued" means: a job a runner
 * already performed is `done`, not gone. `{ state: 'done' }` asks for those,
 * `{ state: 'dead' }` for the dead letter queue and `{ state: null }` for
 * everything the table holds.
 *
 * A row carries `args`, `name`, `queue`, `priority`, `runAt`, `state`,
 * `attempts` and the rest of what `henri jobs:show` prints.
 *
 * @param {(string|object)} [filter] a job name, or `state`, `queue`, `name`,
 *   `limit` and `offset`
 * @returns {Promise<Array<object>>} the jobs
 * @throws when the application has no queue, or the filter names something
 *   the queue does not hold
 */
const enqueued = async (filter) =>
  queue().list({
    limit: LIMIT,
    state: 'pending',
    ...wanted(filter, 'enqueued()'),
  });

/**
 * Forget the jobs the queue is holding.
 *
 * Everything, whatever its state, unless the filter narrows it: a test that
 * starts from an empty queue reads the same run after run. Nothing calls it
 * for you -- these are rows in the application's database, and deleting them
 * is the suite's decision, not this package's.
 *
 * @param {(string|object)} [filter] a job name, or `state`, `queue`, `name`
 * @returns {Promise<number>} how many were deleted
 * @throws when the application has no queue
 */
const clearJobs = async (filter) => {
  const jobs = queue();
  const rows = await jobs.list({
    limit: LIMIT,
    state: null,
    ...wanted(filter, 'clearJobs()'),
  });
  // `ready()` is the module's own accessor for the queue: `henri.jobs`
  // exposes the dead letter half of `discardAll()` only, and a suite wants
  // to forget the jobs that are still waiting
  const held = jobs.ready();
  let removed = 0;

  for (const row of rows) {
    (await held.discard(row.id)) && (removed += 1);
  }

  return removed;
};

module.exports = { FILTERS, LIMIT, clearJobs, enqueued };
