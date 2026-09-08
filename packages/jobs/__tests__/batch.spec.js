const { randomUUID } = require('crypto');

const {
  adapterFor,
  build,
  close,
  dropIndex,
  sharedKey,
  target,
} = require('./helpers');
const { Runner } = require('../src/runner');

/**
 * A batch has one negative property, and it is the whole feature: the
 * callback runs **exactly once**, and never before the last job of the
 * batch is terminal. Neither half can be seen by counting rows afterwards
 * -- a callback that ran twice and one that ran once leave the same
 * arguments behind, and a callback that ran too early leaves no trace at
 * all once the last job finishes a millisecond later.
 *
 * So the callback itself records what it saw (`fixtures/app/app/jobs/
 * batch/finished.js`): one entry per run, and the number of jobs of its
 * batch that were still waiting or running at that moment, read from the
 * database. `unfinished: 0` is the assertion.
 *
 * Like `claim.spec.js` and `concurrency.spec.js`, every queue here opens a
 * connection pool of its own, so the runners race on the server rather than
 * in one client. On sqlite that proves the logic; against the PostgreSQL and
 * MySQL of `pnpm test:sql:live` it proves the guarantee.
 */

const RUNNERS = target.live ? 4 : 2;
const JOBS = target.live ? 12 : 6;

/**
 * The callbacks that were performed in this process
 *
 * @returns {Array<object>} `{ at, batch, runner, unfinished }` entries
 */
const callbacks = () => global.__henriJobsCallbacks || [];

