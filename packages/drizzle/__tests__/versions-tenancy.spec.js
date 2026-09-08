// Model versioning across tenants, against a real store.
//
// `henri_versions` holds the old values of records that belong to tenants,
// and one table holds all of them -- so the property to write down is the
// same negative one the model suite proves: **tenant A cannot read one of
// tenant B's versions, and cannot write one back.** The reading half is a
// condition; the writing half is a refusal, because a restore of a record
// that is gone *creates* it, and a create is stamped with the tenant in
// scope.
//
// It runs on sqlite offline and on the live PostgreSQL or MySQL of
// `pnpm test:sql:live`, which is what `./targets.js` decides.
const Versions = require('@usehenri/core/src/4.versions');

const { SqlVersions } = require('@usehenri/core/src/base/version-store');
const { buildWith, fakeHenri, target } = require('./helpers');

const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  options: { paranoid: true, tenant: true, timestamps: true, versioned: true },
  schema: {
    amount: { default: 0, type: 'integer' },
    reference: { required: true, type: 'string' },
  },
  store: 'default',
};

// Shared on purpose: a `Plan` belongs to nobody, and its history has to
// stay readable from inside every tenant
const planModel = {
  globalId: 'Plan',
  identity: 'plan',
  options: { timestamps: true, versioned: true },
  schema: { name: { type: 'string' } },
  store: 'default',
};

/**
 * A henri carrying both modules, on an adapter of its own
 *
 * @param {object} [settings={}] What the configuration says
 * @returns {Promise<object>} `{ adapter, henri, models, versions }`
 */
const application = async (settings = {}) => {
  const henri = fakeHenri({
    tenancy: { from: { user: 'tenantId' } },
    versions: { keep: '30d' },
    ...settings,
  });

  await henri.encryption.init();

  const { adapter } = buildWith(henri, {}, settings.key);

  [invoiceModel, planModel].forEach((model) => adapter.addModel(model, 'user'));
  await adapter.start();

  henri.model = {
    models: [invoiceModel, planModel],
    stores: { default: adapter },
  };
  henri.privacy = { modelOf: (name) => adapter.getModels()[name] || null };

  const versions = new Versions();

  versions.henri = henri;
  henri.versions = versions;
  await versions.init();

  return { adapter, henri, models: adapter.getModels(), versions };
};

