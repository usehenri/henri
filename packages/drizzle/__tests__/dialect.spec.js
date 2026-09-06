const dialects = require('../dialects');
const { ValidationError } = require('../validation');
const { build, target } = require('./helpers');

// The columns the schema types are compiled to, per dialect. sqlite has
// four storage classes, postgres and mysql keep the henri types apart.
const COLUMNS = {
  mysql: {
    active: 'tinyint(1)',
    amount: 'double',
    // The public identifier every model carries (see external-id.js)
    external_id: 'varchar(36)',
    id: 'int',
    key: 'varchar(36)',
    // The values are part of the column type
    level: "enum('low','high')",
    notes: 'text',
    ratio: 'float',
    settings: 'json',
    title: 'varchar(255)',
    total: 'int',
    when: 'datetime(3)',
  },
  postgres: {
    active: 'boolean',
    amount: 'double precision',
    external_id: 'uuid',
    id: 'integer',
    key: 'uuid',
    // A type of its own, named after the table and the column
    level: 'things_level',
    notes: 'text',
    ratio: 'real',
    settings: 'jsonb',
    title: 'character varying(255)',
    total: 'integer',
    when: 'timestamp with time zone',
  },
  sqlite: {
    active: 'integer',
    amount: 'real',
    external_id: 'text',
    id: 'integer',
    key: 'text',
    // No enum on sqlite: the values are only checked by the model
    level: 'text',
    notes: 'text',
    ratio: 'real',
    settings: 'text',
    title: 'text',
    total: 'integer',
    when: 'integer',
  },
};

// One row per column, `{ name, type }`, on every dialect
const INTROSPECT = {
  mysql: `SELECT column_name AS name, column_type AS type
          FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'things'`,
  postgres: `SELECT attname AS name, format_type(atttypid, atttypmod) AS type
             FROM pg_attribute
             WHERE attrelid = 'things'::regclass AND attnum > 0`,
  sqlite: `SELECT name, type FROM pragma_table_info('things')`,
};

const thingModel = {
  globalId: 'Thing',
  identity: 'thing',
  options: { timestamps: false },
  schema: {
    active: 'boolean',
    amount: 'number',
    key: 'uuid',
    level: { enum: ['low', 'high'], type: 'string' },
    notes: 'text',
    ratio: 'float',
    settings: 'json',
    title: { type: 'string', unique: true },
    total: 'integer',
    when: 'date',
  },
};

describe('driver errors', () => {
  const wrap = (error) =>
    Object.assign(new Error('Failed query: insert into ...'), { cause: error });

  test('unwraps the driver error drizzle reports the failure with', () => {
    const driver = Object.assign(new Error('duplicate'), { code: '23505' });

    expect(dialects.driverError(wrap(driver))).toBe(driver);
    expect(dialects.driverError(driver)).toBe(driver);
    expect(dialects.driverError(new Error('plain')).code).toBeUndefined();
  });

  test('flags a postgres unique violation, wrapped or not', () => {
    const { translate } = dialects.get('postgres');
    const driver = Object.assign(new Error('duplicate key'), {
      code: '23505',
      detail: 'Key (email)=(a@b.co) already exists.',
    });

    expect(translate(driver).henri).toEqual({
      columns: ['email'],
      key: undefined,
      kind: 'unique',
    });
    expect(translate(wrap(driver)).henri.columns).toEqual(['email']);
    expect(translate(new Error('other')).henri).toBeUndefined();
  });

  test('flags a mysql unique violation by constraint name', () => {
    const { translate } = dialects.get('mysql');
    const driver = Object.assign(
      new Error("Duplicate entry 'a@b.co' for key 'users.users_email_unique'"),
      { code: 'ER_DUP_ENTRY' }
    );

    expect(translate(wrap(driver)).henri).toEqual({
      columns: [],
      key: 'users_email_unique',
      kind: 'unique',
    });
  });

  test('flags a sqlite unique violation by column', () => {
    const { translate } = dialects.get('sqlite');
    const driver = Object.assign(
      new Error('UNIQUE constraint failed: users.email'),
      { code: 'SQLITE_CONSTRAINT_UNIQUE' }
    );

    expect(translate(driver).henri).toEqual({
      columns: ['email'],
      key: undefined,
      kind: 'unique',
    });
  });
});

describe(`schema on ${target.name}`, () => {
  let adapter;
  let Thing;

  beforeAll(async () => {
    ({ adapter } = build());
    Thing = adapter.addModel(thingModel, 'user');
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  test('maps the henri types to the columns of the dialect', async () => {
    const rows = await adapter.query(INTROSPECT[target.name]);
    const columns = Object.fromEntries(
      rows.map((row) => [row.name, String(row.type).toLowerCase()])
    );

    expect(columns).toEqual(COLUMNS[target.name]);
  });

  test('stores and reads every type back', async () => {
    const when = new Date('2026-02-03T04:05:06.000Z');
    const key = '5f4dcc3b-5aa7-4b8d-a4e2-4f4dcc3b5aa7';
    const thing = await Thing.create({
      active: true,
      amount: 12.5,
      key,
      level: 'high',
      notes: 'a long note',
      ratio: 0.5,
      settings: { deep: { list: [1, 2] } },
      title: 'first',
      total: 42,
      when,
    });
    const stored = await Thing.findById(thing.id);

    expect(stored.active).toBe(true);
    expect(stored.amount).toBe(12.5);
    expect(stored.key).toBe(key);
    expect(stored.level).toBe('high');
    expect(stored.notes).toBe('a long note');
    expect(stored.ratio).toBe(0.5);
    expect(stored.settings).toEqual({ deep: { list: [1, 2] } });
    expect(stored.total).toBe(42);
    expect(stored.when.getTime()).toBe(when.getTime());
  });

  test('refuses a value outside the enum', async () => {
    await expect(Thing.create({ level: 'nope', title: 'x' })).rejects.toThrow(
      /must be one of low, high/
    );
  });

  test('turns a unique violation into a validation error', async () => {
    await Thing.create({ title: 'unique' });

    const failed = await Thing.create({ title: 'unique' }).catch(
      (error) => error
    );

    expect(failed).toBeInstanceOf(ValidationError);
    expect(failed.errors.title.message).toBe('must be unique');
  });
});
