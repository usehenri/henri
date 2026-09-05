const Sql = require('@usehenri/sequelize');
// The target of the shared suite: sqlite unless HENRI_TEST_POSTGRES_URL
// points at a server, in which case this suite runs on it too
const target = require('@usehenri/sequelize/__tests__/targets');
const Postgresql = require('../index');

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

describe('postgresql database adapter', () => {
  test('extends the shared sequelize adapter', () => {
    const henri = fakeHenri();
    const store = new Postgresql(
      'default',
      {
        adapter: 'postgresql',
        url: 'postgres://user:pass@db.local:5433/henri',
      },
      henri
    );

    expect(store).toBeInstanceOf(Sql);
    expect(store.adapterName).toBe('postgresql');
    expect(henri.calls).toEqual([]);
  });

  test('builds a postgres connector from the url', () => {
    const store = new Postgresql(
      'default',
      {
        adapter: 'postgresql',
        url: 'postgres://user:pass@db.local:5433/henri',
      },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('postgres');
    expect(store.connector.config).toMatchObject({
      database: 'henri',
      host: 'db.local',
      password: 'pass',
      port: '5433',
      username: 'user',
    });
    expect(store.connector.options.dialectModulePath).toBe(
      require.resolve('pg')
    );
  });

  test('builds a connector from host, database and credentials', () => {
    const store = new Postgresql(
      'default',
      { database: 'henri', host: 'db.local', password: 'pass', username: 'u' },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('postgres');
    expect(store.connector.config).toMatchObject({
      database: 'henri',
      host: 'db.local',
    });
  });

  test('forwards extra store options to sequelize and logs through debug', () => {
    const store = new Postgresql(
      'default',
      {
        adapter: 'postgresql',
        pool: { max: 3 },
        url: 'postgres://user:pass@db.local/henri',
      },
      fakeHenri()
    );
    const quiet = new Postgresql(
      'quiet',
      { logging: false, url: 'postgres://user:pass@db.local/henri' },
      fakeHenri()
    );

    expect(store.connector.options.pool.max).toBe(3);
    expect(typeof store.connector.options.logging).toBe('function');
    expect(store.connector.options.adapter).toBeUndefined();
    expect(quiet.connector.options.logging).toBe(false);
  });

  test('throws after a fatal on a missing url', () => {
    const henri = fakeHenri();

    expect(
      () => new Postgresql('default', { adapter: 'postgresql' }, henri)
    ).toThrow('Missing url (or host and database) in store default');
    expect(henri.calls).toEqual([
      [
        'fatal',
        'postgresql',
        'Missing url (or host and database) in store default',
      ],
    ]);
  });

  test('generates postgres DDL for the henri model format', () => {
    const store = new Postgresql(
      'default',
      { url: 'postgres://user:pass@db.local/henri' },
      fakeHenri({ baseRole: 'member' })
    );
    const Task = store.addModel(taskModel, 'user');
    const User = store.addModel(
      { globalId: 'User', identity: 'user', schema: { name: 'string' } },
      'user'
    );
    const tasks = ddl(store, Task);
    const users = ddl(store, User);

    expect(tasks).toContain('CREATE TABLE IF NOT EXISTS "Tasks"');
    expect(tasks).toContain(
      `"category" "public"."enum_Tasks_category" DEFAULT 'low'`
    );
    expect(tasks).toContain('"done" BOOLEAN DEFAULT false');
    expect(tasks).toContain('"name" VARCHAR(255) NOT NULL');
    expect(tasks).toContain('"createdAt" TIMESTAMP WITH TIME ZONE NOT NULL');

    expect(users).toContain('"email" VARCHAR(255) NOT NULL UNIQUE');
    expect(users).toContain('"password" VARCHAR(255) NOT NULL');
    expect(users).toContain(`"roles" JSON DEFAULT '["member"]'`);
    expect(User.build({ email: 'a@b.io', password: 'x' }).roles).toEqual([
      'member',
    ]);
  });
});

describe.runIf(target.live && target.name === 'postgres')(
  'postgresql server',
  () => {
    let store;
    let Task;
    let User;

    beforeAll(async () => {
      store = target.prepare(
        new Postgresql(
          'default',
          target.store(),
          fakeHenri({ baseRole: 'member' })
        )
      );
      Task = store.addModel(taskModel, 'user');
      User = store.addModel(
        { globalId: 'User', identity: 'user', schema: { name: 'string' } },
        'user'
      );
      await store.start();
    });

    afterAll(async () => {
      await store.stop();
      await target.cleanup();
    });

    test('connects and syncs the henri model format', async () => {
      expect(store.adapterName).toBe('postgresql');
      await expect(store.ping()).resolves.toBe(true);

      const columns = await store.query(
        `SELECT column_name AS name, data_type AS type, udt_name AS udt,
                is_nullable AS nullable
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = :table`,
        { table: 'Tasks' },
        { type: Sql.Sequelize.QueryTypes.SELECT }
      );
      const byName = Object.fromEntries(
        columns.map((column) => [column.name, column])
      );

      expect(byName.id.type).toBe('integer');
      expect(byName.name).toMatchObject({
        nullable: 'NO',
        type: 'character varying',
      });
      expect(byName.done.type).toBe('boolean');
      expect(byName.createdAt.type).toBe('timestamp with time zone');
      // The enum is a type of its own, unlike the mysql column type
      expect(byName.category).toMatchObject({
        type: 'USER-DEFINED',
        udt: 'enum_Tasks_category',
      });

      const labels = await store.query(
        `SELECT unnest(enum_range(NULL::"enum_Tasks_category"))::text AS label`,
        [],
        { type: Sql.Sequelize.QueryTypes.SELECT }
      );

      expect(labels.map((row) => row.label)).toEqual([
        'urgent',
        'high',
        'medium',
        'low',
      ]);
      await expect(
        Task.create({ category: 'nope', name: 'x' })
      ).rejects.toThrow(/invalid input value for enum/);
    });

    test('stores the user model and refuses a duplicate email', async () => {
      const user = await User.create({
        email: ' Grace@UseHenri.io ',
        name: 'Grace',
        password: 'compiler-1952',
      });

      expect(user.email).toBe('grace@usehenri.io');
      expect(user.password).toBe('hashed:compiler-1952');
      expect(user.roles).toEqual(['member']);

      await expect(
        User.create({ email: 'GRACE@usehenri.io', password: 'other' })
      ).rejects.toThrow(/SequelizeUniqueConstraintError|Validation error/);

      const [[row]] = await store.query(
        'SELECT roles FROM "Users" WHERE email = ?',
        ['grace@usehenri.io']
      );

      // A json column comes back parsed on postgres
      expect(row.roles).toEqual(['member']);
      expect((await store.findUserByEmail('grace@usehenri.io')).password).toBe(
        'hashed:compiler-1952'
      );
    });

    test('rolls a transaction back', async () => {
      await expect(
        store.transaction(async (transaction) => {
          await Task.create({ name: 'rolled back' }, { transaction });
          expect(await Task.count({ transaction })).toBe(1);

          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      expect(await Task.count()).toBe(0);
    });
  }
);
