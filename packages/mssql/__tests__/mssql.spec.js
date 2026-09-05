const Sql = require('@usehenri/sequelize');
const MsSQL = require('../index');

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

describe('mssql database adapter', () => {
  test('extends the shared sequelize adapter', () => {
    const henri = fakeHenri();
    const store = new MsSQL(
      'default',
      { adapter: 'mssql', url: 'mssql://user:pass@db.local:1434/henri' },
      henri
    );

    expect(store).toBeInstanceOf(Sql);
    expect(store.adapterName).toBe('mssql');
    expect(henri.calls).toEqual([]);
  });

  test('builds a mssql connector from the url', () => {
    const store = new MsSQL(
      'default',
      { adapter: 'mssql', url: 'mssql://user:pass@db.local:1434/henri' },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('mssql');
    expect(store.connector.config).toMatchObject({
      database: 'henri',
      host: 'db.local',
      password: 'pass',
      port: '1434',
      username: 'user',
    });
    expect(store.connector.options.dialectModulePath).toBe(
      require.resolve('tedious')
    );
  });

  test('builds a connector from host, database and credentials', () => {
    const store = new MsSQL(
      'default',
      { database: 'henri', host: 'db.local', password: 'pass', username: 'u' },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('mssql');
    expect(store.connector.config).toMatchObject({
      database: 'henri',
      host: 'db.local',
    });
  });

  test('forwards extra store options to sequelize and logs through debug', () => {
    const store = new MsSQL(
      'default',
      {
        adapter: 'mssql',
        dialectOptions: { options: { encrypt: true } },
        url: 'mssql://user:pass@db.local/henri',
      },
      fakeHenri()
    );
    const quiet = new MsSQL(
      'quiet',
      { logging: false, url: 'mssql://user:pass@db.local/henri' },
      fakeHenri()
    );

    expect(store.connector.options.dialectOptions).toEqual({
      options: { encrypt: true },
    });
    expect(typeof store.connector.options.logging).toBe('function');
    expect(store.connector.options.adapter).toBeUndefined();
    expect(quiet.connector.options.logging).toBe(false);
  });

  test('throws after a fatal on a missing url', () => {
    const henri = fakeHenri();

    expect(() => new MsSQL('default', { adapter: 'mssql' }, henri)).toThrow(
      'Missing url (or host and database) in store default'
    );
    expect(henri.calls).toEqual([
      ['fatal', 'mssql', 'Missing url (or host and database) in store default'],
    ]);
  });

  test('generates mssql DDL for the henri model format', () => {
    const store = new MsSQL(
      'default',
      { url: 'mssql://user:pass@db.local/henri' },
      fakeHenri({ baseRole: 'member' })
    );
    const Task = store.addModel(taskModel, 'user');
    const User = store.addModel(
      { globalId: 'User', identity: 'user', schema: { name: 'string' } },
      'user'
    );
    const tasks = ddl(store, Task);
    const users = ddl(store, User);

    expect(tasks).toContain(
      "IF OBJECT_ID('[Tasks]', 'U') IS NULL CREATE TABLE"
    );
    // No ENUM on mssql: a string validated with isIn
    expect(tasks).toContain("[category] NVARCHAR(255) DEFAULT N'low'");
    expect(Task.rawAttributes.category.validate).toEqual({
      isIn: [['urgent', 'high', 'medium', 'low']],
    });
    expect(tasks).toContain('[done] BIT DEFAULT 0');
    expect(tasks).toContain('[name] NVARCHAR(255) NOT NULL');
    expect(tasks).toContain('[createdAt] DATETIMEOFFSET NOT NULL');

    expect(users).toContain('[email] NVARCHAR(255) NOT NULL UNIQUE');
    expect(users).toContain('[password] NVARCHAR(255) NOT NULL');
    // No JSON type on mssql: TEXT with a JSON getter and setter
    expect(users).toContain(`[roles] NVARCHAR(MAX) DEFAULT N'["member"]'`);

    const user = User.build({ email: 'a@b.io', password: 'x' });

    expect(user.roles).toEqual(['member']);
    expect(user.getDataValue('roles')).toBe('["member"]');
    user.roles = 'admin';
    expect(user.getDataValue('roles')).toBe('["admin"]');
    expect(user.roles).toEqual(['admin']);
  });
});
