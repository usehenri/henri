const { randomUUID } = require('crypto');

const {
  adapterFor,
  build,
  close,
  dropIndex,
  fakeHenri,
  sharedKey,
  target,
} = require('./helpers');
const { Runner } = require('../src/runner');

/**
 * The property this column exists for, written as a test: **tenant A's
 * runner never performs, lists, retries or discards tenant B's jobs.**
 *
 * It is the queue's half of what
 * `packages/drizzle/__tests__/tenancy.spec.js` proves for the models, and
 * it is written the same way -- one list of the paths people forget rather
 * than a happy path plus edge cases. The paths here are: the stamp on the
 * enqueue, the listing, the dead letter queue's two bulk operations, the
 * scope the runner enters before `perform()`, and the batch callback,
 * which is the one row nobody is holding when it is written.
 *
 * It runs on sqlite offline and on the live PostgreSQL or MySQL of
 * `pnpm test:sql:live`, which is what `./targets.js` decides. The MongoDB
 * half is in `./mongo.spec.js`, where the rest of that backend lives.
 */

/** A henri whose tenancy module is on */
const multitenant = () =>
  fakeHenri({ settings: { tenancy: { from: { user: 'tenantId' } } } });

/** Every scope a `scope` job recorded, in the order they were entered */
const scopes = () => global.__henriJobScopes || [];

