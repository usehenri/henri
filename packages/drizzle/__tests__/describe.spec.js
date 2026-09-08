const { build, target, taskModel, userModel } = require('./helpers');

// A model whose table and columns are not what the model file calls them,
// which is the whole reason a schema is read from the database: nothing in
// `app/models` knows that `Task.category` is `category` and `externalId` is
// `external_id`.
const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  options: { timestamps: false },
  schema: {
    kind: { enum: ['credit', 'debit'], type: 'string' },
    reference: { type: 'string', unique: true },
    total: { required: true, type: 'integer' },
  },
  store: 'default',
};

/**
 * An adapter with the three models, started and pushed
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
      dialect: adapter.dialect.name,
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
    expect(of(report, 'Task').table).toBe('tasks');
    expect(of(report, 'Task').exists).toBe(true);
  });

  test('reads the columns from the database, not from the model file', async () => {
    const report = await adapter.describe();
    const tasks = of(report, 'Task');
    const names = tasks.columns.map((entry) => entry.name).sort();

    // `externalId` is `external_id` in the database: the rename is exactly
    // what a reader of app/models cannot know
    expect(names).toContain('external_id');
    expect(names).not.toContain('externalId');
    expect(column(tasks, 'external_id').attribute).toBe('externalId');
    expect(column(tasks, 'name').attribute).toBe('name');
    expect(column(tasks, 'name').nullable).toBe(false);
    expect(column(tasks, 'id').primaryKey).toBe(true);
    expect(column(tasks, 'name').type).toEqual(expect.any(String));
  });

  test('names the values of an enum where the dialect keeps them', async () => {
    const report = await adapter.describe();
    const { values } = column(of(report, 'Task'), 'category');
    // An enum is stored as text on sqlite, so there is nothing to hand
    // back there; postgres and mysql both keep the values
    const expected =
      adapter.dialect.name === 'sqlite'
        ? null
        : ['urgent', 'high', 'medium', 'low'];

    expect(values).toEqual(expected);
  });

  test('answers the indexes the database really carries', async () => {
    const report = await adapter.describe();
    const invoices = of(report, 'Invoice');
    const unique = invoices.indexes.filter((index) => index.unique);

    expect(invoices.indexes.length).toBeGreaterThan(0);
    expect(unique.some((index) => index.columns.includes('reference'))).toBe(
      true
    );
    expect(invoices.indexes.every((index) => index.columns.length > 0)).toBe(
      true
    );
  });

  test('names the tables no model claims, and describes none of them', async () => {
    const report = await adapter.describe();

    // The sessions table is henri's, and no model declares it
    expect(report.unclaimed).toContain('henri_sessions');
    expect(report.tables.map((table) => table.table)).not.toContain(
      'henri_sessions'
    );
  });

  test('says a table is missing rather than inventing its columns', async () => {
    const table = adapter.tableNameOfKey('Invoice');

    await adapter.query(`DROP TABLE ${adapter.dialect.quote(table)}`);

    const report = await adapter.describe();

    expect(of(report, 'Invoice')).toMatchObject({
      columns: [],
      exists: false,
      indexes: [],
    });

    // Put it back for whatever runs next in this file
    await adapter.migrations.push({ interactive: false });
  });
});
