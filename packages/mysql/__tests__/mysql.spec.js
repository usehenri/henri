const Sql = require('@usehenri/sequelize');
const MySQL = require('../index');

/**
 * Builds a minimal henri stand-in for the adapter
 *
 * @param {object} [settings={}] configuration values
 * @returns {object} fake henri
 */
const fakeHenri = (settings = {}) => {
  const calls = [];
  const pen = {};

  ['error', 'fatal', 'info', 'warn'].forEach((level) => {
    pen[level] = (...args) => calls.push([level, ...args]);
  });

  return {
    _user: null,
    calls,
    config: {
      get: (key) => settings[key],
      has: (key) => typeof settings[key] !== 'undefined',
    },
    pen,
    user: { encrypt: async (password) => `hashed:${password}` },
  };
};

/**
 * Generates the CREATE TABLE statement of a model, without a server
 *
 * @param {Sql} adapter The adapter
 * @param {object} Model A Sequelize model
 * @returns {string} The DDL
 */
const ddl = (adapter, Model) => {
  const { queryGenerator } = adapter.connector.getQueryInterface();
  const table = Model.getTableName();
  const attributes = Object.keys(Model.tableAttributes).reduce((all, key) => {
    all[key] = adapter.connector.normalizeAttribute(Model.tableAttributes[key]);

    return all;
  }, {});

  return queryGenerator.createTableQuery(
    table,
    queryGenerator.attributesToSQL(attributes, {
      context: 'createTable',
      table,
    }),
    { uniqueKeys: Model.uniqueKeys }
  );
};

const taskModel = {
  globalId: 'Task',
  identity: 'task',
  options: { timestamps: true },
  schema: {
    category: {
      default: 'low',
      enum: ['urgent', 'high', 'medium', 'low'],
      type: 'string',
    },
    done: { default: false, type: 'boolean' },
    name: { required: true, type: 'string' },
  },
};

describe('mysql database adapter', () => {
  test('extends the shared sequelize adapter', () => {
    const henri = fakeHenri();
    const store = new MySQL(
      'default',
      { adapter: 'mysql', url: 'mysql://user:pass@db.local:3307/henri' },
      henri
    );

    expect(store).toBeInstanceOf(Sql);
    expect(store.adapterName).toBe('mysql');
    expect(store.name).toBe('default');
    expect(henri.calls).toEqual([]);
  });

  test('builds a mysql connector from the url', () => {
    const store = new MySQL(
      'default',
      { adapter: 'mysql', url: 'mysql://user:pass@db.local:3307/henri' },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('mysql');
    expect(store.connector.config).toMatchObject({
      database: 'henri',
      host: 'db.local',
      password: 'pass',
      port: '3307',
      username: 'user',
    });
    expect(store.connector.options.dialectModulePath).toBe(
      require.resolve('mysql2')
    );
  });

  test('builds a connector from host, database and credentials', () => {
    const store = new MySQL(
      'default',
      { database: 'henri', host: 'db.local', password: 'pass', username: 'u' },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('mysql');
    expect(store.connector.config).toMatchObject({
      database: 'henri',
      host: 'db.local',
      password: 'pass',
      username: 'u',
    });
  });

  test('serves mariadb urls with the mysql2 driver', () => {
    const store = new MySQL(
      'maria',
      { adapter: 'mariadb', url: 'mariadb://user:pass@db.local/henri' },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('mysql');
    expect(store.connector.config.database).toBe('henri');
  });

  test('forwards extra store options to sequelize and logs through debug', () => {
    const store = new MySQL(
      'default',
      {
        adapter: 'mysql',
        pool: { max: 3 },
        session: { tableName: 'x' },
        url: 'mysql://user:pass@db.local/henri',
      },
      fakeHenri()
    );
    const quiet = new MySQL(
      'quiet',
      { logging: false, url: 'mysql://user:pass@db.local/henri' },
      fakeHenri()
    );

    expect(store.connector.options.pool.max).toBe(3);
    expect(typeof store.connector.options.logging).toBe('function');
    expect(store.connector.options.adapter).toBeUndefined();
    expect(store.connector.options.session).toBeUndefined();
    expect(quiet.connector.options.logging).toBe(false);
  });

  test('throws after a fatal on a missing url', () => {
    const henri = fakeHenri();

    expect(() => new MySQL('default', { adapter: 'mysql' }, henri)).toThrow(
      'Missing url (or host and database) in store default'
    );
    expect(henri.calls).toEqual([
      ['fatal', 'mysql', 'Missing url (or host and database) in store default'],
    ]);
  });

  test('generates mysql DDL for the henri model format', () => {
    const store = new MySQL(
      'default',
      { url: 'mysql://user:pass@db.local/henri' },
      fakeHenri({ baseRole: 'member' })
    );
    const Task = store.addModel(taskModel, 'user');
    const User = store.addModel(
      { globalId: 'User', identity: 'user', schema: { name: 'string' } },
      'user'
    );
    const tasks = ddl(store, Task);
    const users = ddl(store, User);

    expect(tasks).toContain('CREATE TABLE IF NOT EXISTS `Tasks`');
    expect(tasks).toContain(
      "`category` ENUM('urgent', 'high', 'medium', 'low') DEFAULT 'low'"
    );
    expect(tasks).toContain('`done` TINYINT(1) DEFAULT false');
    expect(tasks).toContain('`name` VARCHAR(255) NOT NULL');
    expect(tasks).toContain('`createdAt` DATETIME NOT NULL');

    expect(users).toContain('`email` VARCHAR(255) NOT NULL UNIQUE');
    expect(users).toContain('`password` VARCHAR(255) NOT NULL');
    // MySQL refuses literal defaults on JSON columns: the default is applied
    // by the model and the getter maps NULL to []
    expect(users).toContain('`roles` JSON,');
    expect(User.build({ email: 'a@b.io', password: 'x' }).roles).toEqual([
      'member',
    ]);
    expect(
      User.build({ email: 'a@b.io', password: 'x', roles: null }).roles
    ).toEqual([]);
  });
});