describe(`a job carries its tenant (${target.name})`, () => {
  const adapters = [];
  let henri = null;
  let jobs = null;
  let store = null;

  /**
   * Runs something as a tenant
   *
   * @param {string} tenant The tenant
   * @param {function} work What to run
   * @returns {Promise<*>} Whatever the work answered
   */
  const as = (tenant, work) => henri.tenancy.run(tenant, work);

  beforeAll(async () => {
    const adapter = await adapterFor(sharedKey('tenancy'));

    henri = multitenant();
    ({ jobs } = await build({ adapter, henri }));
    store = jobs.store;
    henri.jobs = jobs;
    adapters.push(adapter);
  }, 60000);

  afterAll(() => close(adapters));

  beforeEach(async () => {
    for (const state of ['pending', 'running', 'done', 'dead']) {
      await store.remove({ state });
    }

    for (const batch of await store.listBatches({ limit: 200 })) {
      await store.removeBatch(batch.id);
    }

    global.__henriJobScopes = [];
    global.__henriJobsRuns = [];
    global.__henriJobsCallbacks = [];
  });

  describe('the column', () => {
    test('the table has it, and the queue says so', async () => {
      expect(await store.tenanted()).toBe(true);
      expect(jobs.tenanted).toBe(true);
      expect(await store.columns()).toContain('tenant');
    });

    test('a queue with no tenancy stamps null and notices nothing', async () => {
      const plain = await build({ adapter: store.adapter });

      expect(plain.henri.tenancy.enabled).toBe(false);

      const job = await plain.jobs.perform('ok', { plain: true });

      expect(job.tenant).toBeNull();
      await store.remove({ id: job.id });
    });
  });

  describe('the stamp', () => {
    test('an enqueue inside a tenant carries it, without being asked', async () => {
      const job = await as('acme', () => jobs.perform('ok', { n: 1 }));

      expect(job.tenant).toBe('acme');
      expect((await jobs.get(job.id)).tenant).toBe('acme');
    });

    test('an enqueue outside every tenant carries none', async () => {
      const job = await jobs.perform('ok', { n: 2 });

      expect(job.tenant).toBeNull();
    });

    test('unscoped() is not a tenant either', async () => {
      const job = await henri.tenancy.unscoped(() => jobs.perform('ok'));

      expect(job.tenant).toBeNull();
    });

    test('naming a tenant wins, and naming null means no tenant', async () => {
      const named = await jobs.perform('ok', null, { tenant: 'globex' });
      const platform = await as('acme', () =>
        jobs.perform('ok', null, { tenant: null })
      );

      expect(named.tenant).toBe('globex');
      expect(platform.tenant).toBeNull();
    });

    test('naming another tenant while one is in scope is refused', async () => {
      const error = await as('acme', () =>
        jobs.perform('ok', null, { tenant: 'globex' })
      ).then(
        () => null,
        (thrown) => thrown
      );

      expect(error.code).toBe('HENRI_TENANT_CROSS_WRITE');
      expect(error.message).toContain('globex');
      expect(error.message).toContain('acme');
      // Nothing was written: the refusal is before the insert
      expect(await jobs.count()).toBe(0);
    });

    test('unscoped() is how a fan-out enqueues for every tenant', async () => {
      const made = await henri.tenancy.unscoped(async () => {
        const out = [];

        for (const tenant of ['acme', 'globex']) {
          out.push(await jobs.perform('ok', { tenant }, { tenant }));
        }

        return out;
      });

      expect(made.map((job) => job.tenant)).toEqual(['acme', 'globex']);
    });

    test('a tenant too wide for the column is refused, never truncated', async () => {
      const error = await jobs
        .perform('ok', null, { tenant: 'a'.repeat(191) })
        .then(
          () => null,
          (thrown) => thrown
        );

      expect(error.code).toBe('HENRI_TENANT_INVALID');
      expect(error.message).toContain('191');
    });
  });

  describe('reading it back', () => {
    beforeEach(async () => {
      await as('acme', () => jobs.perform('ok', { of: 'acme' }));
      await as('acme', () => jobs.perform('boom', { of: 'acme' }));
      await as('globex', () => jobs.perform('ok', { of: 'globex' }));
      await jobs.perform('ok', { of: 'nobody' });
    });

    test('a listing of one tenant is that tenant only', async () => {
      const acme = await jobs.list({ tenant: 'acme' });
      const globex = await jobs.list({ tenant: 'globex' });

      expect(acme).toHaveLength(2);
      expect(acme.every((job) => job.tenant === 'acme')).toBe(true);
      expect(globex).toHaveLength(1);
      expect(globex[0].args.of).toBe('globex');
    });

    test('a job of no tenant is nobody’s, not everybody’s', async () => {
      const acme = await jobs.list({ tenant: 'acme' });

      expect(acme.map((job) => job.args.of)).not.toContain('nobody');
      expect(await jobs.list({ limit: 50 })).toHaveLength(4);
    });

    test('a filter combines with the others rather than replacing them', async () => {
      const found = await jobs.list({ name: 'ok', tenant: 'acme' });

      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('ok');
    });
  });

  describe('the dead letter queue', () => {
    /**
     * Buries one job of a tenant
     *
     * @param {string} tenant The tenant
     * @returns {Promise<object>} The dead job
     */
    const bury = async (tenant) => {
      const job = await henri.tenancy.run(tenant, () =>
        jobs.perform('boom', { tenant }, { maxAttempts: 1 })
      );

      await new Runner(jobs, { recurring: false }).once();

      return jobs.get(job.id);
    };

    test('a retry of one tenant leaves the other buried', async () => {
      const acme = await bury('acme');
      const globex = await bury('globex');

      expect(acme.state).toBe('dead');
      expect(globex.state).toBe('dead');

      const requeued = await jobs.dead.retryAll({ tenant: 'acme' });

      expect(requeued).toBe(1);
      expect((await jobs.get(acme.id)).state).toBe('pending');
      expect((await jobs.get(globex.id)).state).toBe('dead');
    });

    test('a discard of one tenant leaves the other in the table', async () => {
      const acme = await bury('acme');
      const globex = await bury('globex');
      const discarded = await jobs.dead.discardAll({ tenant: 'acme' });

      expect(discarded).toBe(1);
      expect(await jobs.get(acme.id)).toBeNull();
      expect(await jobs.get(globex.id)).not.toBeNull();
    });
  });

  describe('what the runner does with it', () => {
    test('it enters the tenant the row names before perform()', async () => {
      await as('acme', () => jobs.perform('scope', { token: 'a' }));
      await new Runner(jobs, { recurring: false }).once();

      expect(scopes()).toEqual([{ row: 'acme', scope: 'acme', token: 'a' }]);
    });

    test('a row with no tenant enters none: null is not every tenant', async () => {
      await jobs.perform('scope', { token: 'none' });
      await new Runner(jobs, { recurring: false }).once();

      expect(scopes()).toEqual([{ row: null, scope: null, token: 'none' }]);
    });

    test('two tenants performed at once never see each other', async () => {
      // The attempts overlap on purpose: an async context is what makes
      // this right, and a field on the runner would not be
      await as('acme', () => jobs.perform('scope', { token: 'a', wait: 40 }));
      await as('globex', () => jobs.perform('scope', { token: 'b', wait: 40 }));

      await new Runner(jobs, { concurrency: 2, recurring: false }).once();

      const seen = scopes().sort((left, right) =>
        left.token < right.token ? -1 : 1
      );

      expect(seen).toEqual([
        { row: 'acme', scope: 'acme', token: 'a' },
        { row: 'globex', scope: 'globex', token: 'b' },
      ]);
    });

    test('the scope is closed again by the time the next job runs', async () => {
      await as('acme', () => jobs.perform('scope', { token: 'a' }));
      await new Runner(jobs, { recurring: false }).once();

      expect(henri.tenancy.current()).toBeNull();
    });
  });

  describe('a batch', () => {
    test('its callback is performed in the tenant that made it', async () => {
      const batch = await as('acme', () =>
        jobs.batch({
          callback: 'scope',
          jobs: [['ok', { of: 'acme' }]],
        })
      );

      const [member] = await jobs.batches.jobs(batch.id);

      expect(member.tenant).toBe('acme');

      // The runner performs the member, settles the batch and enqueues the
      // callback -- all of it outside every tenant, which is exactly the
      // case the tenant on the batch exists for
      await new Runner(jobs, { recurring: false }).once();

      const [callback] = await jobs.list({ name: 'scope' });

      expect(callback.tenant).toBe('acme');

      await new Runner(jobs, { recurring: false }).once();

      expect(scopes()).toEqual([{ row: 'acme', scope: 'acme', token: null }]);
    }, 60000);
  });
});

