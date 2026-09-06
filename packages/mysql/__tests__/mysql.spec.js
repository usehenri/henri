const path = require('path');
const Drizzle = require('@usehenri/drizzle');
// The target of the shared suite: sqlite unless HENRI_TEST_MYSQL_URL
// points at a server, in which case the live half of this suite runs
const {
  fakeHenri,
  target,
  taskModel,
  userModel,
} = require('@usehenri/drizzle/__tests__/helpers');
const MySQL = require('../index');

/**
 * What `@usehenri/mysql` is: `@usehenri/drizzle` with the dialect and the
 * driver chosen. The model API, the schema format, the migrations and the
 * session store are Drizzle's and are covered by that package's suites, on
 * sqlite offline and on this same server with `HENRI_TEST_MYSQL_URL`. What
 * is only true here is the choosing: the dialect this adapter fixes, the
 * driver it brings, and that a store naming it reaches a real server.
 */

const url = 'mysql://user:pass@db.local:3307/henri';

describe('mysql database adapter', () => {
  test('is the drizzle adapter with the mysql dialect chosen', () => {
    const henri = fakeHenri();
    const store = new MySQL('default', { adapter: 'mysql', url }, henri);

    expect(store).toBeInstanceOf(Drizzle);
    expect(store.adapterName).toBe('mysql');
    expect(store.dialect.name).toBe('mysql');
    expect(henri.calls).toEqual([]);
  });

  test('serves a mariadb store, which is the same adapter', () => {
    const store = new MySQL(
      'default',
      { adapter: 'mariadb', url: 'mariadb://user:pass@db.local/henri' },
      fakeHenri()
    );

    expect(store.dialect.name).toBe('mysql');
  });

  test('the adapter decides the dialect, not the store configuration', () => {
    const store = new MySQL(
      'default',
      { adapter: 'mysql', dialect: 'postgres', url },
      fakeHenri()
    );

    expect(store.dialect.name).toBe('mysql');
  });

  test('brings its own driver, so the application declares none', () => {
    const store = new MySQL('default', { url }, fakeHenri());

    expect(store.driverPaths).toEqual([
      path.dirname(require.resolve('../index')),
    ]);
    expect(() =>
      require.resolve('mysql2/promise', { paths: store.driverPaths })
    ).not.toThrow();
  });

  test('throws after a fatal on a missing url', () => {
    const henri = fakeHenri();

    expect(() => new MySQL('default', { adapter: 'mysql' }, henri)).toThrow(
      'Missing url (or host and database) in store default'
    );
    expect(henri.calls).toEqual([
      [
        'fatal',
        'mysql',
        'Missing url (or host and database) in store default',
        null,
        null,
        'HENRI_STORE_URL_MISSING',
      ],
    ]);
  });

  test('accepts host, database and credentials instead of a url', () => {
    const store = new MySQL(
      'default',
      { database: 'henri', host: 'db.local', password: 'pass', username: 'u' },
      fakeHenri()
    );

    expect(store.dialect.describe(store.config)).toBe('db.local/henri');
  });
});

describe.runIf(target.live && target.name === 'mysql')('mysql server', () => {
  let store;
  let Task;
  let User;

  beforeAll(async () => {
    const { url: server } = target.store();

    store = target.prepare(
      new MySQL(
        'default',
        { adapter: 'mysql', url: server },
        fakeHenri({ baseRole: 'member' })
      )
    );
    Task = store.addModel(taskModel, 'user');
    User = store.addModel(userModel, 'user');
    await store.start();
  });

  afterAll(async () => {
    await store.stop();
    await target.cleanup();
  });

  test('connects and pushes the henri model format', async () => {
    expect(store.adapterName).toBe('mysql');
    await expect(store.ping()).resolves.toBe(true);

    const columns = await store.query(
      `SELECT column_name AS name, data_type AS type, is_nullable AS nullable
         FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'tasks'`
    );
    const byName = Object.fromEntries(
      columns.map((column) => [column.name || column.NAME, column])
    );

    expect(byName.name).toBeDefined();
    expect(byName.done).toBeDefined();
  });

  test('stores the user model and refuses a duplicate email', async () => {
    const user = await User.create({
      email: ' Grace@UseHenri.io ',
      name: 'Grace',
      password: 'compiler-1952',
    });

    expect(user.email).toBe('grace@usehenri.io');
    // The hash is `select: false`: it is never on an instance a read hands
    // back, only where the framework asks for it by name
    expect(user.password).toBeUndefined();
    expect(user.roles).toEqual(['member']);

    await expect(
      User.create({ email: 'GRACE@usehenri.io', password: 'other' })
    ).rejects.toThrow();
    expect((await store.findUserByEmail('grace@usehenri.io')).password).toBe(
      'hashed:compiler-1952'
    );
  });

  test('rolls a transaction back', async () => {
    await expect(
      store.transaction(async () => {
        await Task.create({ name: 'rolled back' });
        expect(await Task.count()).toBe(1);

        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(await Task.count()).toBe(0);
  });
});
