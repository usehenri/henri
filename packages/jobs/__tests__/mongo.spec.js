const path = require('path');
const { randomUUID } = require('crypto');

const Mongoose = require('@usehenri/mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { fakeHenri } = require('./helpers');
const { Jobs } = require('../src/jobs');
const { Runner } = require('../src/runner');

/**
 * The MongoDB backend, on the server `@usehenri/disk` runs for an
 * application that never configured a database. A single-document
 * `findOneAndUpdate` is atomic, which is the whole claim.
 */
describe('queue (mongodb)', () => {
  let server = null;
  let adapter = null;
  let jobs = null;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();

    const henri = fakeHenri({
      cwd: path.join(__dirname, 'fixtures', 'app'),
    });

    adapter = new Mongoose('default', { url: server.getUri('henri') }, henri);
    await adapter.start();

    jobs = new Jobs(henri, {
      adapter,
      config: { backoff: { jitter: 0 } },
      cwd: henri.cwd(),
    });

    await jobs.start();
  }, 120000);

  afterAll(async () => {
    if (adapter) {
      await adapter.stop();
    }

    if (server) {
      await server.stop();
    }
  });

  beforeEach(async () => {
    for (const state of ['pending', 'running', 'done', 'dead']) {
      await jobs.store.remove({ state });
    }

    global.__henriJobsRuns = [];
  });

  test('picks the MongoDB backend for a mongoose store', () => {
    expect(jobs.store.kind).toBe('mongo');
    expect(jobs.store.dialect).toBe('mongodb');
  });

  test('enqueues and performs a job', async () => {
    const enqueued = await jobs.perform('ok', { hello: 'mongo' });

    expect(enqueued.state).toBe('pending');

    await new Runner(jobs).once();

    const job = await jobs.get(enqueued.id);

    expect(job.state).toBe('done');
    expect(job.attempts).toBe(1);
    expect(job.duration).toBeGreaterThanOrEqual(0);
  });

  test('keeps one job per unique key', async () => {
    const first = await jobs.perform('ok', { n: 1 }, { unique: 'once' });
    const second = await jobs.perform('ok', { n: 2 }, { unique: 'once' });

    expect(second.id).toBe(first.id);
    expect(await jobs.count()).toBe(1);
  });

  test('retries then buries, keeping the error and the history', async () => {
    const enqueued = await jobs.perform('boom', null, { maxAttempts: 2 });

    await new Runner(jobs).once();
    await jobs.store.update(enqueued.id, { run_at: Date.now() });
    await new Runner(jobs).once();

    const job = await jobs.get(enqueued.id);

    expect(job.state).toBe('dead');
    expect(job.error.message).toBe('boom on attempt 2');
    expect(job.history).toHaveLength(2);

    const [dead] = await jobs.dead.list();

    expect(dead.id).toBe(enqueued.id);
    expect((await jobs.dead.retry(dead.id)).state).toBe('pending');
  });

  test('never hands one document to two claims', async () => {
    for (let index = 0; index < 20; index += 1) {
      await jobs.perform('counter', { token: `mongo-${index}` });
    }

    const claims = await Promise.all(
      [0, 1, 2, 3].map((index) =>
        jobs.store.claim({
          limit: 20,
          now: Date.now(),
          queues: [],
          runner: `runner-${index}`,
          token: randomUUID(),
        })
      )
    );
    const ids = claims.flat().map((row) => row.id);

    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  test('several runners drain the queue exactly once', async () => {
    const tokens = [];

    for (let index = 0; index < 20; index += 1) {
      const token = `drain-${index}`;

      tokens.push(token);
      await jobs.perform('counter', { token });
    }

    await Promise.all(
      [0, 1, 2].map(() =>
        new Runner(jobs, { concurrency: 3, recurring: false }).once()
      )
    );

    expect([...global.__henriJobsRuns].sort()).toEqual([...tokens].sort());
  }, 60000);

  test('counts, times and prunes', async () => {
    const job = await jobs.perform('ok', null);

    await new Runner(jobs).once();

    const stats = await jobs.stats();

    expect(stats.totals.done).toBe(1);
    expect(stats.timings[0].runs).toBe(1);

    await jobs.store.update(job.id, { finished_at: Date.now() - 100000 });

    expect(await jobs.store.prune(Date.now() - 1000)).toBe(1);
    expect(await jobs.get(job.id)).toBeNull();
  });

  test('recovers a job a runner died on', async () => {
    const enqueued = await jobs.perform('ok', null);

    await jobs.store.claim({
      limit: 1,
      now: Date.now(),
      queues: [],
      runner: 'gone',
      token: randomUUID(),
    });
    await jobs.store.update(enqueued.id, { heartbeat_at: 0 });
    await jobs.store.recover({ now: Date.now(), stuckAfter: 1000 });

    expect((await jobs.get(enqueued.id)).state).toBe('pending');
  });

  test('honours a recurring schedule with the same CAS as SQL', async () => {
    const henri = fakeHenri({ cwd: path.join(__dirname, 'fixtures', 'app') });
    const scheduled = new Jobs(henri, {
      adapter,
      config: { recurring: { nightly: { cron: '0 3 * * *', job: 'ok' } } },
      cwd: henri.cwd(),
    });

    await scheduled.start();

    const runner = new Runner(scheduled);

    expect(await runner.schedule(Date.now())).toEqual([]);

    await scheduled.store.resetSchedule({
      name: 'nightly',
      next: Date.now() - 1000,
      now: Date.now(),
      spec: 'cron:0 3 * * *',
    });

    const enqueued = await runner.schedule(Date.now());

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].uniqueKey).toMatch(/^recurring:nightly:/);
    await scheduled.store.pruneSchedules([]);
  });
});
