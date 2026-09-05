const fs = require('fs');
const path = require('path');
const {
  Drizzle,
  fakeHenri,
  taskModel,
  tmpdir,
  userModel,
} = require('./helpers');

/**
 * An adapter on a sqlite file with its migrations folder in the same dir
 *
 * @param {string} dir The directory
 * @param {object} [config={}] Extra store configuration
 * @param {string} [file='app.db'] The database file
 * @returns {object} The adapter
 */
const adapterIn = (dir, config = {}, file = 'app.db') =>
  new Drizzle(
    'default',
    {
      dialect: 'sqlite',
      migrationsFolder: path.join(dir, 'db/migrations'),
      url: `file:${path.join(dir, file)}`,
      ...config,
    },
    fakeHenri({ baseRole: 'member' })
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

    expect(sql).toContain('CREATE TABLE `tasks`');
    expect(sql).toContain('--> statement-breakpoint');
    expect(journal).toMatchObject({
      dialect: 'sqlite',
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
    expect(Object.keys(snapshot.tables).sort()).toEqual([
      'henri_sessions',
      'tasks',
      'users',
    ]);
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
    expect(fs.readFileSync(added.file, 'utf8')).toBe(
      'ALTER TABLE `tasks` ADD `priority` integer DEFAULT 1;'
    );
    expect(await second.migrations.status()).toMatchObject({
      applied: [],
      pending: ['0000_init', '0001_add_priority'],
    });

    expect(await second.migrations.migrate()).toEqual({
      applied: ['0000_init', '0001_add_priority'],
      pending: [],
    });
    expect(await second.listTables()).toEqual(
      expect.arrayContaining(['__drizzle_migrations', 'tasks'])
    );
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

  test('push refuses to lose data unless forced, and to guess renames without a terminal', async () => {
    const wide = adapterIn(dir);
    const Wide = wide.addModel(
      { ...taskModel, schema: { ...taskModel.schema, extra: 'string' } },
      'user'
    );

    await wide.start();
    // A data loss is only flagged by drizzle-kit when rows exist
    await Wide.create({ extra: 'kept?', name: 'row' });
    await wide.stop();

    const narrow = adapterIn(dir);
    const Task = narrow.addModel(taskModel, 'user');

    await narrow.start();
    expect(
      narrow.henri.calls.some(
        (call) => call[0] === 'warn' && /lose data/.test(call[2])
      )
    ).toBe(true);

    const plan = await narrow.migrations.plan();

    expect(plan.hasDataLoss).toBe(true);
    expect(plan.statements.join('\n')).toMatch(
      /DROP COLUMN `extra`|__new_tasks/
    );
    expect((await narrow.migrations.push()).applied).toBe(false);
    expect((await narrow.migrations.push({ force: true })).applied).toBe(true);
    expect((await narrow.migrations.plan()).statements).toEqual([]);
    expect(await Task.count()).toBe(1);
    expect((await Task.first()).extra).toBeUndefined();

    // A new table with a removed one: drizzle-kit would ask
    await narrow.stop();

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
