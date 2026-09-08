const { randomUUID } = require('crypto');

const live = require('./live');
const { adapterFor, build, close, sharedKey, target } = require('./helpers');
const { Runner } = require('../src/runner');

/**
 * A concurrency limit is a **negative** property: never more than N of a job
 * at once, across every runner. A count taken afterwards cannot see it --
 * two jobs that overlapped for a millisecond and two that never met leave
 * the same rows behind -- so the jobs themselves record when they are
 * inside (`./live.js`) and these suites assert the high-water mark.
 *
 * Like `claim.spec.js`, every queue here opens its own connection pool, so
 * the runners race on the server rather than in one client. On sqlite that
 * proves the logic; against the PostgreSQL and MySQL of `pnpm test:sql:live`
 * it proves the guarantee.
 *
 * **Every assertion about the high-water mark is an upper bound**, and that
 * is not an accident: a loaded machine may run fewer jobs at once than it
 * was allowed to, so `most(key) <= limit` fails only on a real bug while
 * `most(key) >= 2` fails on a slow afternoon. What a drain cannot show --
 * that a key which is full holds back its own work and nobody else's -- is
 * asserted through the permits instead, which involve no clock.
 */

const RUNNERS = target.live ? 4 : 2;
const JOBS = target.live ? 24 : 10;

