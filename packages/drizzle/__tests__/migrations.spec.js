const fs = require('fs');
const path = require('path');
const {
  Drizzle,
  fakeHenri,
  target,
  taskModel,
  tmpdir,
  userModel,
} = require('./helpers');

// What drizzle-kit writes for the same schema change on each dialect
const EXPECTED = {
  mysql: {
    added: 'ALTER TABLE `tasks` ADD `priority` int DEFAULT 1;',
    create: 'CREATE TABLE `tasks`',
    dropped: /DROP COLUMN `extra`/,
  },
  postgres: {
    added: 'ALTER TABLE "tasks" ADD COLUMN "priority" integer DEFAULT 1;',
    create: 'CREATE TABLE "tasks"',
    dropped: /DROP COLUMN "extra"/,
  },
  sqlite: {
    added: 'ALTER TABLE `tasks` ADD `priority` integer DEFAULT 1;',
    create: 'CREATE TABLE `tasks`',
    // A sqlite column is dropped by rebuilding the table
    dropped: /DROP COLUMN `extra`|__new_tasks/,
  },
};

const expected = EXPECTED[target.name];

/**
 * An adapter on the target database, with its migrations folder in a
 * directory: two adapters built for the same `file` share one database (one
 * sqlite file), the way an application restarts on its data
 *
 * @param {string} dir The directory
 * @param {object} [config={}] Extra store configuration
 * @param {string} [file='app.db'] The database of the store
 * @returns {object} The adapter
 */
const adapterIn = (dir, config = {}, file = 'app.db') =>
  target.prepare(
    new Drizzle(
      'default',
      {
        migrationsFolder: path.join(dir, 'db/migrations'),
        ...target.store(path.join(dir, file)),
        ...config,
      },
      fakeHenri({ baseRole: 'member' })
    )
  );

