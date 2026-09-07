const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenancy = require('@usehenri/core/src/0.tenancy');
const Mongoose = require('../index');

/**
 * The same property the drizzle suite proves, against a real MongoDB:
 * **tenant A cannot read or write tenant B's documents.**
 *
 * Two things are different here and both are on purpose. The condition is
 * added by query middleware rather than by a compiled `where`, so the paths
 * that carry no middleware are the ones worth asserting -- `aggregate` and
 * `bulkWrite` are refused rather than answered, which is the honest thing
 * to do about an operation henri cannot narrow. And a soft delete on this
 * adapter is an `updateMany` in disguise (`plugins.js`, `soften()`), so it
 * re-enters the same hook and is scoped by the same condition.
 */

let mongod;

const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  name: 'invoices',
  options: { paranoid: true, tenant: true, timestamps: true },
  schema: {
    amount: { default: 0, type: 'number' },
    reference: { required: true, type: 'string' },
  },
};

// No `required` and no `enum`, so no validations plugin is registered on it:
// the bulk-write refusal below is then this feature's and not that one's
const noteModel = {
  globalId: 'Note',
  identity: 'note',
  name: 'notes',
  options: { tenant: true, timestamps: true },
  schema: { body: { type: 'string' } },
};

const planModel = {
  globalId: 'Plan',
  identity: 'plan',
  name: 'plans',
  options: { timestamps: true },
  schema: { name: { type: 'string' } },
};

/**
 * Builds a minimal henri stand-in carrying the real tenancy module
 *
 * @param {object} [settings={}] configuration values
 * @returns {object} the fake henri
 */
const fakeHenri = (settings = {}) => {
  const calls = [];
  const pen = {};

  ['error', 'fatal', 'info', 'warn'].forEach((level) => {
    pen[level] = (...args) => calls.push([level, ...args]);
  });

  const henri = {
    _user: null,
    calls,
    config: {
      get: (key) => settings[key],
      has: (key) => typeof settings[key] !== 'undefined',
    },
    isTest: true,
    pen,
    user: { encrypt: async (password) => `hashed:${password}` },
  };

  // The real module: what a tenanted model is scoped by is core's decision
  const tenancy = new Tenancy();

  tenancy.henri = henri;
  tenancy.init();
  henri.tenancy = tenancy;

  return henri;
};

