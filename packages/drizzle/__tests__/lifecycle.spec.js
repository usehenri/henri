const fs = require('fs');
const path = require('path');
const dialects = require('../dialects');
const { redact } = require('../utils');
const {
  Drizzle,
  build,
  fakeHenri,
  taskModel,
  tmpdir,
  userModel,
} = require('./helpers');

describe('configuration', () => {
  test('throws after logging a fatal on an unknown dialect', () => {
    const henri = fakeHenri();

    expect(() => new Drizzle('broken', { dialect: 'oracle' }, henri)).toThrow(
      "Unknown dialect 'oracle' in store broken"
    );
    expect(henri.calls[0].slice(0, 2)).toEqual(['fatal', 'drizzle']);
  });

  test('throws when postgres and mysql have no url, host or database', () => {
    const henri = fakeHenri();

    expect(() => new Drizzle('pg', { dialect: 'postgres' }, henri)).toThrow(
      'Missing url (or host and database) in store pg'
    );
    expect(() => new Drizzle('my', { dialect: 'mysql' }, henri)).toThrow(
      'Missing url (or host and database) in store my'
    );
    expect(() => new Drizzle('nothing', {}, henri)).toThrow('Unknown dialect');
  });

  test('guesses the dialect from the url and resolves aliases', () => {
    const henri = fakeHenri();
    const of = (config) => new Drizzle('x', config, henri).dialect.name;

    expect(of({ url: 'postgres://u:p@h/db' })).toBe('postgres');
    expect(of({ url: 'postgresql://u:p@h/db' })).toBe('postgres');
    expect(of({ url: 'mysql://u:p@h/db' })).toBe('mysql');
    expect(of({ url: 'mariadb://u:p@h/db' })).toBe('mysql');
    expect(of({ url: 'file:./x.db' })).toBe('sqlite');
    expect(of({ url: './x.sqlite' })).toBe('sqlite');
    expect(of({ dialect: 'postgresql', url: 'x' })).toBe('postgres');
    expect(of({ dialect: 'better-sqlite3' })).toBe('sqlite');
    expect(of({ dialect: 'sqlite' })).toBe('sqlite');
  });

  test('resolves sqlite files', () => {
    const cwd = process.cwd();

    expect(dialects.sqliteFile({})).toBe(':memory:');
    expect(dialects.sqliteFile({ url: ':memory:' })).toBe(':memory:');
    expect(dialects.sqliteFile({ url: 'file::memory:' })).toBe(':memory:');
    expect(dialects.sqliteFile({ url: 'file:.henri/app.db' })).toBe(
      path.join(cwd, '.henri/app.db')
    );
    expect(dialects.sqliteFile({ url: 'file:///tmp/abs.db' })).toBe(
      '/tmp/abs.db'
    );
    expect(dialects.sqliteFile({ url: 'sqlite://data/x.db?mode=rwc' })).toBe(
      path.join(cwd, 'data/x.db')
    );
    expect(dialects.sqliteFile({ storage: 'x.db' })).toBe(
      path.join(cwd, 'x.db')
    );
  });

  test('redacts credentials from debug output', () => {
    expect(
      redact({
        password: 'secret',
        url: 'postgres://felix:secret@db.local:5432/henri',
      })
    ).toEqual({
      password: '***',
      url: 'postgres://felix:***@db.local:5432/henri',
    });
  });
});

describe('postgres and mysql without a server', () => {
  test.each(['postgres', 'mysql'])(
    '%s compiles models and closes cleanly',
    async (name) => {
      const url =
        name === 'postgres'
          ? 'postgres://henri:secret@127.0.0.1:1/henri'
          : 'mysql://henri:secret@127.0.0.1:1/henri';
      const adapter = new Drizzle(
        'default',
        { dialect: name, url },
        fakeHenri({ baseRole: 'member' })
      );
      const Task = adapter.addModel(taskModel, 'user');
      const User = adapter.addModel(userModel, 'user');

      adapter.compile();

      expect(adapter.dialect.name).toBe(name);
      expect(adapter.tableNames()).toEqual([
        'tasks',
        'users',
        'henri_sessions',
      ]);
      expect(Task.tableName).toBe('tasks');
      expect(User.hidden).toEqual(['password']);
      expect(() => Task.table).not.toThrow();
      expect(adapter.databaseName()).toBe('henri');

      // The pools are lazy: the client exists, nothing connected
      adapter.client = await adapter.dialect.connect(adapter.config);
      adapter.db = adapter.dialect.drizzle(adapter.client, adapter.schema);
      expect(adapter.rawDatabase()).toBeDefined();
      await adapter.stop();
      expect(adapter.client).toBeNull();
    }
  );

  test('accepts host, database and credentials instead of a url', () => {
    const adapter = new Drizzle(
      'named',
      {
        database: 'henri',
        dialect: 'postgres',
        host: 'db.local',
        password: 'secret',
        port: 5433,
        username: 'felix',
      },
      fakeHenri()
    );

    expect(adapter.dialect.name).toBe('postgres');
    expect(adapter.databaseName()).toBe('henri');
    expect(adapter.dialect.describe(adapter.config)).toBe('db.local/henri');
  });
});

