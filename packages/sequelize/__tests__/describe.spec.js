const { build, taskModel, userModel } = require('./helpers');
const target = require('./targets');

// The fields that read back differently than they were written, which is
// the point of asking the database instead of the model file: a uuid is
// CHAR(36) on MySQL, an enum is a type of its own on PostgreSQL, and
// `externalId` is `external_id` everywhere.
const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  schema: {
    kind: { enum: ['credit', 'debit'], type: 'string' },
    reference: { type: 'string', unique: true },
    total: { required: true, type: 'integer' },
  },
  store: 'default',
};

/**
 * An adapter with the three models, started (so the schema exists)
 *
 * @returns {Promise<object>} The adapter and its fake henri
 */
const started = async () => {
  const { adapter, henri } = build({ baseRole: 'user' });

  adapter.addModel(taskModel, 'user');
  adapter.addModel(userModel, 'user');
  adapter.addModel(invoiceModel, 'user');
  await adapter.start();

  return { adapter, henri };
};

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
 * One column of a table
 *
 * @param {object} table One table of a report
 * @param {string} name The column name
 * @returns {?object} The column
 */
const column = (table, name) =>
  table.columns.find((entry) => entry.name === name) || null;

describe('describe: what the database holds', () => {
  let adapter;

  beforeAll(async () => {
    ({ adapter } = await started());
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
    await target.cleanup();
  }, 30000);

  test('answers every model with the table it really lives in', async () => {
    const report = await adapter.describe();

    expect(report).toMatchObject({
      adapter: adapter.adapterName,
      enforced: true,
      kind: 'sql',
      read: 'database',
      store: 'default',
    });
    expect(report.tables.map((table) => table.model).sort()).toEqual([
      'Invoice',
      'Task',
      'User',
    ]);
    expect(of(report, 'Task').exists).toBe(true);
    expect(of(report, 'Task').table).toBe(
      String(adapter.models.Task.getTableName())
    );
  });

  test('reads the columns from the database, not from the model file', async () => {
    const report = await adapter.describe();
    const tasks = of(report, 'Task');
    const names = tasks.columns.map((entry) => entry.name);

    // The rename a reader of app/models cannot know about
    expect(names).toContain('external_id');
    expect(names).not.toContain('externalId');
    expect(column(tasks, 'external_id').attribute).toBe('externalId');
    expect(column(tasks, 'name').nullable).toBe(false);
    expect(column(tasks, 'id').primaryKey).toBe(true);
  });

  test('names the values of an enum however the dialect spells them', async () => {
    const report = await adapter.describe();
    const kind = column(of(report, 'Invoice'), 'kind');
    // PostgreSQL keeps the values beside the type and MySQL inside it, and
    // both answer the same list here; sqlite has no enum at all, so
    // Sequelize writes TEXT and there is nothing to read back
    const expected =
      adapter.ensureConnector().getDialect() === 'sqlite'
        ? null
        : ['credit', 'debit'];

    expect(kind.values).toEqual(expected);
  });

  test('answers the indexes the database really carries', async () => {
    const report = await adapter.describe();
    const invoices = of(report, 'Invoice');

    expect(invoices.indexes.length).toBeGreaterThan(0);
    expect(
      invoices.indexes.some(
        (index) => index.unique && index.columns.includes('reference')
      )
    ).toBe(true);
  });

  test('says a table is missing rather than inventing its columns', async () => {
    const { Invoice } = adapter.getModels();
    const sequelize = adapter.ensureConnector();
    const table = sequelize
      .getQueryInterface()
      .queryGenerator.quoteTable(Invoice.getTableName());

    await sequelize.query(`DROP TABLE ${table}`);

    const report = await adapter.describe();

    expect(of(report, 'Invoice')).toMatchObject({
      columns: [],
      exists: false,
      indexes: [],
    });

    // Put it back for whatever runs next in this file, and let drift() --
    // the other question, asked of the same database and never derived
    // from this one -- agree that it is there
    await Invoice.sync();
    expect(
      (await adapter.drift()).differences.filter(
        (difference) => difference.kind === 'table-missing'
      )
    ).toEqual([]);
    expect(
      (await adapter.describe()).tables.every((entry) => entry.exists)
    ).toBe(true);
  }, 30000);
});
