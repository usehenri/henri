const { build, close, target } = require('./helpers');
const { Runner, SIGNALS } = require('../src/runner');

describe(`runner (${target.name})`, () => {
  const adapters = [];
  let jobs = null;

  beforeAll(async () => {
    const built = await build({ config: { pollInterval: 50 } });

    jobs = built.jobs;
    adapters.push(built.adapter);
  });

  afterAll(() => close(adapters));

  beforeEach(async () => {
    for (const state of ['pending', 'running', 'done', 'dead']) {
      await jobs.store.remove({ state });
    }

    global.__henriJobsRuns = [];
  });

  test('names itself so a row says which runner took it', () => {
    const runner = new Runner(jobs);

    expect(runner.id).toMatch(/:\d+:/);
    expect(new Runner(jobs, { id: 'named' }).id).toBe('named');
  });

  test('takes its concurrency and its queues from the configuration', async () => {
    const built = await build({
      config: { concurrency: 9, queues: ['a', 'b'] },
    });

    adapters.push(built.adapter);

    const runner = new Runner(built.jobs);

    expect(runner.concurrency).toBe(9);
    expect(runner.queues).toEqual(['a', 'b']);
    expect(new Runner(built.jobs, { concurrency: 2 }).concurrency).toBe(2);
  });

  test('performs everything that is due and stops', async () => {
    for (const token of ['a', 'b', 'c']) {
      await jobs.perform('counter', { token });
    }

    const result = await new Runner(jobs, { concurrency: 2 }).once();

    expect(result.performed).toBe(3);
    expect(global.__henriJobsRuns).toHaveLength(3);
  });

  test('the loop performs what it is given, then stops on demand', async () => {
    const runner = new Runner(jobs, { concurrency: 2 });

    await jobs.perform('counter', { token: 'looped' });

    runner.start();

    // The loop polls every 50ms: wait for the job rather than for a delay
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (global.__henriJobsRuns.length > 0) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const result = await runner.stop();

    expect(global.__henriJobsRuns).toEqual(['looped']);
    expect(result.performed).toBe(1);
    expect(runner.loop).toBeNull();
  }, 20000);

  test('stopping twice is not an error', async () => {
    const runner = new Runner(jobs);

    runner.start();

    const [first, second] = await Promise.all([runner.stop(), runner.stop()]);

    expect(first.performed).toBe(0);
    expect(second.performed).toBe(0);
  });

  test('listens on the usual signals and lets go when it stops', async () => {
    const before = SIGNALS.map((signal) => process.listenerCount(signal));
    const runner = new Runner(jobs);

    runner.start({ signals: true });

    expect(SIGNALS.map((signal) => process.listenerCount(signal))).toEqual(
      before.map((count) => count + 1)
    );

    await runner.stop();

    expect(SIGNALS.map((signal) => process.listenerCount(signal))).toEqual(
      before
    );
  });

  test('waits for the jobs in flight before it says it is stopped', async () => {
    await jobs.perform('counter', { token: 'in-flight' });

    const runner = new Runner(jobs);
    const result = await runner.once();

    expect(runner.running.size).toBe(0);
    expect(result.performed).toBe(1);
  });

  test('keeps a heartbeat on the jobs it holds', async () => {
    const enqueued = await jobs.perform('ok', null);
    const runner = new Runner(jobs, { id: 'beating' });

    await jobs.store.claim({
      limit: 1,
      now: Date.now(),
      queues: [],
      runner: 'beating',
      token: 'beat-token',
    });
    await jobs.store.update(enqueued.id, { heartbeat_at: 1 });

    runner.running.set(enqueued.id, Promise.resolve());
    await runner.beat();
    runner.running.clear();

    const row = await jobs.store.find(enqueued.id);

    expect(Number(row.heartbeat_at)).toBeGreaterThan(1);
  });

  test('prunes the finished jobs while it runs', async () => {
    const job = await jobs.perform('ok', null);
    const runner = new Runner(jobs, { concurrency: 1 });

    await runner.once();
    await jobs.store.update(job.id, { finished_at: Date.now() - 100000 });

    runner.keepCompleted = 1000;
    runner.maintenanceAt = 0;
    await runner.maintain();

    expect(await jobs.get(job.id)).toBeNull();
  });
});