describe('lifecycle', () => {
  test('refuses model calls before start and after stop', async () => {
    const { adapter } = build();
    const Task = adapter.addModel(taskModel, 'user');

    await expect(Task.find()).rejects.toThrow('store default is not started');
    expect(() => Task.table).toThrow(
      "Task: the store 'default' is not started"
    );
    await expect(adapter.ping()).rejects.toThrow('is not started');
    await expect(adapter.query('SELECT 1')).rejects.toThrow('is not started');
    await adapter.stop();
    await adapter.start();
    expect(await Task.count()).toBe(0);
    await adapter.stop();
    await expect(Task.count()).rejects.toThrow('is not started');
  });

  test('stops and starts again, keeping the data of a file database', async () => {
    const dir = tmpdir();
    const { adapter } = build(
      { baseRole: 'member' },
      { url: `file:${dir}/app.db` }
    );
    const Task = adapter.addModel(taskModel, 'user');

    adapter.addModel(userModel, 'user');

    try {
      await adapter.start();
      expect(adapter.timings.push).toEqual(expect.any(Number));
      expect(adapter.timings.start).toBeGreaterThanOrEqual(
        adapter.timings.push
      );
      await Task.create({ name: 'persisted' });
      await adapter.stop();
      expect(adapter.started).toBe(false);
      expect(fs.existsSync(path.join(dir, 'app.db'))).toBe(true);

      await adapter.start();
      expect((await Task.find()).map((task) => task.name)).toEqual([
        'persisted',
      ]);
      expect(await adapter.listTables()).toEqual(
        expect.arrayContaining(['tasks', 'users', 'henri_sessions'])
      );
      await adapter.stop();
    } finally {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  test('skips the sync with sync: false or HENRI_SKIP_SYNC', async () => {
    const { adapter } = build({}, { sync: false });

    adapter.addModel(taskModel, 'user');
    await adapter.start();
    expect(await adapter.listTables()).toEqual([]);
    await adapter.stop();

    process.env.HENRI_SKIP_SYNC = '1';

    try {
      const { adapter: skipped } = build();

      skipped.addModel(taskModel, 'user');
      await skipped.start();
      expect(await skipped.listTables()).toEqual([]);
      await skipped.stop();
    } finally {
      delete process.env.HENRI_SKIP_SYNC;
    }
  });

  test('in production logs the pending migrations instead of pushing', async () => {
    const henri = fakeHenri({ baseRole: 'member' });

    henri.isProduction = true;

    const adapter = new Drizzle(
      'default',
      { dialect: 'sqlite', url: ':memory:' },
      henri
    );

    adapter.addModel(taskModel, 'user');
    await adapter.start();
    expect(await adapter.listTables()).toEqual([]);
    expect(henri.calls.filter((call) => call[0] === 'warn')).toEqual([]);
    await adapter.stop();
  });

  test('calls associate(models) once, even across restarts', async () => {
    const { adapter } = build();
    const calls = [];

    adapter.addModel(
      {
        /**
         * Records the call
         *
         * @param {object} models The models
         * @returns {void}
         */
        associate: (models) => calls.push(Object.keys(models)),
        globalId: 'Post',
        identity: 'post',
        schema: { title: 'string' },
      },
      'user'
    );
    adapter.addModel(
      { globalId: 'User', identity: 'user', schema: {} },
      'user'
    );

    await adapter.start();
    await adapter.stop();
    await adapter.start();
    await adapter.stop();
    expect(calls).toEqual([['Post', 'User']]);
  });
});
