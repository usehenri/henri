const { randomUUID } = require('crypto');

const { adapterFor, build, close, sharedKey, target } = require('./helpers');
const { Runner } = require('../src/runner');

/**
 * The claim is the part that has to be right: a job must never be performed
 * twice because two runners raced for it.
 *
 * These suites run on whatever the environment points at. On sqlite they
 * prove the logic; the guarantee itself is only worth anything against a
 * real server with real concurrent sessions, which is why
 * `pnpm test:sql:live` runs the same file against PostgreSQL and MySQL --
 * every queue built here opens its own connection pool, so the claims race
 * on the server, not in one client.
 */

// sqlite serializes every writer of a file and answers SQLITE_BUSY to the
// ones that waited too long; a real server takes them all at once
const RUNNERS = target.live ? 4 : 2;
const JOBS = target.live ? 40 : 12;

describe(`claiming (${target.name}, ${RUNNERS} runners)`, () => {
  const adapters = [];
  const queues = [];
  let key = null;

  beforeAll(async () => {
    key = sharedKey('claim');

    for (let index = 0; index < RUNNERS; index += 1) {
      const adapter = await adapterFor(key);
      const built = await build({ adapter });

      adapters.push(adapter);
      queues.push(built.jobs);
    }
  }, 60000);

  afterAll(() => close(adapters));

  beforeEach(async () => {
    for (const state of ['pending', 'running', 'done', 'dead']) {
      await queues[0].store.remove({ state });
    }

    global.__henriJobsRuns = [];
  });

  test('every queue talks to the same database', async () => {
    await queues[0].perform('ok', { shared: true });

    expect(await queues[RUNNERS - 1].count()).toBe(1);
  });

  test('no job is ever claimed by two runners at once', async () => {
    for (let index = 0; index < JOBS; index += 1) {
      await queues[0].perform('counter', { token: `job-${index}` });
    }

    const now = Date.now();
    const claims = await Promise.all(
      queues.map((queue, index) =>
        queue.store.claim({
          limit: JOBS,
          now,
          queues: [],
          runner: `runner-${index}`,
          token: randomUUID(),
        })
      )
    );
    const ids = claims.flat().map((row) => row.id);

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);

    // Whatever the interleaving, a claimed row is running and owned by one
    // runner only
    for (const row of claims.flat()) {
      expect(row.state).toBe('running');
      expect(row.claimed_by).toMatch(/^runner-\d$/);
    }
  });

  test('several runners drain a queue, performing each job exactly once', async () => {
    const tokens = [];

    for (let index = 0; index < JOBS; index += 1) {
      const token = `token-${index}`;

      tokens.push(token);
      await queues[0].perform('counter', { token });
    }

    const results = await Promise.all(
      queues.map((queue) =>
        new Runner(queue, { concurrency: 3, recurring: false }).once()
      )
    );
    const runs = global.__henriJobsRuns;

    expect(runs).toHaveLength(JOBS);
    expect([...runs].sort()).toEqual([...tokens].sort());
    expect(results.reduce((total, one) => total + one.performed, 0)).toBe(JOBS);
    expect(await queues[0].count({ state: 'done' })).toBe(JOBS);
    expect(await queues[0].count({ state: 'pending' })).toBe(0);
  }, 60000);

  test('a claim never hands out more jobs than it asked for', async () => {
    for (let index = 0; index < 6; index += 1) {
      await queues[0].perform('ok', { index });
    }

    const claimed = await queues[0].store.claim({
      limit: 2,
      now: Date.now(),
      queues: [],
      runner: 'limited',
      token: randomUUID(),
    });

    expect(claimed).toHaveLength(2);
    expect(await queues[0].count({ state: 'pending' })).toBe(4);
  });

  test('a claim counts the attempt of the job it took', async () => {
    const job = await queues[0].perform('ok', null);
    const [claimed] = await queues[0].store.claim({
      limit: 1,
      now: Date.now(),
      queues: [],
      runner: 'counter',
      token: randomUUID(),
    });

    expect(claimed.id).toBe(job.id);
    expect(Number(claimed.attempts)).toBe(1);
    expect(claimed.started_at).not.toBeNull();
  });

  test('a claim leaves the other queues alone', async () => {
    await queues[0].perform('ok', null);
    await queues[0].perform('mailers', null);

    const claimed = await queues[0].store.claim({
      limit: 10,
      now: Date.now(),
      queues: ['mailers'],
      runner: 'mailers-only',
      token: randomUUID(),
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].queue).toBe('mailers');
  });
});
