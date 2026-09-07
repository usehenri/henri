const fs = require('fs');
const path = require('path');
const { Drizzle, fakeHenri, target, taskModel, tmpdir } = require('./helpers');

/**
 * An adapter on the target database with its migrations in a directory
 *
 * @param {string} dir The directory
 * @param {object} [schema] The schema of the task model
 * @param {object} [settings={}] `production` and a `migrations` block
 * @returns {object} The adapter
 */
const adapterIn = (dir, schema = taskModel.schema, settings = {}) => {
  const { production, strictConfig, ...rest } = settings;
  const henri = fakeHenri({ baseRole: 'member', ...rest });

  henri.isProduction = Boolean(production);

  // What core's own `config.get()` does with a key the file never set: it
  // throws rather than answering nothing, so a read that forgets the second
  // argument fails an application that never wrote the block. The fake is
  // permissive, so this is the way to ask for the real behaviour
  if (strictConfig) {
    const settingsOf = henri.config.get;

    henri.config.get = (key, quiet) => {
      if (!henri.config.has(key) && quiet !== true) {
        throw Object.assign(new Error(`Config key ${key} does not exist`), {
          code: 'HENRI_CONFIG_UNKNOWN_KEY',
        });
      }

      return settingsOf(key);
    };
  }

  const adapter = target.prepare(
    new Drizzle(
      'default',
      {
        migrationsFolder: path.join(dir, 'db/migrations'),
        sync: false,
        ...target.store(path.join(dir, 'app.db')),
      },
      henri
    )
  );

  adapter.addModel({ ...taskModel, schema }, 'user');

  return adapter;
};

const withoutCategory = { ...taskModel.schema };

delete withoutCategory.category;

/**
 * A store with `0000_create` applied and a row written into it
 *
 * @param {string} dir The directory
 * @returns {Promise<void>} Resolves once it is there
 */
const created = async (dir) => {
  const first = adapterIn(dir);

  await first.start();
  await first.migrations.generate({ name: 'create' });
  await first.migrations.migrate();
  await first.getModels().Task.create({ name: 'a' });
  await first.stop();
};