describe(`concurrency limits (${target.name}, ${RUNNERS} runners)`, () => {
  const adapters = [];
  const queues = [];

  /**
   * Empties the queue and every slot it holds
   *
   * @returns {Promise<void>} Resolves when it is empty
   */
  const clear = async () => {
    for (const state of ['pending', 'running', 'done', 'dead']) {
      await queues[0].store.remove({ state });
    }

    for (const held of await queues[0].store.slots()) {
      await queues[0].store.releaseSlot(held.key, held.slot);
    }

    live.reset();
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

    for (let waited = 0; waited < 600; waited += 1) {
      const pending = await queues[0].count({ state: 'pending' });
      const running = await queues[0].count({ state: 'running' });

      if (pending === 0 && running === 0) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return Promise.all(runners.map((runner) => runner.stop()));
  };

  beforeAll(async () => {
    const key = sharedKey('concurrency');

    for (let index = 0; index < RUNNERS; index += 1) {
      const adapter = await adapterFor(key);
      const built = await build({
        adapter,
        config: { pollInterval: 25, stuckAfter: '10s' },
      });

      adapters.push(adapter);
      queues.push(built.jobs);
    }
  }, 60000);

  afterAll(() => close(adapters));

  beforeEach(clear);

  test('the store can hold a concurrency key', async () => {
    // Everything below rests on this: without the column the queue refuses
    // to start with a limited job rather than running it unbounded
    expect(await queues[0].store.concurrent()).toBe(true);
    expect(queues[0].concurrent).toBe(true);
  });

  test('exactly as many slots are handed out as the limit allows', async () => {
    const key = `slots:${randomUUID().slice(0, 8)}`;
    const limit = Math.max(2, Math.floor(RUNNERS / 2));
    const taken = await Promise.all(
      queues.map((queue, index) =>
        queue.store.takeSlot({
          key,
          limit,
          now: Date.now(),
          runner: `runner-${index}`,
        })
      )
    );
    const won = taken.filter((slot) => slot !== null);

    // The primary key of the table is what refuses the others: one insert
    // per slot succeeds, whatever the interleaving
    expect(won).toHaveLength(Math.min(limit, RUNNERS));
    expect(new Set(won).size).toBe(won.length);
    expect(await queues[0].store.slots()).toHaveLength(won.length);

    for (const slot of won) {
      expect(slot).toBeLessThan(limit);
    }
  }, 30000);

  test('a slot nobody freed is taken again once it is released', async () => {
    const key = `once:${randomUUID().slice(0, 8)}`;
    const first = await queues[0].store.takeSlot({
      key,
      limit: 1,
      now: Date.now(),
      runner: 'first',
    });

    expect(first).toBe(0);
    expect(
      await queues[1 % RUNNERS].store.takeSlot({
        key,
        limit: 1,
        now: Date.now(),
        runner: 'second',
      })
    ).toBeNull();

    await queues[0].store.releaseSlot(key, first, 'first');

    expect(
      await queues[1 % RUNNERS].store.takeSlot({
        key,
        limit: 1,
        now: Date.now(),
        runner: 'second',
      })
    ).toBe(0);
  });

  test('never more than one exclusive job runs, whatever the runners do', async () => {
    const tokens = [];

    for (let index = 0; index < JOBS; index += 1) {
      const token = `exclusive-${index}`;

      tokens.push(token);
      await queues[0].perform('exclusive', { token });
    }

    await drain();

    // The property: not "one was performed at a time on average", but that
    // two were never inside at once
    expect(live.most('exclusive')).toBe(1);
    expect([...live.performed()].sort()).toEqual([...tokens].sort());
    expect(await queues[0].count({ state: 'done' })).toBe(JOBS);
    expect(await queues[0].count({ state: 'pending' })).toBe(0);
  }, 120000);

  test('a keyed limit bounds each key and never the whole job', async () => {
    const tenants = ['acme', 'globex', 'initech'];

    for (const tenant of tenants) {
      for (let index = 0; index < 4; index += 1) {
        await queues[0].perform('tenanted', {
          tenant,
          token: `${tenant}-${index}`,
        });
      }
    }

    await drain();

    for (const tenant of tenants) {
      expect(live.most(`tenanted:${tenant}`)).toBeGreaterThan(0);
      expect(live.most(`tenanted:${tenant}`)).toBeLessThanOrEqual(2);
    }

    expect(live.performed()).toHaveLength(tenants.length * 4);
    expect(await queues[0].count({ state: 'done' })).toBe(tenants.length * 4);
  }, 120000);

  test('a full key never holds another key of the same job back', async () => {
    // The other half of a keyed limit, and the half a drain cannot show:
    // that three tenants of two ran six at once is a claim about wall clock
    // overlap, which a loaded machine is free to deny. What the bound
    // actually promises is that a full key stops its own work and no one
    // else's, and permits say that without a timer
    for (const tenant of ['acme', 'globex']) {
      for (let index = 0; index < 2; index += 1) {
        await queues[0].perform('tenanted', {
          tenant,
          token: `${tenant}-${index}`,
        });
      }
    }

    // Somebody else holds every permit acme has
    const held = [];

    for (let slot = 0; slot < 2; slot += 1) {
      held.push(
        await queues[0].store.takeSlot({
          key: 'tenanted:acme',
          limit: 2,
          now: Date.now(),
          runner: 'somebody-else',
        })
      );
    }

    expect(held).toEqual([0, 1]);

    await new Runner(queues[1 % RUNNERS], {
      concurrency: 4,
      recurring: false,
    }).once();

    // The globex jobs went through; acme is still waiting, and would not be
    // if the bound were on `tenanted` rather than on the key
    expect([...live.performed()].sort()).toEqual(['globex-0', 'globex-1']);

    const waiting = await queues[0].list({ state: 'pending' });

    expect(waiting).toHaveLength(2);
    expect(waiting.every((job) => job.concurrencyKey === 'tenanted:acme')).toBe(
      true
    );

    for (const slot of held) {
      await queues[0].store.releaseSlot('tenanted:acme', slot, 'somebody-else');
    }

    await new Runner(queues[1 % RUNNERS], {
      concurrency: 4,
      recurring: false,
    }).once();

    expect(live.performed()).toHaveLength(4);
    expect(await queues[0].count({ state: 'pending' })).toBe(0);
  }, 60000);

  test('the key is stored with the job, prefixed by its group', async () => {
    const bounded = await queues[0].perform('tenanted', {
      tenant: 'acme',
      token: 'k',
    });
    const exclusive = await queues[0].perform('exclusive', { token: 'k' });
    const plain = await queues[0].perform('ok', null);

    expect(bounded.concurrencyKey).toBe('tenanted:acme');
    // No key of its own: the group is the bucket, and so is a row an older
    // henri enqueued with no key at all
    expect(exclusive.concurrencyKey).toBe('exclusive');
    expect(plain.concurrencyKey).toBeNull();
  });

  test('a full key holds its own jobs back and nobody else', async () => {
    await queues[0].perform('exclusive', { token: 'held' });
    await queues[0].perform('ok', { token: 'free' });

    // Somebody else is holding the only slot of `exclusive`
    const held = await queues[0].store.takeSlot({
      key: 'exclusive',
      limit: 1,
      now: Date.now(),
      runner: 'somebody-else',
    });

    expect(held).toBe(0);

    const runner = new Runner(queues[1 % RUNNERS], {
      concurrency: 4,
      recurring: false,
    });

    await runner.once();

    expect(await queues[0].count({ state: 'pending' })).toBe(1);

    const [waiting] = await queues[0].list({ state: 'pending' });

    expect(waiting.name).toBe('exclusive');
    // The unbounded job went through while the bounded one waited
    expect(live.performed()).toEqual([]);

    await queues[0].store.releaseSlot('exclusive', held, 'somebody-else');
    await runner.once();

    expect(live.performed()).toEqual(['held']);
  }, 60000);

  test('a job enqueued before the limit was declared is bounded too', async () => {
    // What an upgrade leaves behind: rows written by a henri whose table had
    // no `concurrency_key` at all
    for (let index = 0; index < 4; index += 1) {
      const job = await queues[0].perform('exclusive', {
        token: `older-${index}`,
      });

      await queues[0].store.update(job.id, { concurrency_key: null });
    }

    expect(
      (await queues[0].list({ state: 'pending' })).every(
        (job) => job.concurrencyKey === null
      )
    ).toBe(true);

    await drain();

    expect(live.most('exclusive')).toBe(1);
    expect(live.performed()).toHaveLength(4);
  }, 120000);

  test('every slot is given back when the jobs are done', async () => {
    for (let index = 0; index < 3; index += 1) {
      await queues[0].perform('exclusive', { token: `back-${index}` });
    }

    await drain();

    expect(await queues[0].store.slots()).toEqual([]);
  }, 120000);

  test('a slot whose runner stopped answering is freed', async () => {
    const key = `stale:${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    await queues[0].store.takeSlot({
      key,
      limit: 1,
      now: now - 60000,
      runner: 'a-runner-that-died',
    });

    // Not yet: the heartbeat is younger than stuckAfter
    expect(
      await queues[0].store.sweepSlots({ now, stuckAfter: 300000 })
    ).toEqual([]);

    const freed = await queues[0].store.sweepSlots({ now, stuckAfter: 30000 });

    expect(freed).toHaveLength(1);
    expect(freed[0].key).toBe(key);
    expect(freed[0].runner).toBe('a-runner-that-died');
    expect(await queues[0].store.slots()).toEqual([]);
  });

  test('the unlimited claim never takes a job that declares a limit', async () => {
    await queues[0].perform('exclusive', { token: 'bounded' });
    await queues[0].perform('ok', null);

    const claimed = await queues[0].store.claim({
      except: queues[0].limited().names,
      limit: 10,
      now: Date.now(),
      queues: [],
      runner: 'unlimited-only',
      token: randomUUID(),
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].name).toBe('ok');
  });

  test('two jobs that share a group and disagree on it are refused', () => {
    const bounded = (name, limit) => ({
      concurrency: { group: 'imports', key: null, limit },
      name,
    });

    expect(() =>
      queues[0].conflicts([bounded('a', 2), bounded('b', 2)])
    ).not.toThrow();

    let error = null;

    try {
      queues[0].conflicts([bounded('a', 2), bounded('b', 3)]);
    } catch (thrown) {
      error = thrown;
    }

    expect(error).not.toBeNull();
    expect(error.code).toBe('HENRI_JOB_CONCURRENCY_CONFLICT');
    expect(error.message).toContain('imports');
  });

  test('jobs of one group share one bound between them', async () => {
    for (const [index, queue] of queues.entries()) {
      for (const half of ['one', 'two']) {
        queue.define(`grouped/${half}`, {
          concurrency: { group: 'grouped', limit: 1 },

          /**
           * Counts itself inside the shared window
           *
           * @param {object} args What it was enqueued with
           * @returns {Promise<string>} Its token
           */
          perform: (args) => live.inside('grouped', args.token, 25),
        });
      }

      expect(queue.limited().groups.get('grouped').names.sort()).toEqual([
        'grouped/one',
        'grouped/two',
      ]);
      expect(index).toBeGreaterThanOrEqual(0);
    }

    for (let index = 0; index < 4; index += 1) {
      await queues[0].perform(`grouped/${index % 2 ? 'one' : 'two'}`, {
        token: `grouped-${index}`,
      });
    }

    await drain();

    // One bound across two job names: that is what a group is for
    expect(live.most('grouped')).toBe(1);
    expect(live.performed()).toHaveLength(4);
  }, 120000);

  test('the keys with work waiting come back, the most urgent first', async () => {
    await queues[0].perform('tenanted', { tenant: 'b', token: '1' });
    await queues[0].perform(
      'tenanted',
      { tenant: 'a', token: '2' },
      { priority: -10 }
    );
    await queues[0].perform('ok', null);

    const waiting = await queues[0].store.waiting({
      names: queues[0].limited().names,
      now: Date.now(),
      queues: [],
    });

    expect(waiting.map((entry) => entry.key)).toEqual([
      'tenanted:a',
      'tenanted:b',
    ]);
    expect(waiting.every((entry) => entry.name === 'tenanted')).toBe(true);
  });
});

describe(`upgrading a queue an older henri installed (${target.name})`, () => {
  const adapters = [];
  let jobs = null;
  let store = null;

  /**
   * Takes the table back to what a henri without concurrency limits wrote
   *
   * @returns {Promise<void>} Resolves when the column is gone
   */
  const downgrade = async () => {
    const { jobs: table } = jobs.config.tables;

    await store.run(`DROP INDEX IF EXISTS ${table}_limited`).catch(() => null);
    await store
      .run(`ALTER TABLE ${table} DROP INDEX ${table}_limited`)
      .catch(() => null);
    await store.run(`ALTER TABLE ${table} DROP COLUMN concurrency_key`);
    store.limits = null;
    jobs.concurrent = await store.concurrent();
  };

  beforeAll(async () => {
    const adapter = await adapterFor(sharedKey('upgrade'));
    const built = await build({ adapter });

    adapters.push(adapter);
    jobs = built.jobs;
    store = built.jobs.store;
    await downgrade();
  }, 60000);

  afterAll(() => close(adapters));

  test('the queue works exactly as it did without the column', async () => {
    // Nothing about an application that declares no limit changes: the
    // claim statement it sends is the one it always sent
    expect(await store.concurrent()).toBe(false);

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

  test('a job that declares a limit refuses to start rather than run unbounded', async () => {
    const { Jobs } = require('../src/jobs');
    const bounded = new Jobs(
      { cwd: () => jobs.cwd, pen: null },
      { adapter: store.adapter, config: { install: false }, cwd: jobs.cwd }
    );
    const error = await bounded.start().then(
      () => null,
      (thrown) => thrown
    );

    expect(error).not.toBeNull();
    expect(error.code).toBe('HENRI_JOB_LIMIT_UNINSTALLED');
    expect(error.message).toContain('exclusive');
    expect(error.hint).toContain('henri jobs:install');
  });

  test('the install adds the column, and the limits work from then on', async () => {
    const statements = await store.install();

    expect(statements.join(';')).toContain('concurrency_key');
    store.limits = null;
    expect(await store.concurrent()).toBe(true);

    // The same queue, started again, now has its bound
    const { jobs: started } = await build({
      adapter: store.adapter,
      config: { install: false },
    });

    expect(started.concurrent).toBe(true);

    const job = await started.perform('exclusive', { token: 'upgraded' });

    expect(job.concurrencyKey).toBe('exclusive');
    await started.store.remove({ state: 'pending' });
  }, 60000);

  test('the install may be run again and changes nothing', async () => {
    await expect(store.install()).resolves.toBeInstanceOf(Array);
    expect(await store.concurrent()).toBe(true);
  }, 60000);
});