describe('multi-tenancy on MongoDB', () => {
  let adapter;
  let henri;
  let Invoice;
  let Note;
  let Plan;

  /**
   * Runs something as a tenant
   *
   * @param {string} tenant The tenant
   * @param {function} work What to run
   * @returns {Promise<*>} Whatever the work answered
   */
  const as = (tenant, work) => henri.tenancy.run(tenant, work);

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    henri = fakeHenri({ tenancy: { from: { user: 'tenantId' } } });
    adapter = new Mongoose('default', { url: mongod.getUri('tenancy') }, henri);

    Invoice = adapter.addModel(invoiceModel, 'user');
    Note = adapter.addModel(noteModel, 'user');
    Plan = adapter.addModel(planModel, 'user');

    await adapter.start();
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
    await mongod.stop();
  });

  beforeEach(async () => {
    await henri.tenancy.unscoped(async () => {
      await Invoice.deleteMany({}, { force: true });
      await Note.deleteMany({});
      await Plan.deleteMany({});
    });
  });

  test('a marked model gets the path, a shared one does not', () => {
    expect(Invoice.schema.path('tenantId')).toBeDefined();
    expect(Plan.schema.path('tenantId')).toBeUndefined();
  });

  test('a create is stamped, and a read answers one tenant', async () => {
    const mine = await as('acme', () =>
      Invoice.create({ amount: 10, reference: 'a-1' })
    );

    await as('globex', () => Invoice.create({ amount: 20, reference: 'b-1' }));

    expect(mine.tenantId).toBe('acme');
    expect(await as('acme', () => Invoice.countDocuments())).toBe(1);
    expect(
      (await as('acme', () => Invoice.find())).map((row) => row.reference)
    ).toEqual(['a-1']);
    expect(await as('acme', () => Invoice.findOne({ reference: 'b-1' }))).toBe(
      null
    );
  });

  test('findById answers null for another tenant, not the document', async () => {
    const theirs = await as('globex', () =>
      Invoice.create({ reference: 'b-1' })
    );

    expect(await as('acme', () => Invoice.findById(theirs.externalId))).toBe(
      null
    );
    expect(
      await as('globex', () => Invoice.findById(theirs.externalId))
    ).not.toBeNull();
  });

  test('paginate lists and counts the same tenant', async () => {
    await as('acme', () => Invoice.create({ reference: 'a-1' }));
    await as('acme', () => Invoice.create({ reference: 'a-2' }));
    await as('globex', () => Invoice.create({ reference: 'b-1' }));

    const page = await as('acme', () => Invoice.paginate({ perPage: 10 }));

    expect(page.total).toBe(2);
    expect(page.records).toHaveLength(2);
  });

  test('a mass update and a mass delete reach only this tenant', async () => {
    await as('acme', () => Invoice.create({ amount: 1, reference: 'a-1' }));
    await as('globex', () => Invoice.create({ amount: 1, reference: 'b-1' }));

    await as('acme', () => Invoice.updateMany({}, { $set: { amount: 99 } }));

    expect(
      (await as('globex', () => Invoice.findOne({ reference: 'b-1' }))).amount
    ).toBe(1);

    await as('acme', () => Invoice.deleteMany({}));

    expect(await as('globex', () => Invoice.countDocuments())).toBe(1);
    expect(await as('acme', () => Invoice.countDocuments())).toBe(0);
  });

  test('a soft delete is an update in disguise and is scoped too', async () => {
    const theirs = await as('globex', () =>
      Invoice.create({ reference: 'b-1' })
    );

    await as('acme', () => Invoice.deleteMany({ _id: theirs._id }));

    expect(await as('globex', () => Invoice.countDocuments())).toBe(1);
  });

  test('a write naming another tenant is refused', async () => {
    await expect(
      as('acme', () => Invoice.create({ reference: 'a-1', tenantId: 'globex' }))
    ).rejects.toMatchObject({ code: 'HENRI_TENANT_CROSS_WRITE' });

    await as('acme', () => Invoice.create({ reference: 'a-2' }));

    await expect(
      as('acme', () => Invoice.updateMany({}, { $set: { tenantId: 'globex' } }))
    ).rejects.toMatchObject({ code: 'HENRI_TENANT_CROSS_WRITE' });
  });

  test('insertMany stamps every document', async () => {
    await as('acme', () =>
      Invoice.insertMany([{ reference: 'a-1' }, { reference: 'a-2' }])
    );

    expect(await as('acme', () => Invoice.countDocuments())).toBe(2);
    expect(await as('globex', () => Invoice.countDocuments())).toBe(0);
  });

  test('with no tenant, a read and a write are refused', async () => {
    await as('acme', () => Invoice.create({ reference: 'a-1' }));

    await expect(Invoice.find()).rejects.toMatchObject({
      code: 'HENRI_TENANT_REQUIRED',
    });
    await expect(Invoice.countDocuments()).rejects.toMatchObject({
      code: 'HENRI_TENANT_REQUIRED',
    });
    await expect(Invoice.create({ reference: 'x' })).rejects.toMatchObject({
      code: 'HENRI_TENANT_REQUIRED',
    });
  });

  test('what henri cannot narrow is refused rather than answered', async () => {
    await as('acme', () => Invoice.create({ reference: 'a-1' }));
    await as('globex', () => Invoice.create({ reference: 'b-1' }));

    await expect(
      as('acme', () => Invoice.aggregate([{ $group: { _id: null } }]))
    ).rejects.toMatchObject({ code: 'HENRI_TENANT_UNSCOPABLE' });

    await expect(
      as('acme', () =>
        Note.bulkWrite([
          { updateOne: { filter: {}, update: { $set: { body: 'x' } } } },
        ])
      )
    ).rejects.toMatchObject({ code: 'HENRI_TENANT_UNSCOPABLE' });

    // And `unscoped()` is how a report says it means every tenant
    const counted = await henri.tenancy.unscoped(() =>
      Invoice.aggregate([{ $group: { _id: null, rows: { $sum: 1 } } }])
    );

    expect(counted[0].rows).toBe(2);
  });

  test('a shared model is untouched by any of it', async () => {
    await Plan.create({ name: 'free' });

    expect(await Plan.countDocuments()).toBe(1);
    expect(await as('acme', () => Plan.countDocuments())).toBe(1);
  });

  test('a job that carries its tenant reads exactly that tenant', async () => {
    await as('acme', () => Invoice.create({ reference: 'a-1' }));
    await as('globex', () => Invoice.create({ reference: 'b-1' }));

    const performed = await henri.tenancy.run('globex', async () =>
      (await Invoice.find()).map((row) => row.reference)
    );

    expect(performed).toEqual(['b-1']);
  });
});