describe('the review of a migration', () => {
  let dir;

  beforeEach(() => {
    dir = tmpdir('henri-review-');
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  // An application that never wrote a "migrations" block is every
  // application that exists today, and core's config.get() throws for a key
  // like that rather than answering nothing
  test('an application with no migrations block reads the defaults', async () => {
    await created(dir);

    const writer = adapterIn(dir, withoutCategory, { strictConfig: true });

    await writer.start();

    const generated = await writer.migrations.generate({
      name: 'drop-category',
    });
    const settings = writer.migrations.settings();

    await writer.stop();

    expect(settings).toEqual({ approve: true, approved: [] });
    expect(generated.findings).toHaveLength(1);
  });

  test('the migration that creates the schema has nothing to say', async () => {
    const adapter = adapterIn(dir);

    await adapter.start();

    const result = await adapter.migrations.generate({ name: 'create' });

    await adapter.stop();

    // Every table it touches is one it made, indexes included: warning
    // about those is the fastest way to teach somebody to ignore the output
    expect(result.statements.length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
    expect(result.token).toBeNull();
  });

  test('generate warns and writes the file anyway', async () => {
    await created(dir);

    const adapter = adapterIn(dir, withoutCategory);

    await adapter.start();

    const result = await adapter.migrations.generate({ name: 'drop-category' });

    await adapter.stop();

    // Generating is a development act and the developer is right there:
    // what they asked for is to see it
    expect(fs.existsSync(result.file)).toBe(true);
    expect(result.findings).toEqual([
      expect.objectContaining({
        check: 'column.drop',
        column: 'category',
        table: 'tasks',
      }),
    ]);
    expect(result.token).toMatch(/^0001_drop_category:[0-9a-f]{12}$/u);
    expect(result.findings[0].fix.length).toBeGreaterThan(40);
  });

  test('status carries the review of what is pending, before the deploy', async () => {
    await created(dir);

    const adapter = adapterIn(dir, withoutCategory);

    await adapter.start();
    await adapter.migrations.generate({ name: 'drop-category' });

    const status = await adapter.migrations.status();

    await adapter.stop();

    expect(status.pending).toEqual(['0001_drop_category']);
    expect(status.review).toEqual([
      expect.objectContaining({ approved: false, tag: '0001_drop_category' }),
    ]);
  });

  test('a production migrate refuses, and applies nothing at all', async () => {
    await created(dir);

    const writer = adapterIn(dir, withoutCategory);

    await writer.start();

    const { token } = await writer.migrations.generate({
      name: 'drop-category',
    });

    await writer.stop();

    const adapter = adapterIn(dir, withoutCategory, { production: true });

    await adapter.start();

    const failure = await adapter.migrations.migrate().catch((error) => error);
    const after = await adapter.migrations.status();

    await adapter.stop();

    expect(failure.code).toBe('HENRI_MIGRATION_UNREVIEWED');
    expect(failure.hint).toContain(token);
    expect(failure.tag).toBe('0001_drop_category');
    // The command line prints one line and one instruction per finding
    expect(failure.problems).toEqual([
      {
        hint: expect.stringContaining('Ship the code'),
        message: expect.stringContaining('column.drop tasks.category'),
      },
    ]);
    // Nothing ran
    expect(after.pending).toEqual(['0001_drop_category']);
  });

  test('the token in migrations.approved lets it through', async () => {
    await created(dir);

    const writer = adapterIn(dir, withoutCategory);

    await writer.start();

    const { token } = await writer.migrations.generate({
      name: 'drop-category',
    });

    await writer.stop();

    const adapter = adapterIn(dir, withoutCategory, {
      migrations: { approved: [token] },
      production: true,
    });

    await adapter.start();

    const result = await adapter.migrations.migrate();
    const status = await adapter.migrations.status();

    await adapter.stop();

    expect(result.applied).toEqual(['0001_drop_category']);
    expect(status.pending).toEqual([]);
  });

  test('a token that names another migration is not this one', async () => {
    await created(dir);

    const writer = adapterIn(dir, withoutCategory);

    await writer.start();
    await writer.migrations.generate({ name: 'drop-category' });
    await writer.stop();

    const adapter = adapterIn(dir, withoutCategory, {
      migrations: { approved: ['0009_something:abcdef012345'] },
      production: true,
    });

    await adapter.start();

    const failure = await adapter.migrations.migrate().catch((error) => error);

    await adapter.stop();

    expect(failure.code).toBe('HENRI_MIGRATION_UNREVIEWED');
  });

  test('approve: false is the way out, and it is a configuration', async () => {
    await created(dir);

    const writer = adapterIn(dir, withoutCategory);

    await writer.start();
    await writer.migrations.generate({ name: 'drop-category' });
    await writer.stop();

    const adapter = adapterIn(dir, withoutCategory, {
      migrations: { approve: false },
      production: true,
    });

    await adapter.start();

    const result = await adapter.migrations.migrate();

    await adapter.stop();

    expect(result.applied).toEqual(['0001_drop_category']);
  });

  test('outside production it says the same thing and applies', async () => {
    await created(dir);

    const writer = adapterIn(dir, withoutCategory);

    await writer.start();
    await writer.migrations.generate({ name: 'drop-category' });
    await writer.stop();

    const adapter = adapterIn(dir, withoutCategory);

    await adapter.start();

    const result = await adapter.migrations.migrate();

    await adapter.stop();

    expect(result.applied).toEqual(['0001_drop_category']);
    expect(
      adapter.henri.calls.filter(
        ([level, , message]) =>
          level === 'warn' && String(message).includes('column.drop')
      )
    ).toHaveLength(1);
  });

  test('a migration nobody has anything to say about needs no token', async () => {
    await created(dir);

    const writer = adapterIn(dir, {
      ...taskModel.schema,
      note: { type: 'string' },
    });

    await writer.start();

    const generated = await writer.migrations.generate({ name: 'note' });

    await writer.stop();

    const adapter = adapterIn(
      dir,
      { ...taskModel.schema, note: { type: 'string' } },
      { production: true }
    );

    await adapter.start();

    const result = await adapter.migrations.migrate();

    await adapter.stop();

    expect(generated.findings).toEqual([]);
    expect(result.applied).toEqual(['0001_note']);
  });
});
