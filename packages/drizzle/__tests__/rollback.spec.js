const fs = require('fs');
const path = require('path');
const { Drizzle, fakeHenri, target, taskModel, tmpdir } = require('./helpers');

// What each dialect writes to take a column away again
const DROPPED = {
  mysql: /ALTER TABLE `tasks` DROP COLUMN `priority`/u,
  postgres: /ALTER TABLE "tasks" DROP COLUMN "priority"/u,
  sqlite: /ALTER TABLE `tasks` DROP COLUMN `priority`/u,
};

/**
 * An adapter on the target database with its migrations in a directory.
 * Two adapters built on the same `file` share one database, the way an
 * application restarts on its data.
 *
 * @param {string} dir The directory
 * @param {object} [schema] The schema of the task model
 * @param {string} [file='app.db'] The database of the store
 * @returns {object} The adapter
 */
const adapterIn = (dir, schema = taskModel.schema, file = 'app.db') => {
  const adapter = target.prepare(
    new Drizzle(
      'default',
      {
        migrationsFolder: path.join(dir, 'db/migrations'),
        sync: false,
        ...target.store(path.join(dir, file)),
      },
      fakeHenri({ baseRole: 'member' })
    )
  );

  adapter.addModel({ ...taskModel, schema }, 'user');

  return adapter;
};

const withPriority = {
  ...taskModel.schema,
  priority: { type: 'integer' },
};

/**
 * A store with `0000_create` applied and `0001_priority` pending
 *
 * @param {string} dir The directory
 * @returns {Promise<object>} The adapter, started
 */
const upToPriority = async (dir) => {
  const first = adapterIn(dir);

  await first.start();
  await first.migrations.generate({ name: 'create' });
  await first.migrations.migrate();
  await first.stop();

  const second = adapterIn(dir, withPriority);

  await second.start();
  await second.migrations.generate({ name: 'priority' });

  return second;
};

describe('rollback', () => {
  let dir;

  beforeEach(() => {
    dir = tmpdir('henri-rollback-');
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('undoes the last migration when nothing was written into it', async () => {
    const adapter = await upToPriority(dir);

    await adapter.migrations.migrate();
    await adapter.getModels().Task.create({ name: 'no priority here' });

    const result = await adapter.migrations.rollback();
    const [step] = result.plan;

    expect(result.applied).toBe(true);
    expect(result.rolledBack).toEqual(['0001_priority']);
    expect(step.statements.join('\n')).toMatch(DROPPED[target.name]);
    // The rows were counted, and the column held nothing
    expect(step.removes).toEqual([
      { column: 'priority', kind: 'column', rows: 0, table: 'tasks' },
    ]);

    // The folder is untouched: the migration is pending again
    expect(await adapter.migrations.status()).toMatchObject({
      applied: ['0000_create'],
      pending: ['0001_priority'],
    });
    expect(
      fs.existsSync(path.join(dir, 'db/migrations/0001_priority.sql'))
    ).toBe(true);

    await adapter.stop();
  });

  test('a rolled back migration applies again', async () => {
    const adapter = await upToPriority(dir);

    await adapter.migrations.migrate();
    await adapter.migrations.rollback();

    expect(await adapter.migrations.migrate()).toEqual({
      applied: ['0001_priority'],
      pending: [],
    });

    await adapter.stop();
  });

  test('refuses to drop values that are there, and --force applies it', async () => {
    const adapter = await upToPriority(dir);

    await adapter.migrations.migrate();
    await adapter.getModels().Task.create({ name: 'urgent', priority: 3 });

    const refused = await adapter.migrations.rollback();

    expect(refused.applied).toBe(false);
    expect(refused.rolledBack).toEqual([]);
    expect(refused.plan[0].removes).toEqual([
      { column: 'priority', kind: 'column', rows: 1, table: 'tasks' },
    ]);
    // Nothing ran
    expect(await adapter.migrations.status()).toMatchObject({
      pending: [],
    });

    const forced = await adapter.migrations.rollback({ force: true });

    expect(forced.applied).toBe(true);
    expect(forced.rolledBack).toEqual(['0001_priority']);

    await adapter.stop();
  });

  test('counts the rows of a table it would drop', async () => {
    const adapter = await upToPriority(dir);

    await adapter.migrations.migrate();
    await adapter.getModels().Task.create({ name: 'kept' });

    // Undo the column first, so the create is the last one applied
    await adapter.migrations.rollback({ force: true });

    const refused = await adapter.migrations.rollback();

    expect(refused.applied).toBe(false);
    expect(refused.plan[0]).toMatchObject({
      removes: [{ column: null, kind: 'table', rows: 1, table: 'tasks' }],
      tag: '0000_create',
    });

    await adapter.stop();
  });

  test('undoes several at once, newest first', async () => {
    const adapter = await upToPriority(dir);

    await adapter.migrations.migrate();

    const result = await adapter.migrations.rollback({ steps: 2 });

    expect(result.applied).toBe(true);
    expect(result.rolledBack).toEqual(['0001_priority', '0000_create']);
    expect(await adapter.migrations.status()).toMatchObject({
      applied: [],
      pending: ['0000_create', '0001_priority'],
    });
    expect(await adapter.listTables()).not.toContain('tasks');

    await adapter.stop();
  });

  test('refuses a migration that dropped a column, with or without force', async () => {
    const adapter = await upToPriority(dir);

    await adapter.migrations.migrate();
    await adapter.stop();

    const back = adapterIn(dir, taskModel.schema);

    await back.start();
    await back.migrations.generate({ name: 'drop priority' });
    await back.migrations.migrate();

    for (const options of [{}, { force: true }]) {
      await expect(back.migrations.rollback(options)).rejects.toMatchObject({
        code: 'HENRI_MIGRATION_IRREVERSIBLE',
        message: expect.stringContaining('tasks.priority'),
      });
    }

    await back.stop();
  });

  test('refuses a migration file that is not the one that ran', async () => {
    const adapter = await upToPriority(dir);

    await adapter.migrations.migrate();
    fs.appendFileSync(
      path.join(dir, 'db/migrations/0001_priority.sql'),
      '\n-- a hand edit\n'
    );

    await expect(adapter.migrations.rollback()).rejects.toMatchObject({
      code: 'HENRI_MIGRATION_EDITED',
    });

    await adapter.stop();
  });

  test('refuses to roll back further than what is applied', async () => {
    const adapter = adapterIn(dir);

    await adapter.start();

    await expect(adapter.migrations.rollback()).rejects.toMatchObject({
      code: 'HENRI_MIGRATION_NOT_APPLIED',
      message: expect.stringContaining('no applied migration'),
    });

    await adapter.migrations.generate({ name: 'create' });
    await adapter.migrations.migrate();

    await expect(
      adapter.migrations.rollback({ steps: 4 })
    ).rejects.toMatchObject({
      code: 'HENRI_MIGRATION_NOT_APPLIED',
      message: expect.stringContaining('1 applied migration(s), 4'),
    });

    await adapter.stop();
  });

  test('refuses when the snapshot the inverse needs is gone', async () => {
    const adapter = await upToPriority(dir);

    await adapter.migrations.migrate();
    fs.rmSync(path.join(dir, 'db/migrations/meta/0001_snapshot.json'));

    await expect(adapter.migrations.rollback()).rejects.toMatchObject({
      code: 'HENRI_MIGRATION_SNAPSHOT_MISSING',
    });

    await adapter.stop();
  });
});
