const { DataTypes } = require('sequelize');

const { build, taskModel, userModel } = require('./helpers');
const { normalizeType, sameType } = require('../drift');
const target = require('./targets');

/**
 * An adapter with the two models, started (so the schema exists)
 *
 * @param {object} [config={}] Extra store configuration
 * @returns {Promise<object>} The adapter and its fake henri
 */
const started = async (config = {}) => {
  const { adapter, henri } = build({ baseRole: 'user' }, config);

  adapter.addModel(taskModel, 'user');
  adapter.addModel(userModel, 'user');
  adapter.addModel(invoiceModel, 'user');
  await adapter.start();

  return { adapter, henri };
};

// A model whose fields cover the types that read back differently than
// they were written: a float (DOUBLE PRECISION on PostgreSQL), a uuid
// (CHAR(36) BINARY on MySQL) and an enum
const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  schema: {
    amount: { required: true, type: 'float' },
    kind: { enum: ['credit', 'debit'], type: 'string' },
    total: { type: 'number' },
  },
  store: 'default',
};

/**
 * The names of the tables the two models live in
 *
 * @param {object} adapter A started adapter
 * @returns {{tasks: string, users: string}} The table names
 */
const tables = (adapter) => ({
  tasks: adapter.models.Task.getTableName(),
  users: adapter.models.User.getTableName(),
});

/**
 * The difference about one column (or one table, without a column)
 *
 * @param {object} report A drift report
 * @param {string} table The table name
 * @param {?string} column The column name
 * @returns {?object} The difference
 */
const about = (report, table, column = null) =>
  report.differences.find(
    (difference) => difference.table === table && difference.column === column
  ) || null;

describe('normalizeType', () => {
  test('reads the dialects back into one vocabulary', () => {
    // PostgreSQL answers describeTable() in its own words
    expect(normalizeType('CHARACTER VARYING(255)')).toBe('VARCHAR(255)');
    // MySQL renders a uuid as CHAR(36) BINARY and reads it back as CHAR(36)
    expect(normalizeType('CHAR(36) BINARY')).toBe('CHAR(36)');
    expect(normalizeType('INT')).toBe('INTEGER');
    expect(normalizeType('timestamptz')).toBe('TIMESTAMP WITH TIME ZONE');
    expect(normalizeType('bool')).toBe('BOOLEAN');
  });

  test('knows which floats a dialect keeps apart', () => {
    // PostgreSQL has no single precision FLOAT: a FLOAT column is DOUBLE
    // PRECISION, so henri's `float` and `number` are one column there
    expect(sameType('FLOAT', 'DOUBLE PRECISION', 'postgres')).toBe(true);
    expect(sameType('DOUBLE PRECISION', 'DOUBLE PRECISION', 'postgres')).toBe(
      true
    );
    expect(sameType('FLOAT', 'REAL', 'postgres')).toBe(false);

    // MySQL keeps them apart, and answers DOUBLE for DOUBLE PRECISION
    expect(sameType('DOUBLE PRECISION', 'DOUBLE', 'mysql')).toBe(true);
    expect(sameType('FLOAT', 'DOUBLE', 'mysql')).toBe(false);
  });

  test('lets the database choose a precision the model did not name', () => {
    // MySQL stores a DECIMAL as DECIMAL(10,0): nobody changed anything
    expect(sameType('DECIMAL', 'DECIMAL(10,0)', 'mysql')).toBe(true);
    // A model that does name one is compared on it
    expect(sameType('VARCHAR(64)', 'CHARACTER VARYING(255)', 'postgres')).toBe(
      false
    );
    expect(sameType('VARCHAR(255)', 'CHARACTER VARYING(255)', 'postgres')).toBe(
      true
    );
  });

  test('leaves a type it does not know alone', () => {
    expect(normalizeType('GEOGRAPHY(POINT,4326)')).toBe(
      'GEOGRAPHY(POINT,4326)'
    );
    expect(normalizeType(undefined)).toBe('');
  });
});

