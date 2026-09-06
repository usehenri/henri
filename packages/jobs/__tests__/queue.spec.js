const { build, close, target } = require('./helpers');
const { Runner } = require('../src/runner');

describe(`queue (${target.name})`, () => {
  const adapters = [];
  let jobs = null;
  let henri = null;

  beforeAll(async () => {
    const built = await build();

    jobs = built.jobs;
    henri = built.henri;
    adapters.push(built.adapter);
  });

  afterAll(() => close(adapters));

  beforeEach(async () => {
    await jobs.store.remove({ state: 'pending' });
    await jobs.store.remove({ state: 'running' });
    await jobs.store.remove({ state: 'done' });
    await jobs.store.remove({ state: 'dead' });
    global.__henriJobsRuns = [];
  });

  describe('definitions', () => {
    test('loads app/jobs, keeping the path of a subdirectory', () => {
      // `henri/mail` is the job the package ships for the mailers
      expect(jobs.names()).toEqual([
        'boom',
        'counter',
        'henri/mail',
        'mailers',
        'nested/deep',
        'ok',
        'slow',
      ]);
    });

    test('takes the queue, the priority and the retries of the file', () => {
      expect(jobs.definitions.mailers.queue).toBe('mailers');
      expect(jobs.definitions.mailers.priority).toBe(-5);
      expect(jobs.definitions.boom.maxAttempts).toBe(3);
      expect(jobs.definitions.ok.queue).toBe('default');
      expect(jobs.definitions.ok.maxAttempts).toBe(5);
    });

    test('refuses to enqueue a job that does not exist', async () => {
      await expect(jobs.perform('nope')).rejects.toThrow('No job named "nope"');
    });

    test('says which jobs there are when the name is wrong', async () => {
      const error = await jobs.perform('nope').catch((thrown) => thrown);

      expect(error.code).toBe('UNKNOWN_JOB');
      expect(error.hint).toContain('boom');
    });
  });

  describe('enqueuing', () => {
    test('writes a pending job and nothing else', async () => {
      const job = await jobs.perform('ok', { hello: 'world' });

      expect(job.state).toBe('pending');
      expect(job.args).toEqual({ hello: 'world' });
      expect(job.queue).toBe('default');
      expect(job.attempts).toBe(0);
      expect(job.maxAttempts).toBe(5);
      expect(new Date(job.runAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    test('refuses arguments it cannot store', async () => {
      await expect(jobs.perform('ok', { run: () => null })).rejects.toThrow(
        'args.run is a function'
      );
      expect(await jobs.count()).toBe(0);
    });

    test('enqueues after a delay', async () => {
      const job = await jobs.performIn('1h', 'ok', null);

      expect(new Date(job.runAt).getTime()).toBeGreaterThan(
        Date.now() + 3500000
      );
    });

    test('enqueues at a moment', async () => {
      const when = new Date(Date.now() + 86400000);
      const job = await jobs.performAt(when, 'ok', null);

      expect(job.runAt).toBe(when.toISOString());
    });

    test('takes a queue and a priority from the call', async () => {
      const job = await jobs.perform('ok', null, {
        priority: -20,
        queue: 'urgent',
      });

      expect(job.queue).toBe('urgent');
      expect(job.priority).toBe(-20);
    });

    test('keeps one job per unique key', async () => {
      const first = await jobs.perform('ok', { n: 1 }, { unique: 'only-one' });
      const second = await jobs.perform('ok', { n: 2 }, { unique: 'only-one' });

      expect(second.id).toBe(first.id);
      expect(second.args).toEqual({ n: 1 });
      expect(await jobs.count()).toBe(1);
    });

    test('performs inline with performNow, without touching the queue', async () => {
      const result = await jobs.performNow('ok', { hello: 'inline' });

      expect(result).toEqual({ args: { hello: 'inline' }, attempt: 1 });
      expect(await jobs.count()).toBe(0);
    });

    test('performNow refuses the arguments the queue would refuse', async () => {
      await expect(jobs.performNow('ok', { run: () => null })).rejects.toThrow(
        'args.run is a function'
      );
    });
  });

  describe('running', () => {
    test('performs a job and records how long it took', async () => {
      const enqueued = await jobs.perform('ok', { hello: 'run' });
      const runner = new Runner(jobs, { concurrency: 2 });
      const result = await runner.once();

      expect(result.performed).toBe(1);

      const job = await jobs.get(enqueued.id);

      expect(job.state).toBe('done');
      expect(job.attempts).toBe(1);
      expect(job.duration).toBeGreaterThanOrEqual(0);
      expect(job.finishedAt).not.toBeNull();
      expect(job.error).toBeNull();
    });

    test('leaves a job whose moment has not come', async () => {
      await jobs.performIn('1h', 'ok', null);

      const result = await new Runner(jobs).once();

      expect(result.performed).toBe(0);
      expect(await jobs.count({ state: 'pending' })).toBe(1);
    });

    test('takes only the queues it was asked for', async () => {
      await jobs.perform('ok', null);
      await jobs.perform('mailers', null);

      const result = await new Runner(jobs, { queues: ['mailers'] }).once();

      expect(result.performed).toBe(1);
      expect(await jobs.count({ queue: 'default', state: 'pending' })).toBe(1);
      expect(await jobs.count({ queue: 'mailers', state: 'done' })).toBe(1);
    });

    test('runs the lowest priority first', async () => {
      await jobs.perform('counter', { token: 'last' }, { priority: 10 });
      await jobs.perform('counter', { token: 'first' }, { priority: -10 });

      await new Runner(jobs, { concurrency: 1 }).once();

      expect(global.__henriJobsRuns).toEqual(['first', 'last']);
    });

    test('fails the attempt when it runs past its timeout', async () => {
      const enqueued = await jobs.perform('slow', null);

      await new Runner(jobs).once();

      const job = await jobs.get(enqueued.id);

      expect(job.state).toBe('dead');
      expect(job.error.message).toContain('timed out after 40ms');
    });
  });

  describe('retries and the dead letter queue', () => {
    test('retries with a backoff, then buries the job', async () => {
      const enqueued = await jobs.perform('boom', { why: 'testing' });

      await new Runner(jobs).once();

      let job = await jobs.get(enqueued.id);

      expect(job.state).toBe('pending');
      expect(job.attempts).toBe(1);
      expect(job.error.message).toBe('boom on attempt 1');
      expect(new Date(job.runAt).getTime()).toBeGreaterThan(Date.now());

      // The next attempts are a minute away: bring them forward instead of
      // waiting on the clock
      for (const attempt of [2, 3]) {
        await jobs.store.update(enqueued.id, { run_at: Date.now() });
        await new Runner(jobs).once();
        job = await jobs.get(enqueued.id);
        expect(job.attempts).toBe(attempt);
      }

      expect(job.state).toBe('dead');
      expect(job.error.message).toBe('boom on attempt 3');
      expect(job.error.stack).toContain('boom.js');
      expect(job.history).toHaveLength(3);
      expect(job.history.map((entry) => entry.attempt)).toEqual([1, 2, 3]);
      expect(job.finishedAt).not.toBeNull();
    });

    test('the backoff grows and is capped', () => {
      const definition = {
        backoff: { base: 1000, factor: 4, jitter: 0, max: 10000 },
      };

      expect(jobs.backoff(definition, 1)).toBe(1000);
      expect(jobs.backoff(definition, 2)).toBe(4000);
      expect(jobs.backoff(definition, 3)).toBe(10000);
      expect(jobs.backoff(definition, 9)).toBe(10000);
    });

    test('lists, retries and discards dead jobs', async () => {
      const enqueued = await jobs.perform('boom', null, { maxAttempts: 1 });

      await new Runner(jobs).once();

      expect(await jobs.dead.count()).toBe(1);

      const [dead] = await jobs.dead.list();

      expect(dead.id).toBe(enqueued.id);
      expect(dead.state).toBe('dead');

      const requeued = await jobs.dead.retry(dead.id);

      expect(requeued.state).toBe('pending');
      expect(requeued.attempts).toBe(0);
      expect(await jobs.dead.count()).toBe(0);

      await new Runner(jobs).once();
      expect(await jobs.dead.count()).toBe(1);
      expect(await jobs.dead.discard(dead.id)).toBe(true);
      expect(await jobs.dead.count()).toBe(0);
    });

    test('retries and discards every dead job at once', async () => {
      await jobs.perform('boom', { one: true }, { maxAttempts: 1 });
      await jobs.perform('boom', { two: true }, { maxAttempts: 1 });
      await new Runner(jobs).once();

      expect(await jobs.dead.retryAll()).toBe(2);

      await new Runner(jobs).once();

      expect(await jobs.dead.discardAll()).toBe(2);
      expect(await jobs.dead.count()).toBe(0);
    });

    test('answers null when retrying an id that is not there', async () => {
      expect(await jobs.dead.retry('nope')).toBeNull();
      expect(await jobs.dead.discard('nope')).toBe(false);
    });

    test('puts back a job this runner has no file for', async () => {
      // A rolling deploy: the runner is older than the process that
      // enqueued the job, so the name means nothing to it yet. Burying it
      // would fill the dead letter queue with work the next runner can do
      const enqueued = await jobs.perform('ok', null);

      delete jobs.definitions.ok;

      try {
        await new Runner(jobs).once();
      } finally {
        await jobs.start();
      }

      const job = await jobs.get(enqueued.id);

      expect(job.state).toBe('pending');
      expect(job.attempts).toBe(1);
      expect(job.error.message).toBe('No job named "ok"');
      expect(new Date(job.runAt).getTime()).toBeGreaterThan(Date.now());
    });

    test('buries it once it is out of attempts', async () => {
      const enqueued = await jobs.perform('ok', null, { maxAttempts: 1 });

      delete jobs.definitions.ok;

      try {
        await new Runner(jobs).once();
      } finally {
        await jobs.start();
      }

      expect((await jobs.get(enqueued.id)).state).toBe('dead');
    });
  });

  describe('recovering', () => {
    test('puts back a job a runner died on', async () => {
      const enqueued = await jobs.perform('ok', null);

      await jobs.store.claim({
        limit: 1,
        now: Date.now(),
        queues: [],
        runner: 'gone',
        token: 'stale-token',
      });
      await jobs.store.update(enqueued.id, { heartbeat_at: 0 });

      const recovered = await jobs.store.recover({
        now: Date.now(),
        stuckAfter: 1000,
      });

      expect(recovered).toHaveLength(1);

      const job = await jobs.get(enqueued.id);

      expect(job.state).toBe('pending');
      expect(job.error.message).toContain('stopped answering');
    });

    test('buries a job a runner died on when it has no attempt left', async () => {
      const enqueued = await jobs.perform('ok', null, { maxAttempts: 1 });

      await jobs.store.claim({
        limit: 1,
        now: Date.now(),
        queues: [],
        runner: 'gone',
        token: 'stale-token-2',
      });
      await jobs.store.update(enqueued.id, { heartbeat_at: 0 });
      await jobs.store.recover({ now: Date.now(), stuckAfter: 1000 });

      expect((await jobs.get(enqueued.id)).state).toBe('dead');
    });
  });

  describe('ownership', () => {
    test('a runner that was recovered from cannot write its outcome', async () => {
      const enqueued = await jobs.perform('ok', null);
      // The runner that claimed it, and then went quiet
      const [claimed] = await jobs.store.claim({
        limit: 1,
        now: Date.now(),
        queues: [],
        runner: 'zombie',
        token: 'zombie-token',
      });

      await jobs.store.update(enqueued.id, { heartbeat_at: 0 });
      await jobs.store.recover({ now: Date.now(), stuckAfter: 1000 });

      // Someone else takes it and is performing it right now
      await jobs.store.claim({
        limit: 1,
        now: Date.now(),
        queues: [],
        runner: 'the-new-owner',
        token: 'new-token',
      });

      // The zombie wakes up and writes what it thinks happened
      await jobs.run(claimed, { runner: 'zombie' });

      const job = await jobs.get(enqueued.id);

      expect(job.state).toBe('running');
      expect(job.claimedBy).toBe('the-new-owner');
    });

    test('a runner that still owns a job writes its outcome', async () => {
      const enqueued = await jobs.perform('ok', null);
      const [claimed] = await jobs.store.claim({
        limit: 1,
        now: Date.now(),
        queues: [],
        runner: 'the-owner',
        token: 'owner-token',
      });

      await jobs.run(claimed, { runner: 'the-owner' });

      expect((await jobs.get(enqueued.id)).state).toBe('done');
    });

    test('a heartbeat from a runner that lost the job does nothing', async () => {
      const enqueued = await jobs.perform('ok', null);

      await jobs.store.claim({
        limit: 1,
        now: Date.now(),
        queues: [],
        runner: 'zombie',
        token: 'gone-token',
      });
      await jobs.store.update(enqueued.id, { heartbeat_at: 1 });
      await jobs.store.heartbeat([enqueued.id], Date.now(), 'gone-token');

      expect(
        Number((await jobs.store.find(enqueued.id)).heartbeat_at)
      ).toBeGreaterThan(1);

      await jobs.store.update(enqueued.id, { heartbeat_at: 1 });
      await jobs.store.heartbeat([enqueued.id], Date.now(), 'some-other-token');

      expect(Number((await jobs.store.find(enqueued.id)).heartbeat_at)).toBe(1);
    });

    test('refuses to requeue a job a runner is performing', async () => {
      const enqueued = await jobs.perform('ok', null);

      await jobs.store.claim({
        limit: 1,
        now: Date.now(),
        queues: [],
        runner: 'busy',
        token: 'busy-token',
      });

      await expect(jobs.retry(enqueued.id)).rejects.toThrow(
        'is being performed by busy'
      );
      expect((await jobs.get(enqueued.id)).state).toBe('running');
    });

    test('frees the unique key of a job once it is finished', async () => {
      const first = await jobs.perform('ok', { n: 1 }, { unique: 'monthly' });

      await new Runner(jobs).once();
      expect((await jobs.get(first.id)).state).toBe('done');

      const second = await jobs.perform('ok', { n: 2 }, { unique: 'monthly' });

      expect(second.id).not.toBe(first.id);
      expect(second.state).toBe('pending');
    });

    test('frees the unique key of a job that died', async () => {
      const first = await jobs.perform('boom', null, {
        maxAttempts: 1,
        unique: 'nightly',
      });

      await new Runner(jobs).once();
      expect((await jobs.get(first.id)).state).toBe('dead');

      const second = await jobs.perform('boom', null, { unique: 'nightly' });

      expect(second.id).not.toBe(first.id);
      expect(await jobs.dead.count()).toBe(1);
    });

    test('fails the attempt when the stored arguments cannot be read', async () => {
      const enqueued = await jobs.perform('ok', { fine: true });

      await jobs.store.update(enqueued.id, { args: '{not json' });
      await new Runner(jobs).once();

      const job = await jobs.get(enqueued.id);

      expect(job.attempts).toBe(1);
      expect(job.error.message).toContain('not readable JSON');
    });
  });

  describe('observability', () => {
    test('counts by queue and state, with timings and waits', async () => {
      await jobs.perform('ok', null);
      await jobs.perform('mailers', null);
      await jobs.perform('boom', null, { maxAttempts: 1 });

      await new Runner(jobs).once();

      const stats = await jobs.stats();

      expect(stats.totals).toEqual({
        dead: 1,
        done: 2,
        pending: 0,
        running: 0,
      });

      const byName = Object.fromEntries(
        stats.queues.map((entry) => [entry.queue, entry])
      );

      expect(byName.default.done).toBe(1);
      expect(byName.default.dead).toBe(1);
      expect(byName.mailers.done).toBe(1);

      const timings = Object.fromEntries(
        stats.timings.map((entry) => [entry.queue, entry])
      );

      expect(timings.default.runs).toBe(1);
      expect(timings.default.average).toBeGreaterThanOrEqual(0);
      expect(stats.jobs).toContain('ok');
    });

    test('reports how long the oldest due job has been waiting', async () => {
      const job = await jobs.perform('ok', null);

      await jobs.store.update(job.id, { run_at: Date.now() - 60000 });

      const stats = await jobs.stats();
      const [queue] = stats.queues.filter((entry) => entry.queue === 'default');

      expect(queue.waiting).toBeGreaterThanOrEqual(60000);
    });

    test('refuses a state that does not exist', async () => {
      await expect(jobs.list({ state: 'sleeping' })).rejects.toThrow(
        'No such state "sleeping"'
      );
    });

    test('prunes the finished jobs that are old enough', async () => {
      const job = await jobs.perform('ok', null);

      await new Runner(jobs).once();
      await jobs.store.update(job.id, { finished_at: Date.now() - 100000 });

      expect(await jobs.store.prune(Date.now() - 1000)).toBe(1);
      expect(await jobs.get(job.id)).toBeNull();
    });
  });

  describe('logging', () => {
    test('never writes the arguments of a job in the log', async () => {
      henri.calls.length = 0;
      await jobs.perform('boom', { secret: 'hunter2' }, { maxAttempts: 1 });
      await new Runner(jobs).once();

      const said = JSON.stringify(henri.calls);

      expect(said).toContain('boom');
      expect(said).not.toContain('hunter2');
    });
  });
});