describe(`versions across tenants (${target.name})`, () => {
  let adapter = null;
  let henri = null;
  let versions = null;
  let Invoice = null;
  let Plan = null;

  /**
   * Runs something as a tenant
   *
   * @param {string} tenant The tenant
   * @param {function} work What to run
   * @returns {Promise<*>} Whatever the work answered
   */
  const as = (tenant, work) => henri.tenancy.run(tenant, work);

  /**
   * Runs something across every tenant
   *
   * @param {function} work What to run
   * @returns {Promise<*>} Whatever the work answered
   */
  const all = (work) => henri.tenancy.unscoped(work);

  beforeAll(async () => {
    ({ adapter, henri, versions } = await application({ key: 'ver-tenancy' }));
    ({ Invoice, Plan } = adapter.getModels());
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  beforeEach(async () => {
    await all(async () => {
      await Invoice.withDeleted()
        .where({})
        .destroy({ force: true, versions: false });
      await Plan.where({}).destroy({ force: true, versions: false });
    });
    await adapter.query(`DELETE FROM ${versions.settings.table}`);
  });

  describe('the column', () => {
    test('the table has it, and the store says so', async () => {
      const store = await versions.ready();

      expect(await store.tenanted()).toBe(true);
    });

    test('a version names the tenant of the record it is about', async () => {
      const invoice = await as('acme', () =>
        Invoice.create({ amount: 10, reference: 'A-1' })
      );
      const [version] = await as('acme', () => versions.of(invoice));

      expect(version.tenant).toBe('acme');
      expect(version.model).toBe('Invoice');
    });

    test('a shared model names none, and that is not a bug', async () => {
      const plan = await Plan.create({ name: 'Pro' });
      const [version] = await all(() => versions.of(plan));

      expect(version.tenant).toBeNull();
    });

    test('the record decides, not the scope: a sweep still names it right', async () => {
      const invoice = await as('acme', () =>
        Invoice.create({ amount: 10, reference: 'A-2' })
      );

      // What `henri.retention` and `henri.privacy` do: walk every tenant
      // and write. The version still says whose record it was
      await all(() => invoice.update({ amount: 20 }));

      const [latest] = await all(() =>
        versions.of(invoice, { event: 'update' })
      );

      expect(latest.tenant).toBe('acme');
    });
  });

  describe('reading it back', () => {
    let mine = null;
    let theirs = null;
    let plan = null;

    beforeEach(async () => {
      mine = await as('acme', () =>
        Invoice.create({ amount: 1, reference: 'ACME-1' })
      );
      theirs = await as('globex', () =>
        Invoice.create({ amount: 2, reference: 'GLOBEX-1' })
      );
      plan = await Plan.create({ name: 'Pro' });
    });

    test('a listing inside a tenant never carries another tenant’s row', async () => {
      const found = await as('acme', () => versions.list({ limit: 50 }));
      const records = found.map((version) => version.record);

      expect(records).toContain(mine.externalId);
      expect(records).not.toContain(theirs.externalId);
      // The shared model comes with it: its history belongs to everybody
      expect(records).toContain(plan.externalId);
    });

    test('a count is narrowed the same way a list is', async () => {
      expect(await as('acme', () => versions.count({ model: 'Invoice' }))).toBe(
        1
      );
      expect(await all(() => versions.count({ model: 'Invoice' }))).toBe(2);
    });

    test('asking for another tenant’s record by id answers nothing', async () => {
      const found = await as('acme', () =>
        versions.of({ model: 'Invoice', record: theirs.externalId })
      );

      expect(found).toEqual([]);
    });

    test('one version of another tenant is null, not a refusal', async () => {
      const [target_] = await all(() =>
        versions.of({ model: 'Invoice', record: theirs.externalId })
      );

      expect(await as('globex', () => versions.get(target_.id))).not.toBeNull();
      // `Model.findById()`'s own answer: not there. A message saying "it is
      // there but not yours" is the oracle the 404 exists to close
      expect(await as('acme', () => versions.get(target_.id))).toBeNull();
    });

    test('with tenancy on and no tenant in scope, a read is refused', async () => {
      const error = await versions.list({ limit: 10 }).then(
        () => null,
        (thrown) => thrown
      );

      expect(error.code).toBe('HENRI_TENANT_REQUIRED');
      expect(error.message).toContain('henri.tenancy.unscoped');
    });

    test('unscoped() is the way an operator reads every tenant', async () => {
      const found = await all(() => versions.list({ limit: 50 }));

      expect(found.length).toBeGreaterThanOrEqual(3);
    });

    test('a caller cannot widen it by asking for another tenant', async () => {
      const found = await as('acme', () =>
        versions.list({ limit: 50, tenant: 'globex' })
      );

      expect(found.map((version) => version.record)).not.toContain(
        theirs.externalId
      );
    });
  });

  describe('reconstructing and writing back', () => {
    test('a restore of one’s own record still works, and is a version too', async () => {
      const invoice = await as('acme', () =>
        Invoice.create({ amount: 5, reference: 'A-3' })
      );

      await as('acme', () => invoice.update({ amount: 500 }));

      const [created] = await as('acme', () =>
        versions.of(invoice, { event: 'create' })
      );
      const done = await as('acme', () => versions.restore(created.id));

      expect(done.created).toBe(false);
      expect(done.record.amount).toBe(5);
    });

    test('a destroyed record comes back in the tenant it belonged to', async () => {
      const invoice = await as('globex', () =>
        Invoice.create({ amount: 7, reference: 'G-1' })
      );
      const external = invoice.externalId;

      await as('globex', () => invoice.destroy({ force: true }));

      const [destroyed] = await all(() =>
        versions.of(
          { model: 'Invoice', record: external },
          { event: 'destroy' }
        )
      );
      const done = await as('globex', () => versions.restore(destroyed.id));

      expect(done.created).toBe(true);

      const back = await as('globex', () => Invoice.findById(external));

      expect(back.reference).toBe('G-1');
      expect(back.tenantId).toBe('globex');
      // And it is not visible from the other tenant, which is the point
      expect(await as('acme', () => Invoice.findById(external))).toBeNull();
    });

    test('another tenant cannot restore it here, even knowing the id', async () => {
      const invoice = await as('globex', () =>
        Invoice.create({ amount: 7, reference: 'G-2' })
      );
      const external = invoice.externalId;

      await as('globex', () => invoice.destroy({ force: true }));

      const [destroyed] = await all(() =>
        versions.of(
          { model: 'Invoice', record: external },
          { event: 'destroy' }
        )
      );

      // Reading it as acme answers nothing at all, so a restore by id gets
      // the unknown-version refusal before it gets anywhere near a write
      const byId = await as('acme', () => versions.restore(destroyed.id)).then(
        () => null,
        (thrown) => thrown
      );

      expect(byId.code).toBe('HENRI_VERSION_UNKNOWN');

      // And with the row in hand -- which is what an operator script does
      // after an `unscoped()` listing -- the write itself is what refuses
      const withRow = await as('acme', () => versions.restore(destroyed)).then(
        () => null,
        (thrown) => thrown
      );

      expect(withRow.code).toBe('HENRI_VERSION_CROSS_TENANT');
      expect(withRow.message).toContain('globex');
      expect(await as('acme', () => Invoice.findById(external))).toBeNull();
    });

    test('a version that predates the column is refused rather than guessed', async () => {
      const invoice = await as('acme', () =>
        Invoice.create({ amount: 9, reference: 'A-4' })
      );
      const external = invoice.externalId;

      await as('acme', () => invoice.destroy({ force: true }));

      const [destroyed] = await all(() =>
        versions.of(
          { model: 'Invoice', record: external },
          { event: 'destroy' }
        )
      );

      // What an upgrade leaves behind: rows the column arrived after.
      // No placeholder: `adapter.query()` is raw SQL and every dialect
      // numbers its own, and an externalId is a uuid henri just made
      await adapter.query(
        `UPDATE ${versions.settings.table} SET tenant = NULL WHERE record = '${external}'`
      );

      const row = await all(() => versions.get(destroyed.id));

      expect(row.tenant).toBeNull();

      // It is still readable -- a null row is nobody's, and hiding it from
      // everybody would be worse -- but it will not be written back on a
      // guess about whose it was
      expect(await as('acme', () => versions.get(destroyed.id))).not.toBeNull();

      const error = await as('acme', () => versions.restore(row)).then(
        () => null,
        (thrown) => thrown
      );

      expect(error.code).toBe('HENRI_VERSION_CROSS_TENANT');
      expect(error.message).toContain('names no tenant');
    });

    test('unscoped() is how a record is deliberately moved back', async () => {
      const invoice = await as('globex', () =>
        Invoice.create({ amount: 3, reference: 'G-3' })
      );
      const external = invoice.externalId;

      await as('globex', () => invoice.destroy({ force: true }));

      const [destroyed] = await all(() =>
        versions.of(
          { model: 'Invoice', record: external },
          { event: 'destroy' }
        )
      );
      const done = await all(() => versions.restore(destroyed.id));

      expect(done.created).toBe(true);
      expect(await all(() => Invoice.findById(external))).not.toBeNull();
    });
  });
});

describe(`upgrading a version table with no tenant column (${target.name})`, () => {
  let adapter = null;
  let henri = null;
  let versions = null;
  let table = null;

  /**
   * Whether the live table has the column right now
   *
   * @returns {Promise<boolean>} yes or no
   */
  const hasColumn = () =>
    adapter.query(`SELECT tenant FROM ${table} WHERE 1 = 0`).then(
      () => true,
      () => false
    );

  /**
   * Takes the table back to what a henri without the column wrote
   *
   * @returns {Promise<void>} Resolves when the column is gone
   */
  const downgrade = async () => {
    await adapter
      .query(`DROP INDEX IF EXISTS ${table}_tenant`)
      .catch(() => null);
    await adapter.query(`ALTER TABLE ${table} DROP COLUMN tenant`);
  };

  beforeAll(async () => {
    ({ adapter, henri, versions } = await application({ key: 'ver-upgrade' }));
    table = versions.settings.table;
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a boot whose user may ALTER adds the column itself', async () => {
    await downgrade();
    expect(await hasColumn()).toBe(false);

    // `ready()` installs, and the install carries the tolerated upgrade
    // block: for most people the upgrade is the next deploy and nothing
    // else. The refusals below are for the installation where it is not
    const fresh = new Versions();

    fresh.henri = henri;
    await fresh.init();

    expect(await hasColumn()).toBe(true);
    expect(await (await fresh.ready()).tenanted()).toBe(true);
  }, 60000);

  test('a table that cannot hold it fails the boot naming it', async () => {
    // What decides is asking the table, never whether the `ALTER` ran --
    // so a database user who may not alter one is exactly this: the
    // statement was tolerated, and the column is still not there
    vi.spyOn(SqlVersions.prototype, 'tenanted').mockResolvedValue(false);

    const fresh = new Versions();

    fresh.henri = henri;

    const error = await fresh.init().then(
      () => null,
      (thrown) => thrown
    );

    expect(error.code).toBe('HENRI_VERSION_TENANT_UNINSTALLED');
    expect(error.message).toContain('config.tenancy');
    expect(error.hint).toContain('ADD COLUMN tenant');
  }, 60000);

  test('an application that is not multi-tenant notices nothing', async () => {
    vi.spyOn(SqlVersions.prototype, 'tenanted').mockResolvedValue(false);

    const plain = new Versions();

    plain.henri = { ...henri, tenancy: { enabled: false } };
    await plain.init();

    expect(plain.enabled).toBe(true);

    const { Plan } = adapter.getModels();
    const plan = await henri.tenancy.unscoped(() =>
      Plan.create({ name: 'Basic' })
    );

    // The insert names the columns that are there, so the history of an
    // application that never asked for any of this is written as it was
    const [version] = await plain.of(plan);

    expect(version.model).toBe('Plan');
    expect(version.tenant).toBeNull();
  }, 60000);

  test('the rows the upgrade left behind read from every tenant', async () => {
    const { Invoice } = adapter.getModels();
    const invoice = await henri.tenancy.run('acme', () =>
      Invoice.create({ amount: 1, reference: 'UP-1' })
    );

    await adapter.query(`UPDATE ${table} SET tenant = NULL`);

    // Null is not "acme" and it is not "globex": it is nobody's, which is
    // what a shared model looks like too. Hiding those rows from everybody
    // would lose a shared model's history, so a scoped read takes them
    const seen = await henri.tenancy.run('globex', () =>
      versions.list({ limit: 50 })
    );

    expect(seen.map((version) => version.record)).toContain(invoice.externalId);
  }, 60000);
});