describe('drift', () => {
  test('a database henri just created matches the models', async () => {
    const { adapter } = await started();
    const report = await adapter.drift();

    // The one assertion that keeps the feature honest: no false positive on
    // a schema henri wrote itself, enums, uuids and timestamps included
    expect(report.differences).toEqual([]);
    expect(report.clean).toBe(true);
    expect(report.statements).toEqual([]);
    expect(report.store).toBe('default');
    expect(report.dialect).toBe(target.name);

    await adapter.stop();
  });

  test('reports a missing table, column, index and type, and never a drop', async () => {
    const { adapter } = await started();
    const { tasks, users } = tables(adapter);
    const queryInterface = adapter.connector.getQueryInterface();

    await queryInterface.removeColumn(tasks, 'done');
    await queryInterface.addColumn(tasks, 'legacy_note', {
      type: DataTypes.STRING,
    });
    await queryInterface.changeColumn(tasks, 'name', {
      allowNull: true,
      type: DataTypes.TEXT,
    });
    await queryInterface.dropTable(users);

    const report = await adapter.drift();

    expect(report.clean).toBe(false);

    expect(about(report, tasks, 'done')).toMatchObject({
      description: `${tasks}.done: the column is missing`,
      kind: 'column-missing',
      model: 'Task',
    });
    expect(about(report, tasks, 'done').statement).toMatch(/ADD/u);

    expect(about(report, tasks, 'name')).toMatchObject({
      description: expect.stringContaining('the database has'),
      kind: 'column-changed',
    });
    expect(about(report, tasks, 'name').reason).toContain('nullable');

    // A column no model declares is reported and never dropped: it may hold
    // the only copy of something
    expect(about(report, tasks, 'legacy_note')).toMatchObject({
      kind: 'column-unexpected',
      statement: null,
    });

    expect(about(report, users)).toMatchObject({
      kind: 'table-missing',
      model: 'User',
    });
    expect(about(report, users).statement).toMatch(/CREATE TABLE/u);
    expect(report.statements.join('\n')).not.toMatch(/DROP COLUMN/u);

    await adapter.stop();
  });

  test('the DDL it writes closes the drift it reported', async () => {
    const { adapter } = await started();
    const { tasks, users } = tables(adapter);
    const queryInterface = adapter.connector.getQueryInterface();

    await queryInterface.removeColumn(tasks, 'done');
    await queryInterface.dropTable(users);

    const before = await adapter.drift();

    expect(before.statements.length).toBe(2);

    for (const statement of before.statements) {
      await adapter.query(statement);
    }

    const after = await adapter.drift();

    expect(after.differences).toEqual([]);
    expect(after.clean).toBe(true);

    await adapter.stop();
  });

  test.runIf(target.name === 'sqlite')(
    'says so rather than writing SQL sqlite would refuse',
    async () => {
      const { adapter } = await started();
      const { tasks } = tables(adapter);

      await adapter.connector
        .getQueryInterface()
        .changeColumn(tasks, 'name', { allowNull: true, type: DataTypes.TEXT });

      const report = await adapter.drift();

      // There is no ALTER COLUMN in sqlite, and Sequelize's generator
      // would emit MySQL's `ALTER TABLE ... CHANGE` for it
      expect(about(report, tasks, 'name').statement).toBe(null);
      expect(report.unsupported).toEqual([
        `${tasks}.name: sqlite has no ALTER COLUMN; the table has to be rebuilt`,
      ]);

      await adapter.stop();
    }
  );

  test.runIf(target.live)('writes an ALTER a live server accepts', async () => {
    const { adapter } = await started();
    const { tasks } = tables(adapter);

    await adapter.connector
      .getQueryInterface()
      .changeColumn(tasks, 'name', { allowNull: true, type: DataTypes.TEXT });

    const report = await adapter.drift();
    const difference = about(report, tasks, 'name');

    expect(difference.kind).toBe('column-changed');
    expect(difference.statement).toBeTruthy();

    await adapter.query(difference.statement);

    expect((await adapter.drift()).clean).toBe(true);

    await adapter.stop();
  });
});

describe('sync', () => {
  test('creates the tables in development, as it always has', async () => {
    const { adapter } = await started();

    expect((await adapter.drift()).clean).toBe(true);

    await adapter.stop();
  });

  test('sync: false leaves the schema alone', async () => {
    const { adapter } = await started({ sync: false });
    const report = await adapter.drift();

    expect(report.clean).toBe(false);
    expect(
      report.differences.every((one) => one.kind === 'table-missing')
    ).toBe(true);

    await adapter.stop();
  });

  test('a production boot changes nothing and reports the drift', async () => {
    const { adapter, henri } = build({ baseRole: 'user' });

    henri.isProduction = true;
    adapter.addModel(taskModel, 'user');
    adapter.addModel(userModel, 'user');
    await adapter.start();

    const report = await adapter.drift();

    // Nothing was created: production no longer runs DDL of its own
    expect(report.clean).toBe(false);
    expect(henri.calls).toContainEqual([
      'warn',
      adapter.adapterName,
      expect.stringContaining('run "henri db:status"'),
    ]);
    expect(henri.calls).toContainEqual([
      'warn',
      adapter.adapterName,
      expect.stringContaining('the table is missing'),
    ]);

    await adapter.stop();
  });

  test('a production boot syncs when the store asks for it', async () => {
    const { adapter, henri } = build({ baseRole: 'user' }, { sync: true });

    henri.isProduction = true;
    adapter.addModel(taskModel, 'user');
    await adapter.start();

    expect((await adapter.drift()).clean).toBe(true);

    await adapter.stop();
  });

  test('HENRI_SKIP_SYNC skips it, so henri db drives the schema', async () => {
    process.env.HENRI_SKIP_SYNC = 'true';

    try {
      const { adapter } = await started();

      expect((await adapter.drift()).clean).toBe(false);
      await adapter.stop();
    } finally {
      delete process.env.HENRI_SKIP_SYNC;
    }
  });

  test('sync never reaches Sequelize as one of its own options', async () => {
    const { adapter } = build({}, { sync: false });

    expect(adapter.connector.options.sync).toEqual({});
  });
});