describe(`batches (${target.name}, ${RUNNERS} runners)`, () => {
  const adapters = [];
  const queues = [];

  /**
   * Empties the queue and forgets every batch
   *
   * @returns {Promise<void>} Resolves when it is empty
   */
  const clear = async () => {
    for (const state of ['pending', 'running', 'done', 'dead']) {
      await queues[0].store.remove({ state });
    }

    for (const batch of await queues[0].store.listBatches({ limit: 200 })) {
      await queues[0].store.removeBatch(batch.id);
    }

    global.__henriJobsCallbacks = [];
    global.__henriJobsRuns = [];
  };

  /**
   * Runs every runner until the queue has nothing left to give
   *
   * @param {object} [options={}] `concurrency`
   * @returns {Promise<Array<object>>} What each runner did
   */
  const drain = async (options = {}) => {
    const runners = queues.map((queue) =>
      new Runner(queue, {
        concurrency: options.concurrency || 4,
        recurring: false,
      }).start()
    );

    // A callback is enqueued *after* the outcome of the last job of its
    // batch is written down, so an empty table is not the end of the work:
    // a runner still holding that job is what says the batch has not been
    // settled yet, and a drain that stopped in that gap would leave the
    // callback in the queue with nobody to perform it
    const busy = () => runners.some((runner) => runner.running.size > 0);
    let empty = 0;

    for (let waited = 0; waited < 800 && empty < 3; waited += 1) {
      const pending = await queues[0].count({ state: 'pending' });
      const running = await queues[0].count({ state: 'running' });

      empty = pending === 0 && running === 0 && !busy() ? empty + 1 : 0;

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return Promise.all(runners.map((runner) => runner.stop()));
  };

  /**
   * The jobs of a batch, written the way `batch({ jobs })` takes them
   *
   * @param {number} total How many
   * @param {object} [options={}] `fail` (how many of them die), `wait`
   * @returns {Array} The entries
   */
  const members = (total, options = {}) =>
    Array.from({ length: total }, (ignored, index) => [
      'batch/member',
      {
        fail: index < (options.fail || 0),
        token: `${options.token || 'job'}-${index}`,
        wait: options.wait || 5,
      },
    ]);

  beforeAll(async () => {
    const key = sharedKey('batch');

    for (let index = 0; index < RUNNERS; index += 1) {
      const adapter = await adapterFor(key);
      const built = await build({
        adapter,
        config: { pollInterval: 25, stuckAfter: '10s' },
      });

      // The callback asks the queue what is left of its batch, so it needs
      // one on the henri it is handed -- which is what an application has
      built.henri.jobs = built.jobs;
      adapters.push(adapter);
      queues.push(built.jobs);
    }
  }, 60000);

  afterAll(() => close(adapters));

  beforeEach(clear);

  test('the store can hold a batch', async () => {
    // Everything below rests on this: without the column and the table the
    // queue refuses a batch rather than running one that counts nothing
    expect(await queues[0].store.batched()).toBe(true);
    expect(queues[0].batched).toBe(true);
  });

  test('the callback runs once, when the last job is terminal', async () => {
    const batch = await queues[0].batch({
      callback: 'batch/finished',
      jobs: members(JOBS, { token: 'once' }),
      name: 'every job of it',
    });

    expect(batch.total).toBe(JOBS);
    expect(batch.sealed).toBe(true);
    expect(batch.finished).toBe(false);

    await drain();

    // One callback, whatever the interleaving of the runners
    expect(callbacks()).toHaveLength(1);

    const [call] = callbacks();

    // ... and not one job of the batch was left when it ran
    expect(call.unfinished).toBe(0);
    expect(call.batch).toEqual({
      done: JOBS,
      failed: 0,
      id: batch.id,
      name: 'every job of it',
      succeeded: JOBS,
      total: JOBS,
    });

    // One row, too: the callback is enqueued under a unique key of the
    // batch's own, so a second settle answers the same job
    const enqueued = await queues[0].list({
      limit: 100,
      name: 'batch/finished',
    });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].state).toBe('done');

    const stored = await queues[0].batches.get(batch.id);

    expect(stored.finished).toBe(true);
    expect(stored.callbackId).toBe(enqueued[0].id);
    expect(stored.done).toBe(JOBS);
  }, 120000);

  test('a batch finishes, it does not succeed', async () => {
    const dead = 2;
    const batch = await queues[0].batch({
      args: { report: 'nightly' },
      callback: 'batch/finished',
      jobs: members(JOBS, { fail: dead, token: 'half' }),
    });

    await drain();

    expect(callbacks()).toHaveLength(1);

    const [call] = callbacks();

    expect(call.unfinished).toBe(0);
    expect(call.batch.total).toBe(JOBS);
    expect(call.batch.done).toBe(JOBS);
    expect(call.batch.failed).toBe(dead);
    expect(call.batch.succeeded).toBe(JOBS - dead);

    // The declared arguments are the callback's own, and the counts are
    // added to them
    const [job] = await queues[0].list({ limit: 10, name: 'batch/finished' });

    expect(job.args.report).toBe('nightly');
    expect(await queues[0].count({ state: 'dead' })).toBe(dead);
    expect((await queues[0].batches.get(batch.id)).failed).toBe(dead);
  }, 120000);

  test('nothing is called while one job of the batch is still to run', async () => {
    let last = null;
    const batch = await queues[0].batch(
      { callback: 'batch/finished' },
      async (open) => {
        await open.add('batch/member', { token: 'now-1' });
        await open.add('batch/member', { token: 'now-2' });
        last = await open.add(
          'batch/member',
          { token: 'later' },
          { wait: '1h' }
        );
      }
    );

    expect(batch.total).toBe(3);

    // A drain performs what is due and leaves what is not, so this one
    // takes two of the three
    await drain();

    expect(callbacks()).toHaveLength(0);
    expect((await queues[0].batches.get(batch.id)).done).toBe(2);

    // The third comes due; moved by hand rather than waited for
    await queues[0].store.update(last.id, { run_at: Date.now() });
    await drain();

    expect(callbacks()).toHaveLength(1);
    expect(callbacks()[0].unfinished).toBe(0);
    expect(callbacks()[0].batch.done).toBe(3);
  }, 120000);

  test('several batches finishing at once each get their own callback', async () => {
    const made = [];

    for (let index = 0; index < 3; index += 1) {
      made.push(
        await queues[0].batch({
          callback: 'batch/finished',
          jobs: members(JOBS, { token: `many-${index}`, wait: 15 }),
          name: `batch ${index}`,
        })
      );
    }

    await drain();

    const seen = callbacks();

    expect(seen).toHaveLength(3);
    expect(seen.every((call) => call.unfinished === 0)).toBe(true);
    expect(new Set(seen.map((call) => call.batch.id)).size).toBe(3);

    for (const batch of made) {
      const call = seen.find((entry) => entry.batch.id === batch.id);

      expect(call.batch.done).toBe(JOBS);
      expect((await queues[0].batches.get(batch.id)).finished).toBe(true);
    }
  }, 120000);

  test('an empty batch has nothing to wait for', async () => {
    const batch = await queues[0].batch({
      callback: 'batch/finished',
      jobs: [],
    });

    // Sealed with a total of zero, so it is finished the moment it is made
    expect(batch.finished).toBe(true);
    expect(batch.callbackId).not.toBeNull();

    await drain();

    expect(callbacks()).toHaveLength(1);
    expect(callbacks()[0].batch.total).toBe(0);
  }, 60000);

  test('a batch may have no callback at all', async () => {
    const batch = await queues[0].batch({
      jobs: members(2, { token: 'bare' }),
    });

    await drain();

    const stored = await queues[0].batches.get(batch.id);

    expect(stored.finished).toBe(true);
    expect(stored.callback).toBeNull();
    expect(stored.callbackId).toBeNull();
    expect(stored.done).toBe(2);
    expect(callbacks()).toHaveLength(0);
  }, 60000);

  test('a sealed batch refuses a job, and says so', async () => {
    const batch = await queues[0].batch({
      callback: 'batch/finished',
      jobs: members(1, { token: 'closed' }),
    });

    await expect(batch.add('batch/member', { token: 'late' })).rejects.toThrow(
      /is closed/u
    );

    // And so does the enqueue itself: the promise is about the batch, not
    // about the handle in this process's memory
    const error = await queues[1 % RUNNERS]
      .perform('batch/member', { token: 'late' }, { batch: batch.id })
      .then(
        () => null,
        (thrown) => thrown
      );

    expect(error.code).toBe('HENRI_JOB_BATCH_CLOSED');
    expect(error.hint).toContain('before it is sealed');
    expect(await queues[0].count({ state: 'pending' })).toBe(1);
  });

  test('the jobs of a batch are its own', async () => {
    const batch = await queues[0].batch({
      jobs: members(3, { token: 'listed' }),
      name: 'listed',
    });
    const other = await queues[0].perform('ok', { outside: true });
    const held = await queues[0].batches.jobs(batch.id, { limit: 50 });

    expect(held).toHaveLength(3);
    expect(held.every((job) => job.batchId === batch.id)).toBe(true);
    expect(held.map((job) => job.id)).not.toContain(other.id);
    expect(other.batchId).toBeNull();

    const listed = await queues[0].batches.list({ finished: false });

    expect(listed.map((entry) => entry.id)).toContain(batch.id);

    // The way out of a batch that can never finish: forget it, and its
    // jobs count against nothing
    expect(await queues[0].batches.discard(batch.id)).toBe(true);
    expect(await queues[0].batches.get(batch.id)).toBeNull();
    await drain();
    expect(callbacks()).toHaveLength(0);
  }, 60000);

  test('a declaration henri cannot read is refused', async () => {
    for (const options of [
      { callback: 'batch/finished', jobs: [42] },
      { callback: 12 },
      { args: 'a string', callback: 'batch/finished' },
      { name: 'x'.repeat(200) },
    ]) {
      const error = await queues[0].batch(options).then(
        () => null,
        (thrown) => thrown
      );

      expect(error && error.code).toBe('HENRI_JOB_INVALID_BATCH');
    }

    // A callback no file answers to is caught here rather than when the
    // last job of the batch finishes, minutes later and elsewhere
    const unknown = await queues[0].batch({ callback: 'batch/nowhere' }).then(
      () => null,
      (thrown) => thrown
    );

    expect(unknown.code).toBe('HENRI_JOB_UNKNOWN');

    // And a builder is one way or the other, never both
    const both = await queues[0]
      .batch({ jobs: members(1) }, async () => null)
      .then(
        () => null,
        (thrown) => thrown
      );

    expect(both.code).toBe('HENRI_JOB_INVALID_BATCH');
  });

  test('a job put back gives its slot back, so the callback still waits', async () => {
    const batch = await queues[0].batch({
      callback: 'batch/finished',
      jobs: members(2, { fail: 1, token: 'retried' }),
    });

    await drain();

    expect(callbacks()).toHaveLength(1);

    const [dead] = await queues[0].list({ limit: 5, state: 'dead' });
    const before = await queues[0].batches.get(batch.id);

    // A finished batch never moves again: it has already called its
    // callback, and counting a second outcome for the same job would make
    // its counts a lie
    await queues[0].retry(dead.id);

    const after = await queues[0].batches.get(batch.id);

    expect(before.finished).toBe(true);
    expect(after.done).toBe(before.done);
    expect(after.failed).toBe(before.failed);

    await drain();

    expect(callbacks()).toHaveLength(1);
  }, 120000);

  test('a batch still running gives the slot back and waits again', async () => {
    const batch = await queues[0].batch(
      { callback: 'batch/finished' },
      async (open) => {
        await open.add('batch/member', { fail: true, token: 'first' });
        await open.add(
          'batch/member',
          { token: 'second' },
          { at: Date.now() + 100000 }
        );
      }
    );

    await drain();

    const [dead] = await queues[0].list({ limit: 5, state: 'dead' });

    expect(callbacks()).toHaveLength(0);
    expect((await queues[0].batches.get(batch.id)).done).toBe(1);

    await queues[0].retry(dead.id, { wait: 100000 });

    const after = await queues[0].batches.get(batch.id);

    expect(after.done).toBe(0);
    expect(after.failed).toBe(0);
  }, 120000);
});

