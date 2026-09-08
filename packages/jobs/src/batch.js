const { JobError } = require('./errors');
const { iso } = require('./duration');
const { toNumber } = require('./store/sql');

/**
 * A batch: a set of jobs, and one job that runs when they are all done.
 *
 * ## A batch finishes, it does not succeed
 *
 * The callback runs once every job of the batch has reached a **terminal**
 * state -- `dead` included -- and it is handed the counts. A batch whose
 * last job failed is a finished batch with a failure in it, and what that
 * means is the application's to decide: pretending otherwise would mean a
 * callback that never runs and nobody noticing.
 *
 * ## The counter, and why it is exactly once
 *
 * `total` is written **once**, when the batch is sealed, and never moves
 * again; `done` is advanced by one statement per terminal outcome, guarded
 * by the claim token of the attempt that wrote it (`SqlStore#advanceBatch`,
 * `MongoStore#advanceBatch`). So `done` reaches `total` exactly once, after
 * the last job of the batch is terminal, whatever the interleaving of the
 * runners -- and a job performed twice because its first runner went quiet
 * counts once, for the attempt whose outcome actually landed.
 *
 * The callback is then enqueued under a unique key of the batch's own,
 * which is what makes settling idempotent: the sweep settles an unfinished
 * batch again after a runner is killed between writing an outcome and
 * counting it, and the second settle answers the callback that is already
 * in the queue rather than enqueuing a second one.
 *
 * ## What a batch is not
 *
 * It is not a transaction, and it is not atomic with the application's
 * database: the queue reaches its own tables through the store adapter's
 * raw `query()`, which does not join an open model transaction, so a batch
 * enqueued inside one that rolls back is a batch that runs. That is true of
 * every enqueue and the guide says so twice.
 *
 * A batch is also built where it is created: `add()` is a call on the
 * handle, and once the handle has sealed the batch it refuses -- there is
 * no adding a job from another process, which is the race that would let a
 * callback run with work still on its way in.
 */

/** The widest a batch name may be: the column that holds it */
const NAME_LENGTH = 190;

/** The options of the callback that are passed to `perform()` */
const CALLBACK_OPTIONS = [
  'at',
  'maxAttempts',
  'priority',
  'queue',
  'timeout',
  'wait',
];

/**
 * A stored batch, as the API hands it out
 *
 * @param {?object} row A row of the batches table
 * @returns {?object} The batch
 */
const toBatch = (row) => {
  if (!row) {
    return null;
  }

  const total = toNumber(row.total) || 0;
  const done = toNumber(row.done) || 0;
  const failed = toNumber(row.failed) || 0;

  return {
    callback: row.callback || null,
    callbackId: row.callback_id || null,
    createdAt: iso(row.created_at),
    done,
    failed,
    finished: Boolean(row.finished_at),
    finishedAt: iso(row.finished_at),
    id: row.id,
    name: row.name || null,
    sealed: Boolean(row.sealed_at),
    sealedAt: iso(row.sealed_at),
    succeeded: Math.max(0, done - failed),
    total,
    updatedAt: iso(row.updated_at),
  };
};

/**
 * Refuses a batch declaration henri cannot read
 *
 * @param {string} why What is wrong with it
 * @returns {void}
 * @throws {JobError} HENRI_JOB_INVALID_BATCH, always
 */
const refuse = (why) => {
  throw new JobError(
    'HENRI_JOB_INVALID_BATCH',
    `The batch cannot be read: ${why}`,
    {
      hint: "henri.jobs.batch({ callback: 'report/compile', jobs: [['resize', { id }]] }), or a function that adds them",
    }
  );
};

/**
 * One job of a batch, however it was written
 *
 * `'resize'`, `['resize', args]`, `['resize', args, options]` and
 * `{ name, args, options }` are the same thing.
 *
 * @param {*} entry What the application wrote
 * @returns {object} `{ name, args, options }`
 * @throws {JobError} HENRI_JOB_INVALID_BATCH on anything else
 */
const entry = (value) => {
  if (typeof value === 'string') {
    return { args: null, name: value, options: {} };
  }

  if (Array.isArray(value)) {
    const [name, args = null, options = {}] = value;

    if (typeof name !== 'string' || name === '') {
      refuse('a job of the list does not begin with a name');
    }

    return { args, name, options: options || {} };
  }

  if (!value || typeof value !== 'object' || typeof value.name !== 'string') {
    refuse(`${JSON.stringify(value)} is not a job name, a list or an object`);
  }

  return {
    args: typeof value.args === 'undefined' ? null : value.args,
    name: value.name,
    options: value.options || {},
  };
};

/**
 * Reads what an application asked a batch for
 *
 * @param {object} [options={}] What `henri.jobs.batch()` was given
 * @returns {object} `{ name, callback, args, options, jobs }`
 * @throws {JobError} HENRI_JOB_INVALID_BATCH when it cannot be read
 */
