const fs = require('fs');
const path = require('path');
const { Dump, statementsOf } = require('../dump');
const {
  Drizzle,
  fakeHenri,
  target,
  taskModel,
  tmpdir,
  userModel,
} = require('./helpers');

const noteModel = {
  associate: (models) => models.Note.belongsTo(models.User),
  globalId: 'Note',
  identity: 'note',
  options: { timestamps: true },
  schema: {
    body: { type: 'text' },
    slug: { type: 'string', unique: true },
    when: { index: true, type: 'date' },
  },
  store: 'default',
};

/**
 * An adapter on the target database, with its migrations and its dump in a
 * directory. Two adapters built on the same `file` share one database.
 *
 * @param {string} dir The directory
 * @param {string} [file='app.db'] The database of the store
 * @param {object} [config={}] Extra store configuration
 * @returns {object} The adapter
 */
const adapterIn = (dir, file = 'app.db', config = {}) => {
  const adapter = target.prepare(
    new Drizzle(
      'default',
      {
        migrationsFolder: path.join(dir, 'db/migrations'),
        schemaFile: path.join(dir, 'db/schema.sql'),
        ...target.store(path.join(dir, file)),
        ...config,
      },
      fakeHenri({ baseRole: 'member' })
    )
  );

  adapter.addModel(taskModel, 'user');
  adapter.addModel(userModel, 'user');
  adapter.addModel(noteModel, 'user');

  return adapter;
};

/**
 * Empties the database of everything the dump describes, the way
 * `henri db:drop` and `henri db:create` would
 *
 * @param {object} adapter A started adapter
 * @returns {Promise<void>} Resolves when it is empty
 */
const empty = async (adapter) => {
  const database = adapter.rawDatabase();
  const { name, quote } = adapter.dialect;

  if (name === 'mysql') {
    await adapter.dialect.exec(database, 'SET FOREIGN_KEY_CHECKS = 0');
  }

  for (const table of await adapter.listTables()) {
    await adapter.dialect.exec(
      database,
      `DROP TABLE IF EXISTS ${quote(table)}${name === 'postgres' ? ' CASCADE' : ''}`
    );
  }

  if (name === 'mysql') {
    await adapter.dialect.exec(database, 'SET FOREIGN_KEY_CHECKS = 1');
  }

  if (name === 'postgres') {
    // The migrations table lives in a schema of its own there, so dropping
    // the tables of `public` leaves the bookkeeping behind
    await adapter.dialect.exec(
      database,
      'DROP SCHEMA IF EXISTS drizzle CASCADE'
    );

    const types = await adapter.query(
      `SELECT t.typname AS name FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype = 'e'`
    );

    for (const type of types) {
      await adapter.dialect.exec(
        database,
        `DROP TYPE IF EXISTS ${quote(type.name)}`
      );
    }
  }
};

