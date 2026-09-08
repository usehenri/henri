const { MongoMemoryServer } = require('mongodb-memory-server');
const Mongoose = require('../index');

// What MongoDB can honestly answer about a schema it does not have: the
// collections and the indexes are the server's, the fields are henri's
// declaration, and the answer says which is which.

const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  options: { timestamps: false },
  schema: {
    kind: { enum: ['credit', 'debit'], type: 'string' },
    reference: { type: 'string', unique: true },
    total: { required: true, type: 'number' },
  },
};

const draftModel = {
  globalId: 'Draft',
  identity: 'draft',
  options: { externalId: false, timestamps: false },
  schema: { body: { type: 'string' } },
};

/**
 * A minimal henri stand-in
 *
 * @returns {object} fake henri
 */
const fakeHenri = () => ({
  _user: null,
  config: { get: () => undefined, has: () => false },
  isTest: true,
  pen: { error() {}, fatal() {}, info() {}, warn() {} },
  user: { encrypt: async (password) => `hashed:${password}` },
});

/**
 * One table of a report
 *
 * @param {object} report What describe() answered
 * @param {string} model The model name
 * @returns {?object} The table
 */
const of = (report, model) =>
  report.tables.find((table) => table.model === model) || null;

/**
 * One field of a table
 *
 * @param {object} table One table of a report
 * @param {string} name The field name
 * @returns {?object} The field
 */
const field = (table, name) =>
  table.columns.find((entry) => entry.name === name) || null;

describe('what a mongoose store can honestly say about a schema', () => {
  let mongod;
  let adapter;
  let Invoice;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    adapter = new Mongoose(
      'default',
      { url: mongod.getUri('describe') },
      fakeHenri()
    );
    Invoice = adapter.addModel(invoiceModel, 'user');
    adapter.addModel(draftModel, 'user');
    await adapter.start();
    // A collection MongoDB has never been asked to write does not exist
    await Invoice.create({ kind: 'credit', reference: 'a', total: 1 });
  }, 120000);

  afterAll(async () => {
    await adapter.stop();
    await mongod.stop();
  }, 30000);

  test('says out loud that the fields are a declaration and not a schema', async () => {
    const report = await adapter.describe();

    expect(report).toMatchObject({
      adapter: 'mongoose',
      dialect: null,
      // The two that keep this answer honest: nothing here was read back
      // out of the documents, and MongoDB holds none of them to it
      enforced: false,
      kind: 'document',
      read: 'models',
      store: 'default',
    });
    expect(report.note).toContain('MongoDB enforces no schema');
  });

  test('answers the collection each model really writes to', async () => {
    const report = await adapter.describe();

    expect(report.tables.map((table) => table.model).sort()).toEqual([
      'Draft',
      'Invoice',
    ]);
    expect(of(report, 'Invoice').table).toBe('invoices');
    // Read from the server rather than assumed, though on MongoDB it says
    // true for almost everything: Mongoose builds a model's indexes at
    // boot and that is what creates the collection
    expect(of(report, 'Invoice').exists).toBe(true);
    expect(of(report, 'Draft').table).toBe('drafts');
  });

  test('answers the fields Mongoose applies, with their types', async () => {
    const report = await adapter.describe();
    const invoices = of(report, 'Invoice');

    expect(field(invoices, '_id').primaryKey).toBe(true);
    expect(field(invoices, 'total')).toMatchObject({
      attribute: 'total',
      nullable: false,
      type: 'Number',
    });
    expect(field(invoices, 'kind').values).toEqual(['credit', 'debit']);
    expect(field(invoices, 'externalId').type).toBe('String');
  });

  test('reads the indexes back from the server, which are real', async () => {
    const report = await adapter.describe();
    const invoices = of(report, 'Invoice');

    expect(invoices.indexes.some((index) => index.primary)).toBe(true);
    expect(
      invoices.indexes.some(
        (index) => index.unique && index.columns.includes('reference')
      )
    ).toBe(true);
    // Nothing declared an index on Draft: what comes back is the one
    // MongoDB made itself, which is exactly the point of asking the server
    expect(of(report, 'Draft').indexes).toEqual([
      { columns: ['_id'], name: '_id_', primary: true, unique: false },
    ]);
  });

  test('names the collections no model claims', async () => {
    await adapter.mongoose.connection.db.collection('leftovers').insertOne({
      whatever: true,
    });

    const report = await adapter.describe();

    expect(report.unclaimed).toContain('leftovers');
    expect(report.tables.map((table) => table.table)).not.toContain(
      'leftovers'
    );
  });
});