describe('migrations', () => {
  let dir;

  beforeEach(() => {
    dir = tmpdir();
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('generate writes drizzle-kit files and records them on a pushed database', async () => {
    const adapter = adapterIn(dir);

    adapter.addModel(taskModel, 'user');
    adapter.addModel(userModel, 'user');
    await adapter.start();

    expect(await adapter.migrations.status()).toEqual({
      applied: [],
      folder: path.join(dir, 'db/migrations'),
      pending: [],
    });

    const first = await adapter.migrations.generate({ name: 'Create tasks' });

    expect(first.tag).toBe('0000_create_tasks');
    expect(first.file).toBe(
      path.join(dir, 'db/migrations/0000_create_tasks.sql')
    );
    expect(first.statements.length).toBeGreaterThan(3);
    expect(first.recorded).toEqual(['0000_create_tasks']);

    const sql = fs.readFileSync(first.file, 'utf8');
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'db/migrations/meta/_journal.json'),
        'utf8'
      )
    );
    const snapshot = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'db/migrations/meta/0000_snapshot.json'),
        'utf8'
      )
    );

    expect(sql).toContain(expected.create);
    expect(sql).toContain('--> statement-breakpoint');
    expect(journal).toMatchObject({
      dialect: target.dialect.kit.dialect,
      entries: [
        {
          breakpoints: true,
          idx: 0,
          tag: '0000_create_tasks',
          when: expect.any(Number),
        },
      ],
      version: '7',
    });
    // Postgres snapshots are keyed by schema and table
    expect(
      Object.keys(snapshot.tables)
        .map((key) => key.replace(/^public\./, ''))
        .sort()
    ).toEqual(['henri_sessions', 'tasks', 'users']);
    expect(snapshot.prevId).toBe('00000000-0000-0000-0000-000000000000');

    // The database was pushed to this schema: nothing pending
    expect(await adapter.migrations.status()).toMatchObject({
      applied: ['0000_create_tasks'],
      pending: [],
    });
    expect((await adapter.migrations.generate()).file).toBeNull();
    expect(await adapter.migrations.migrate()).toEqual({
      applied: [],
      pending: [],
    });
    await adapter.stop();
  });

  test('migrate applies the pending migrations on a fresh database', async () => {
    const first = adapterIn(dir);

    first.addModel(taskModel, 'user');
    await first.start();
    await first.migrations.generate({ name: 'init' });
    await first.stop();

    // Sync off: the second adapter only knows the migrations
    const second = adapterIn(dir, { sync: false }, 'fresh.db');
    const Task = second.addModel(
      {
        ...taskModel,
        schema: {
          ...taskModel.schema,
          priority: { default: 1, type: 'integer' },
        },
      },
      'user'
    );

    await second.start();
    expect(await second.listTables()).toEqual([]);
    expect(await second.migrations.status()).toMatchObject({
      applied: [],
      pending: ['0000_init'],
    });

    const added = await second.migrations.generate({ name: 'add priority' });

    expect(added.tag).toBe('0001_add_priority');
    expect(added.recorded).toEqual([]);
    expect(fs.readFileSync(added.file, 'utf8')).toBe(expected.added);
    expect(await second.migrations.status()).toMatchObject({
      applied: [],
      pending: ['0000_init', '0001_add_priority'],
    });

    expect(await second.migrations.migrate()).toEqual({
      applied: ['0000_init', '0001_add_priority'],
      pending: [],
    });
    expect(await second.listTables()).toContain('tasks');
    // The migrations table lives in the `drizzle` schema on postgres
    expect(await second.migrations.applied()).toHaveLength(2);
    expect((await Task.create({ name: 'migrated' })).priority).toBe(1);
    expect(await second.migrations.migrate()).toEqual({
      applied: [],
      pending: [],
    });

    // Restarting with the default sync pushes nothing more
    await second.stop();
    second.config.sync = true;
    await second.start();
    expect(await Task.count()).toBe(1);
    expect(await second.migrations.status()).toMatchObject({ pending: [] });
    await second.stop();
  });

  /**
   * A database with a task table holding an `extra` column and one row, and
   * a second store on it whose model dropped that column
   *
   * @param {string} directory The directory of the database
   * @returns {Promise<object>} The second store and its Task model
   */
  const narrowed = async (directory) => {
    const wide = adapterIn(directory);
    const Wide = wide.addModel(
      { ...taskModel, schema: { ...taskModel.schema, extra: 'string' } },
      'user'
    );

    await wide.start();
    // A data loss is only flagged by drizzle-kit when rows exist
    await Wide.create({ extra: 'kept?', name: 'row' });
    await wide.stop();

    const narrow = adapterIn(directory);
    const Task = narrow.addModel(taskModel, 'user');

    await narrow.start();

    return { Task, narrow };
  };

  test.runIf(target.name !== 'mysql')(
    'push refuses to lose data unless it is forced',
    async () => {
      const { Task, narrow } = await narrowed(dir);

      expect(
        narrow.henri.calls.some(
          (call) => call[0] === 'warn' && /lose data/.test(call[2])
        )
      ).toBe(true);

      const plan = await narrow.migrations.plan();

      expect(plan.hasDataLoss).toBe(true);
      expect(plan.statements.join('\n')).toMatch(expected.dropped);
      expect((await narrow.migrations.push()).applied).toBe(false);
      expect((await narrow.migrations.push({ force: true })).applied).toBe(
        true
      );
      expect((await narrow.migrations.plan()).statements).toEqual([]);
      expect(await Task.count()).toBe(1);
      expect((await Task.first()).extra).toBeUndefined();
      await narrow.stop();
    }
  );

  test.runIf(target.name === 'mysql')(
    'push leaves a mysql table alone and reports the drift',
    async () => {
      const { Task, narrow } = await narrowed(dir);

      // Drizzle-kit does not alter a mysql table on a push: the column is
      // kept, the drift is reported, and the rows are never truncated
      expect(
        narrow.henri.calls.some(
          (call) => call[0] === 'warn' && /does not alter mysql/.test(call[2])
        )
      ).toBe(true);

      const plan = await narrow.migrations.plan();

      expect(plan.hasDataLoss).toBe(true);
      expect(plan.statements).toEqual([]);
      expect(plan.drifted).toEqual(['tasks']);
      expect((await narrow.migrations.push()).applied).toBe(true);
      expect(await Task.count()).toBe(1);
      expect(
        (
          await narrow.query(
            "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'tasks' AND column_name = 'extra'"
          )
        ).length
      ).toBe(1);
      await narrow.stop();
    }
  );

  test('push refuses to guess a rename without a terminal', async () => {
    const first = adapterIn(dir);

    first.addModel(taskModel, 'user');
    await first.start();
    await first.stop();

    // A new table with a removed one: drizzle-kit would ask
    const renamed = adapterIn(dir);

    renamed.addModel(
      { ...taskModel, globalId: 'Todo', identity: 'todo' },
      'user'
    );
    await expect(renamed.start()).rejects.toThrow(
      /tables were added \(todos\) and removed \(tasks\)/
    );
    expect(renamed.started).toBe(false);
  });
});
