const { compileTable, normalizeSchema } = require('../schema');
const dialects = require('../dialects');
const types = require('../types');
const { pluralize, snakeCase, tableNameOf } = require('../utils');
const { Drizzle, fakeHenri, taskModel, userModel } = require('./helpers');

const URLS = {
  mysql: 'mysql://henri:secret@localhost:3306/henri',
  postgres: 'postgres://henri:secret@localhost:5432/henri',
  sqlite: ':memory:',
};

/**
 * The DDL drizzle-kit generates for the template models on a dialect,
 * without a database
 *
 * @param {string} dialect sqlite, postgres or mysql
 * @returns {Promise<string>} The migration
 */
const ddl = async (dialect) => {
  const adapter = new Drizzle(
    'default',
    { dialect, url: URLS[dialect] },
    fakeHenri({ baseRole: 'member' })
  );

  adapter.addModel(taskModel, 'user');
  adapter.addModel(userModel, 'user');
  adapter.compile();

  const statements = await adapter.migrations.ddl(adapter.schemaExports());

  return statements.join('\n--> statement-breakpoint\n');
};

describe('schema normalizer', () => {
  test('maps the henri type names', () => {
    const fields = normalizeSchema({
      active: 'boolean',
      age: 'integer',
      birthday: { type: 'date' },
      key: 'uuid',
      name: { type: 'string' },
      notes: 'text',
      ratio: 'float',
      settings: 'json',
      weight: 'number',
    });

    expect(
      Object.fromEntries(
        Object.entries(fields).map(([name, field]) => [name, field.type])
      )
    ).toEqual({
      active: 'boolean',
      age: 'integer',
      birthday: 'date',
      key: 'uuid',
      name: 'string',
      notes: 'text',
      ratio: 'float',
      settings: 'json',
      weight: 'number',
    });
  });

  test('documents the same names as the types map', () => {
    expect(Object.keys(types).sort()).toEqual([
      'boolean',
      'date',
      'float',
      'integer',
      'json',
      'number',
      'string',
      'text',
      'uuid',
    ]);
    Object.values(types).forEach((entry) => {
      expect(Object.keys(entry).sort()).toEqual([
        'js',
        'mysql',
        'postgres',
        'sqlite',
      ]);
    });
  });

  test('accepts constructors, sequelize names and nested documents', () => {
    const fields = normalizeSchema({
      address: { city: String, street: String },
      count: Number,
      meta: {},
      name: String,
      raw: { type: 'TEXT' },
      tags: [String],
      when: { type: 'DATEONLY' },
    });

    expect(fields.address.type).toBe('json');
    expect(fields.count.type).toBe('number');
    expect(fields.meta.type).toBe('json');
    expect(fields.name.type).toBe('string');
    expect(fields.raw.type).toBe('text');
    expect(fields.tags.type).toBe('json');
    expect(fields.when.type).toBe('date');
  });

  test('keeps required, default, enum, unique, index and select', () => {
    const fields = normalizeSchema({
      email: { type: 'string', unique: true },
      name: { required: true, type: 'string' },
      secret: { select: false, type: 'string' },
      slug: { index: true, type: 'string' },
      status: { default: 'new', enum: ['new', 'old'], type: 'string' },
    });

    expect(fields.name).toEqual({ required: true, type: 'string' });
    expect(fields.status).toEqual({
      default: 'new',
      enum: ['new', 'old'],
      type: 'string',
    });
    expect(fields.email.unique).toBe(true);
    expect(fields.slug.index).toBe(true);
    expect(fields.secret.hidden).toBe(true);
  });

  test('throws on unknown keys, unknown types and bad enums', () => {
    expect(() =>
      normalizeSchema({ name: { type: 'string', typo: 1 } })
    ).toThrow("Unknown key 'typo' on field 'name'");
    expect(() => normalizeSchema({ name: 'varchar' })).toThrow(
      "Unknown type 'varchar' for field 'name'"
    );
    expect(() => normalizeSchema({ name: { required: true } })).toThrow(
      "Field 'name' has 'required' but no type"
    );
    expect(() =>
      normalizeSchema({ name: { enum: 'x', type: 'string' } })
    ).toThrow("'enum' must be an array");
    expect(() => normalizeSchema({ name: 42 })).toThrow('Unsupported type 42');
  });

  test('names tables and columns the Rails way', () => {
    expect(tableNameOf({ globalId: 'Task' })).toBe('tasks');
    expect(tableNameOf({ globalId: 'HighScore' })).toBe('high_scores');
    expect(tableNameOf({ globalId: 'Category' })).toBe('categories');
    expect(tableNameOf({ globalId: 'Person' })).toBe('people');
    expect(tableNameOf({ globalId: 'Note', name: 'my_notes' })).toBe(
      'my_notes'
    );
    expect(pluralize('box')).toBe('boxes');
    expect(snakeCase('createdAt')).toBe('created_at');
    expect(snakeCase('HTTPCode')).toBe('http_code');
  });

  test('compiles snake_case columns, ids and timestamps', () => {
    const { columns, table } = compileTable(
      {
        fields: normalizeSchema({ dueDate: 'date', name: 'string' }),
        key: 'Task',
        tableName: 'tasks',
        timestamps: true,
      },
      dialects.get('sqlite')
    );

    expect(columns).toEqual({
      createdAt: 'created_at',
      dueDate: 'due_date',
      id: 'id',
      name: 'name',
      updatedAt: 'updated_at',
    });
    expect(table.dueDate.name).toBe('due_date');
    expect(table.id.primary).toBe(true);
  });
});

describe('DDL per dialect (drizzle-kit, no server)', () => {
  test('sqlite', async () => {
    const sql = await ddl('sqlite');

    expect(sql).toContain('`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL');
    expect(sql).toContain("`category` text DEFAULT 'low'");
    expect(sql).toContain('`done` integer DEFAULT false');
    expect(sql).toContain('`created_at` integer NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX `users_email_unique`');
    expect(sql).toContain('CREATE TABLE `henri_sessions`');
    expect(sql).toMatchSnapshot();
  });

  test('postgres', async () => {
    const sql = await ddl('postgres');

    expect(sql).toContain(
      `CREATE TYPE "public"."tasks_category" AS ENUM('urgent', 'high', 'medium', 'low')`
    );
    expect(sql).toContain('GENERATED BY DEFAULT AS IDENTITY');
    expect(sql).toContain('"roles" jsonb');
    expect(sql).toContain('"created_at" timestamp with time zone NOT NULL');
    expect(sql).toContain('CONSTRAINT "users_email_unique" UNIQUE("email")');
    expect(sql).toMatchSnapshot();
  });

  test('mysql', async () => {
    const sql = await ddl('mysql');

    expect(sql).toContain("`category` enum('urgent','high','medium','low')");
    expect(sql).toContain('`id` int AUTO_INCREMENT NOT NULL');
    expect(sql).toContain('`roles` json');
    expect(sql).toContain('`created_at` datetime(3) NOT NULL');
    expect(sql).toContain('CONSTRAINT `users_email_unique` UNIQUE(`email`)');
    expect(sql).toMatchSnapshot();
  });

  test('the sessions table is only compiled with a user model', () => {
    const adapter = new Drizzle(
      'default',
      { dialect: 'sqlite', url: ':memory:' },
      fakeHenri()
    );

    adapter.addModel(taskModel, 'user');
    adapter.compile();

    expect(adapter.sessionTable).toBeNull();
    expect(adapter.tableNames()).toEqual(['tasks']);
  });
});