describe(`a batch and a runner that died (${target.name})`, () => {
  const adapters = [];
  let jobs = null;
  let store = null;

  beforeAll(async () => {
    const adapter = await adapterFor(sharedKey('batch-recovery'));
    const built = await build({
      adapter,
      config: { pollInterval: 25, stuckAfter: 200 },
    });

    built.henri.jobs = built.jobs;
    adapters.push(adapter);
    jobs = built.jobs;
    store = built.jobs.store;
  }, 60000);

  afterAll(() => close(adapters));

  beforeEach(async () => {
    for (const state of ['pending', 'running', 'done', 'dead']) {
      await store.remove({ state });
    }

    for (const batch of await store.listBatches({ limit: 200 })) {
      await store.removeBatch(batch.id);
    }

    global.__henriJobsCallbacks = [];
    global.__henriJobsRuns = [];
  });

  test('an outcome that was refused counts nothing, and the new one counts once', async () => {
    const batch = await jobs.batch({
      callback: 'batch/finished',
      jobs: [['batch/member', { token: 'zombie' }, { maxAttempts: 2 }]],
    });
    const [ghost] = await store.claim({
      limit: 1,
      now: Date.now(),
      queues: [],
      runner: 'ghost',
      token: randomUUID(),
    });

    // The runner that holds it goes quiet: its jobs are put back, and the
    // batch has counted nothing, which is the whole reason the counter
    // cannot move at claim time
    await new Promise((resolve) => setTimeout(resolve, 250));
    await store.recover({ now: Date.now(), stuckAfter: 200 });

    expect((await jobs.batches.get(batch.id)).done).toBe(0);

    const runner = new Runner(jobs, { concurrency: 2, recurring: false });

    await runner.once();

    // Performed by somebody else, counted once, and the callback called
    expect((await jobs.batches.get(batch.id)).done).toBe(1);
    expect(callbacks()).toHaveLength(1);

    // And now the runner everybody gave up on writes its outcome. The
    // write is refused by the claim token, and so is the count: this is
    // the interleaving that would otherwise take `done` past `total`
    const outcome = await jobs.attempt(ghost, { runner: 'ghost' });
    const settled = await jobs.batches.get(batch.id);

    expect(outcome.state).toBe('done');
    expect(settled.done).toBe(1);
    expect(settled.total).toBe(1);
    expect(callbacks()).toHaveLength(1);
    expect(await jobs.list({ limit: 10, name: 'batch/finished' })).toHaveLength(
      1
    );
  }, 60000);

  test('a job buried by the recovery is counted by the sweep', async () => {
    const batch = await jobs.batch({
      callback: 'batch/finished',
      jobs: [['batch/member', { token: 'buried' }, { maxAttempts: 1 }]],
    });

    await store.claim({
      limit: 1,
      now: Date.now(),
      queues: [],
      runner: 'ghost',
      token: randomUUID(),
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Out of attempts, so the recovery buries it rather than putting it
    // back: an outcome no attempt of anybody's ever wrote
    await store.recover({ now: Date.now(), stuckAfter: 200 });

    expect(await jobs.count({ state: 'dead' })).toBe(1);
    expect((await jobs.batches.get(batch.id)).done).toBe(0);
    expect(callbacks()).toHaveLength(0);

    const settled = await jobs.reconcile({ before: Date.now() + 1 });

    expect(settled.map((entry) => entry.id)).toEqual([batch.id]);

    const stored = await jobs.batches.get(batch.id);

    expect(stored.finished).toBe(true);
    expect(stored.done).toBe(1);
    expect(stored.failed).toBe(1);

    await new Runner(jobs, { recurring: false }).once();

    expect(callbacks()).toHaveLength(1);
    expect(callbacks()[0].batch.failed).toBe(1);
  }, 60000);

  test('a runner killed between the outcome and the count is repaired', async () => {
    const batch = await jobs.batch({
      callback: 'batch/finished',
      jobs: [['batch/member', { token: 'killed' }]],
    });
    const advance = store.advanceBatch.bind(store);

    // The narrow window the sweep exists for: the outcome is written and
    // the process dies before it is counted
    store.advanceBatch = async () => null;

    try {
      await new Runner(jobs, { recurring: false }).once();
    } finally {
      store.advanceBatch = advance;
    }

    expect(await jobs.count({ state: 'done' })).toBe(1);
    expect((await jobs.batches.get(batch.id)).done).toBe(0);
    expect(callbacks()).toHaveLength(0);

    // Counting the rows is what answers, and it only ever moves forward
    await jobs.reconcile({ before: Date.now() + 1 });

    const stored = await jobs.batches.get(batch.id);

    expect(stored.done).toBe(1);
    expect(stored.finished).toBe(true);

    // Settling is idempotent: a second sweep answers the callback that is
    // already in the queue rather than enqueuing another
    await jobs.reconcile({ before: Date.now() + 1 });
    await jobs.settle(await store.findBatch(batch.id));

    expect(await jobs.list({ limit: 10, name: 'batch/finished' })).toHaveLength(
      1
    );

    await new Runner(jobs, { recurring: false }).once();

    expect(callbacks()).toHaveLength(1);
  }, 60000);
});

describe(`upgrading a queue that has no batches (${target.name})`, () => {
  const adapters = [];
  let jobs = null;
  let store = null;

  /**
   * Takes the store back to what a henri without batches wrote
   *
   * @returns {Promise<void>} Resolves when the column and the table are gone
   */
  const downgrade = async () => {
    const { batches, jobs: table } = jobs.config.tables;

    await dropIndex(store, table, `${table}_batch`);
    await store.run(`ALTER TABLE ${table} DROP COLUMN batch_id`);
    await store.run(`DROP TABLE IF EXISTS ${batches}`);
    store.batches = null;
    jobs.batched = await store.batched();
  };

  beforeAll(async () => {
    const adapter = await adapterFor(sharedKey('batch-upgrade'));
    const built = await build({ adapter });

    adapters.push(adapter);
    jobs = built.jobs;
    store = built.jobs.store;
    await downgrade();
  }, 60000);

  afterAll(() => close(adapters));

  test('the queue works exactly as it did without them', async () => {
    expect(await store.batched()).toBe(false);

    // The insert names the columns that are there, so an application that
    // never asked for a batch does not notice
    const job = await jobs.perform('ok', { still: 'working' });
    const claimed = await store.claim({
      except: [],
      limit: 5,
      now: Date.now(),
      queues: [],
      runner: 'upgrading',
      token: randomUUID(),
    });

    expect(claimed.map((row) => row.id)).toContain(job.id);
    await store.remove({ state: 'running' });
  });

  test('a batch is refused rather than counted nowhere', async () => {
    const error = await jobs.batch({ callback: 'ok' }).then(
      () => null,
      (thrown) => thrown
    );

    expect(error.code).toBe('HENRI_JOB_BATCH_UNINSTALLED');
    expect(error.hint).toContain('henri jobs:install');
    expect(error.message).toContain('henri_jobs_batches');
  });

  test('the install adds them, and batches work from then on', async () => {
    const statements = await store.install();

    expect(statements.join(';')).toContain('batch_id');
    store.batches = null;
    expect(await store.batched()).toBe(true);

    const { jobs: started } = await build({
      adapter: store.adapter,
      config: { install: false },
    });

    expect(started.batched).toBe(true);

    const batch = await started.batch({ jobs: [['ok', { upgraded: true }]] });

    expect(batch.total).toBe(1);

    const [job] = await started.batches.jobs(batch.id);

    expect(job.batchId).toBe(batch.id);
    await started.store.remove({ state: 'pending' });
    await started.store.removeBatch(batch.id);
  }, 60000);

  test('the install may be run again and changes nothing', async () => {
    await expect(store.install()).resolves.toBeInstanceOf(Array);
    expect(await store.batched()).toBe(true);
  }, 60000);
});