describe(`upgrading a queue that has no tenant column (${target.name})`, () => {
  const adapters = [];
  let henri = null;
  let jobs = null;
  let store = null;

  /**
   * Takes the store back to what a henri without the column wrote
   *
   * @returns {Promise<void>} Resolves when the column is gone
   */
  const downgrade = async () => {
    const table = jobs.config.tables.jobs;

    await dropIndex(store, table, `${table}_tenant`);
    await store.run(`ALTER TABLE ${table} DROP COLUMN tenant`);
    store.tenants = null;
    jobs.tenanted = await store.tenanted();
  };

  beforeAll(async () => {
    const adapter = await adapterFor(sharedKey('tenant-upgrade'));

    henri = fakeHenri();
    ({ jobs } = await build({ adapter, henri }));
    store = jobs.store;
    adapters.push(adapter);
    await downgrade();
  }, 60000);

  afterAll(() => close(adapters));

  test('the queue works exactly as it did without it', async () => {
    expect(await store.tenanted()).toBe(false);

    // The insert names the columns that are there, so an application that
    // is not multi-tenant does not notice
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
    expect(job.tenant).toBeNull();
    await store.remove({ state: 'running' });
  });

  test('a listing by tenant is refused rather than answered wrong', async () => {
    const error = await jobs.list({ tenant: 'acme' }).then(
      () => null,
      (thrown) => thrown
    );

    expect(error.code).toBe('HENRI_JOB_TENANT_UNINSTALLED');
    expect(error.hint).toContain('henri jobs:install');
  });

  test('a multi-tenant application fails the boot naming the column', async () => {
    const error = await build({
      adapter: store.adapter,
      config: { install: false },
      henri: fakeHenri({
        settings: { tenancy: { from: { user: 'tenantId' } } },
      }),
    }).then(
      () => null,
      (thrown) => thrown
    );

    expect(error.code).toBe('HENRI_JOB_TENANT_UNINSTALLED');
    expect(error.message).toContain('config.tenancy');
    expect(error.message).toContain('tenant column');
    expect(error.hint).toContain('henri jobs:install');
  }, 60000);

  test('the install adds it, and the tenant is carried from then on', async () => {
    const statements = await store.install();

    expect(statements.join(';')).toContain('tenant');
    store.tenants = null;
    expect(await store.tenanted()).toBe(true);

    const upgraded = await build({
      adapter: store.adapter,
      config: { install: false },
      henri: multitenant(),
    });

    expect(upgraded.jobs.tenanted).toBe(true);

    const job = await upgraded.henri.tenancy.run('acme', () =>
      upgraded.jobs.perform('ok', { upgraded: true })
    );

    expect(job.tenant).toBe('acme');
    await store.remove({ state: 'pending' });
  }, 60000);
});