describe('the schema dump', () => {
  let dir;

  beforeEach(() => {
    dir = tmpdir('henri-dump-');
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('describes the tables of the database and says where it is', async () => {
    const adapter = adapterIn(dir, 'app.db', { sync: true });

    await adapter.start();
    await adapter.migrations.generate({ name: 'init' });

    const written = await adapter.dump.write();
    const text = fs.readFileSync(written.file, 'utf8');

    expect(written.file).toBe(path.join(dir, 'db/schema.sql'));
    expect(written.at).toBe('0000_init');
    // The sessions table is the store's own and lives in its schema, so it
    // is described like any other; the queue's and the trail's are not
    expect(written.tables).toEqual([
      'henri_sessions',
      'notes',
      'tasks',
      'users',
    ]);
    expect(text).toContain('-- henri schema dump');
    expect(text).toContain(`-- dialect: ${target.name}`);
    expect(text).toContain('-- migration: 0000_init');
    expect(Dump.at(text)).toBe('0000_init');

    // The tables are in name order, whatever order the models were added in
    const order = ['henri_sessions', 'notes', 'tasks', 'users'].map((name) =>
      text.indexOf(`CREATE TABLE ${adapter.dialect.quote(name)}`)
    );

    expect(order).toEqual([...order].sort((one, two) => one - two));
    expect(order.every((at) => at > 0)).toBe(true);

    await adapter.stop();
  });

  test('is byte identical from one run to the next', async () => {
    const adapter = adapterIn(dir, 'app.db', { sync: true });

    await adapter.start();

    const first = await adapter.dump.render();
    const second = await adapter.dump.render();

    expect(second.text).toBe(first.text);

    // And writing rows does not change the shape
    await adapter.getModels().Task.create({ name: 'a row' });
    expect((await adapter.dump.render()).text).toBe(first.text);

    await adapter.stop();
  });

  test('leaves out the tables henri owns without a model', async () => {
    const adapter = adapterIn(dir, 'app.db', { sync: true });

    await adapter.start();
    await adapter.dialect.exec(
      adapter.rawDatabase(),
      `CREATE TABLE ${adapter.dialect.quote('henri_jobs')} (id integer)`
    );

    const { tables, text } = await adapter.dump.render();

    expect(tables).not.toContain('henri_jobs');
    expect(text).not.toContain('henri_jobs');

    await adapter.stop();
  });

  test('loads back into an empty database, and dumps the same bytes', async () => {
    const adapter = adapterIn(dir, 'app.db', { sync: true });

    await adapter.start();
    await adapter.migrations.generate({ name: 'init' });

    const written = await adapter.dump.write();
    const before = fs.readFileSync(written.file, 'utf8');

    await empty(adapter);

    const loaded = await adapter.dump.load();

    expect(loaded.at).toBe('0000_init');
    expect(loaded.statements).toBe(statementsOf(before).length);
    expect((await adapter.dump.render()).text).toBe(before);

    // A load leaves db:status telling the truth
    expect(await adapter.migrations.status()).toMatchObject({
      applied: ['0000_init'],
      pending: [],
    });

    await adapter.stop();
  });

  test('records the migrations through the one it was taken at, and no more', async () => {
    const first = adapterIn(dir, 'app.db', { sync: true });

    await first.start();
    await first.migrations.generate({ name: 'init' });
    await first.dump.write();
    await first.stop();

    // A migration written after the dump stays pending
    const second = adapterIn(dir, 'app.db');
    const Task = second.addModel(
      {
        ...taskModel,
        schema: { ...taskModel.schema, priority: { type: 'integer' } },
      },
      'user'
    );

    expect(Task.name).toBe('Task');
    await second.start();
    await second.migrations.generate({ name: 'priority' });
    await empty(second);

    const loaded = await second.dump.load();

    expect(loaded.recorded).toEqual(['0000_init']);
    expect(await second.migrations.status()).toMatchObject({
      applied: ['0000_init'],
      pending: ['0001_priority'],
    });

    await second.stop();
  });

  test('refuses a table it would create that is already there', async () => {
    const adapter = adapterIn(dir, 'app.db', { sync: true });

    await adapter.start();
    await adapter.dump.write();

    await expect(adapter.dump.load()).rejects.toMatchObject({
      code: 'HENRI_MIGRATION_DATABASE_NOT_EMPTY',
      message: expect.stringContaining('the dump describes'),
    });

    await adapter.stop();
  });

  test('leaves a table the dump says nothing about alone', async () => {
    const adapter = adapterIn(dir, 'app.db', { sync: true });

    await adapter.start();
    await adapter.dump.write();
    await empty(adapter);

    // Another tool's table in the same database is not in the way
    await adapter.dialect.exec(
      adapter.rawDatabase(),
      `CREATE TABLE ${adapter.dialect.quote('somebody_elses')} (id integer)`
    );

    const loaded = await adapter.dump.load();

    expect(loaded.statements).toBeGreaterThan(0);
    expect(await adapter.listTables()).toContain('somebody_elses');

    await adapter.stop();
  });

  test('refuses a dump that is not there, or belongs to another folder', async () => {
    const adapter = adapterIn(dir, 'app.db', { sync: true });

    await adapter.start();

    await expect(adapter.dump.load()).rejects.toMatchObject({
      code: 'HENRI_MIGRATION_DUMP_UNKNOWN',
      message: expect.stringContaining('no schema dump'),
    });

    await adapter.migrations.generate({ name: 'init' });

    const { file } = await adapter.dump.write();

    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace('0000_init', '0007_elsewhere')
    );
    await empty(adapter);

    await expect(adapter.dump.load()).rejects.toMatchObject({
      code: 'HENRI_MIGRATION_DUMP_UNKNOWN',
      message: expect.stringContaining('0007_elsewhere'),
    });

    await adapter.stop();
  });

  test('says it is at no migration when the folder is empty', async () => {
    const adapter = adapterIn(dir, 'app.db', { sync: true });

    await adapter.start();

    const { at, text } = await adapter.dump.render();

    expect(at).toBe(null);
    expect(text).toContain('-- migration: none');
    expect(Dump.at(text)).toBe(null);

    await adapter.stop();
  });

  test('statementsOf drops the comments and keeps the statements', () => {
    expect(
      statementsOf(
        '-- a header\n-- and more\n--> statement-breakpoint\nCREATE TABLE a (id integer);\n--> statement-breakpoint\n\n'
      )
    ).toEqual(['CREATE TABLE a (id integer);']);
  });
});