const declaration = (options = {}) => {
  const value = options || {};

  if (typeof value !== 'object' || Array.isArray(value)) {
    refuse('it is not an object');
  }

  const name = typeof value.name === 'undefined' ? null : value.name;

  if (
    name !== null &&
    (typeof name !== 'string' || name.length > NAME_LENGTH)
  ) {
    refuse(`its name is not a string of at most ${NAME_LENGTH} characters`);
  }

  const callback =
    typeof value.callback === 'undefined' || value.callback === null
      ? null
      : value.callback;

  if (callback !== null && (typeof callback !== 'string' || callback === '')) {
    refuse('its callback is not the name of a job');
  }

  const args = typeof value.args === 'undefined' ? null : value.args;

  if (
    args !== null &&
    (typeof args !== 'object' || Array.isArray(args) || args instanceof Date)
  ) {
    // The counts are handed over under `batch`, so there has to be somewhere
    // to put them
    refuse('the arguments of its callback are not a plain object');
  }

  // `null` is "no list at all", which leaves the batch open for the caller
  // to add to and seal; `[]` is a batch of nothing, which is finished the
  // moment it is made
  const jobs = typeof value.jobs === 'undefined' ? null : value.jobs;

  if (jobs !== null && !Array.isArray(jobs)) {
    refuse('its jobs are not a list');
  }

  const passed = {};

  for (const key of CALLBACK_OPTIONS) {
    if (typeof value[key] !== 'undefined') {
      passed[key] = value[key];
    }
  }

  return {
    args,
    callback,
    jobs: jobs && jobs.map(entry),
    name,
    options: passed,
  };
};

/**
 * A batch in hand: what adds jobs to it and closes it.
 *
 * `henri.jobs.batch()` answers one of these. Its counters are what the
 * database said when it was last read, so `reload()` is how they are
 * refreshed; everything else about a batch is read back with
 * `henri.jobs.batches.get(id)`.
 *
 * @class Batch
 */
class Batch {
  /**
   * Creates an instance of Batch.
   *
   * @param {object} queue The queue that owns it
   * @param {object} row The stored row
   * @memberof Batch
   */
  constructor(queue, row) {
    this.queue = queue;
    /** The ids of the jobs this handle enqueued */
    this.jobs = [];
    this.sync(row);
  }

  /**
   * Reads a row onto this handle
   *
   * @param {object} row The stored row
   * @returns {Batch} This batch
   * @memberof Batch
   */
  sync(row) {
    Object.assign(this, toBatch(row));

    return this;
  }

  /**
   * Adds one job to the batch
   *
   * @param {string} name The job name
   * @param {*} [args=null] What perform() receives
   * @param {object} [options={}] The options of perform()
   * @returns {Promise<object>} The enqueued job
   * @throws {JobError} HENRI_JOB_BATCH_CLOSED once the batch is sealed
   * @memberof Batch
   */
  async add(name, args = null, options = {}) {
    if (this.sealed) {
      throw new JobError(
        'HENRI_JOB_BATCH_CLOSED',
        `The batch ${this.id} is closed: it holds ${this.total} job(s) and was sealed at ${this.sealedAt}`,
        {
          batch: this.id,
          hint: 'A batch is built where it is created: add every job before it is sealed, or make another batch',
        }
      );
    }

    const job = await this.queue.perform(name, args, {
      ...options,
      batch: this.id,
    });

    this.jobs.push(job.id);

    return job;
  }

  /**
   * Adds several jobs to the batch
   *
   * @param {Array} list The jobs, in any of the shapes `batch({ jobs })`
   *   takes
   * @returns {Promise<Array<object>>} The enqueued jobs
   * @memberof Batch
   */
  async addAll(list) {
    const enqueued = [];

    for (const one of list) {
      const { args, name, options } = entry(one);

      enqueued.push(await this.add(name, args, options));
    }

    return enqueued;
  }

  /**
   * Closes the batch, and settles it when there was nothing left to wait for
   *
   * @returns {Promise<Batch>} This batch
   * @memberof Batch
   */
  async seal() {
    if (this.sealed) {
      return this;
    }

    const row = await this.queue
      .storeOrDie()
      .sealBatch({ id: this.id, now: Date.now(), total: this.jobs.length });

    this.sync(row || (await this.queue.storeOrDie().findBatch(this.id)));

    // Every job of the batch may already be terminal -- an empty batch
    // certainly is -- and nothing else will look at it until the sweep does
    await this.queue.settle(await this.queue.storeOrDie().findBatch(this.id));

    return this.reload();
  }

  /**
   * Reads the batch back
   *
   * @returns {Promise<Batch>} This batch
   * @memberof Batch
   */
  async reload() {
    return this.sync(await this.queue.storeOrDie().findBatch(this.id));
  }

  /**
   * The batch as a plain object
   *
   * @returns {object} What `henri.jobs.batches.get()` answers
   * @memberof Batch
   */
  toJSON() {
    return {
      callback: this.callback,
      callbackId: this.callbackId,
      createdAt: this.createdAt,
      done: this.done,
      failed: this.failed,
      finished: this.finished,
      finishedAt: this.finishedAt,
      id: this.id,
      name: this.name,
      sealed: this.sealed,
      sealedAt: this.sealedAt,
      succeeded: this.succeeded,
      total: this.total,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = {
  Batch,
  CALLBACK_OPTIONS,
  NAME_LENGTH,
  declaration,
  entry,
  toBatch,
};
