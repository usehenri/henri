const session = require('express-session');
const Sql = require('../index');
const { redact } = require('../utils');

const { DataTypes, QueryTypes } = Sql.Sequelize;

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
    user: {
      encrypt: async (password) => `hashed:${password}`,
    },
  };
};

/**
 * Builds an adapter backed by an in-memory sqlite database
 *
 * @param {object} [settings={}] configuration values
 * @param {object} [config={}] extra store configuration
 * @returns {{ adapter: Sql, henri: object }} adapter and its fake henri
 */
const build = (settings = {}, config = {}) => {
  const henri = fakeHenri(settings);
  const adapter = new Sql(
    'default',
    { dialect: 'sqlite', storage: ':memory:', ...config },
    henri
  );

  return { adapter, henri };
};

// The model scaffolded by `henri new`, in the henri format
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
  store: 'default',
};

const userModel = {
  globalId: 'User',
  identity: 'user',
  options: { timestamps: true },
  schema: { name: { type: 'string' } },
};

/**
 * Promisified express-session store calls
 *
 * @param {object} store A session store
 * @returns {object} set, get and destroy returning promises
 */
const sessions = (store) => ({
  destroy: (sid) =>
    new Promise((resolve, reject) =>
      store.destroy(sid, (error) => (error ? reject(error) : resolve()))
    ),
  get: (sid) =>
    new Promise((resolve, reject) =>
      store.get(sid, (error, data) => (error ? reject(error) : resolve(data)))
    ),
  set: (sid, data) =>
    new Promise((resolve, reject) =>
      store.set(sid, data, (error) => (error ? reject(error) : resolve()))
    ),
});

describe('sequelize adapter', () => {
  describe('constructor', () => {
    test('builds the connector from the configuration', () => {
      const { adapter } = build({}, { pool: { max: 3 } });

      expect(adapter.adapterName).toBe('sqlite');
      expect(adapter.connector.getDialect()).toBe('sqlite');
      expect(adapter.connector.options.pool.max).toBe(3);
      expect(adapter.connector.options.adapter).toBeUndefined();
      expect(adapter.connector.options.session).toBeUndefined();
    });

    test('logs queries through debug unless configured', () => {
      const { adapter } = build();
      const { adapter: quiet } = build({}, { logging: false });

      expect(typeof adapter.connector.options.logging).toBe('function');
      // eslint-disable-next-line no-console
      expect(adapter.connector.options.logging).not.toBe(console.log);
      expect(quiet.connector.options.logging).toBe(false);
    });

    test('throws after logging a fatal when nothing is configured', () => {
      const henri = fakeHenri();

      expect(() => new Sql('broken', {}, henri)).toThrow(
        'Missing url (or host and database) in store broken'
      );
      expect(henri.calls).toContainEqual([
        'fatal',
        'sequelize',
        'Missing url (or host and database) in store broken',
      ]);
    });

    test('accepts host, database and credentials instead of a url', () => {
      const adapter = new Sql(
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

      expect(adapter.connector.config).toMatchObject({
        database: 'henri',
        host: 'db.local',
        password: 'secret',
        port: 5433,
        username: 'felix',
      });
    });

    test('redacts credentials from debug output', () => {
      expect(
        redact({
          auth: { password: 'p', username: 'u' },
          opts: { pass: 'p', user: 'u' },
          password: 'secret',
          url: 'postgres://felix:secret@db.local:5432/henri',
        })
      ).toEqual({
        auth: '***',
        opts: { pass: '***', user: 'u' },
        password: '***',
        url: 'postgres://felix:***@db.local:5432/henri',
      });
    });
  });

  describe('models', () => {
    let adapter;
    let henri;
    let Task;

    beforeAll(async () => {
      ({ adapter, henri } = build());
      Task = adapter.addModel(taskModel, 'user');
      adapter.addModel(
        {
          globalId: 'Note',
          identity: 'note',
          name: 'my_notes',
          schema: { body: 'text' },
        },
        'user'
      );
      await adapter.start();
    });

    afterAll(async () => {
      await adapter.stop();
    });

    test('registers models and syncs their tables', async () => {
      const tables = await adapter.connector
        .getQueryInterface()
        .showAllTables();

      expect(Object.keys(adapter.getModels())).toEqual(['Task', 'Note']);
      expect(tables).toEqual(expect.arrayContaining(['Tasks', 'my_notes']));
      expect(henri._user).toBeNull();
    });

    test('boots the scaffolded model with defaults, required and enum', async () => {
      const task = await Task.create({ name: 'write docs' });

      expect(task.category).toBe('low');
      expect(task.done).toBe(false);
      expect((await Task.findAll()).map((row) => row.name)).toEqual([
        'write docs',
      ]);
      await expect(Task.create({})).rejects.toThrow(/notNull Violation/);
      await expect(
        Task.create({ category: 'nope', name: 'x' })
      ).rejects.toThrow(/isIn/);
    });

    test('exposes ping, query and transaction', async () => {
      await expect(adapter.ping()).resolves.toBe(true);
      await expect(
        adapter.query('SELECT COUNT(*) AS total FROM Tasks WHERE name = ?', [
          'write docs',
        ])
      ).resolves.toEqual([[{ total: 1 }], expect.anything()]);
      await expect(
        adapter.query('SELECT name FROM Tasks', [], {
          type: QueryTypes.SELECT,
        })
      ).resolves.toEqual([{ name: 'write docs' }]);
      await expect(
        adapter.transaction((transaction) => Task.count({ transaction }))
      ).resolves.toBe(1);
    });
  });

  describe('associations', () => {
    test('calls associate(models) once every model exists, before sync', async () => {
      const { adapter } = build();
      const calls = [];

      adapter.addModel(
        {
          /**
           * Links posts to their author
           *
           * @param {object} models The store models
           * @returns {void}
           */
          associate(models) {
            calls.push(Object.keys(models));
            models.Post.belongsTo(models.Author);
            models.Author.hasMany(models.Post);
          },
          globalId: 'Post',
          identity: 'post',
          schema: { title: 'string' },
        },
        'user'
      );
      adapter.addModel(
        { globalId: 'Author', identity: 'author', schema: { name: 'string' } },
        'user'
      );

      await adapter.start();

      const { Author, Post } = adapter.getModels();
      const author = await Author.create({ name: 'Henri' });

      await Post.create({ AuthorId: author.id, title: 'Jazz' });

      const posts = await Post.findAll({ include: Author });

      expect(calls).toEqual([['Post', 'Author']]);
      expect(Object.keys(Post.rawAttributes)).toContain('AuthorId');
      expect(posts[0].Author.name).toBe('Henri');

      await adapter.stop();
    });
  });

  describe('user model', () => {
    let adapter;
    let henri;
    let User;

    beforeAll(async () => {
      ({ adapter, henri } = build({ baseRole: 'member' }));
      User = adapter.addModel(userModel, 'user');
      await adapter.start();
    });

    afterAll(async () => {
      await adapter.stop();
    });

    test('flags the user model on henri', () => {
      expect(henri._user).toBe(User);
      expect(henri.calls).toContainEqual([
        'info',
        'sqlite',
        'basic user role',
        ['member'],
      ]);
    });

    test('requires email and password', async () => {
      await expect(User.create({ name: 'nobody' })).rejects.toThrow(
        /notNull Violation/
      );
    });

    test('stores emails lowercased and trimmed, hashes the password', async () => {
      const user = await User.create({
        email: '  Felix@UseHenri.IO ',
        name: 'felix',
        password: 'secret',
      });

      expect(user.email).toBe('felix@usehenri.io');
      expect(user.password).toBe('hashed:secret');
      expect(user.roles).toEqual(['member']);
    });

    test('rejects duplicate (mixed-case) and invalid emails', async () => {
      await expect(
        User.create({ email: 'FELIX@usehenri.io', password: 'secret' })
      ).rejects.toThrow(/SequelizeUniqueConstraintError|Validation error/);
      await expect(
        User.create({ email: 'not-an-email', password: 'secret' })
      ).rejects.toThrow(/isEmail/);
    });

    test('does not select the password by default', async () => {
      const user = await User.findOne({
        where: { email: 'felix@usehenri.io' },
      });
      const withPassword = await User.scope('withPassword').findOne({
        where: { email: 'felix@usehenri.io' },
      });

      expect(user.password).toBeUndefined();
      expect(Object.keys(user.get({ plain: true }))).not.toContain('password');
      expect(withPassword.password).toBe('hashed:secret');
    });

    test('finds users for authentication and sessions', async () => {
      const user = await adapter.findUserByEmail(' FELIX@usehenri.io ');
      const id = adapter.userId(user);

      expect(user.password).toBe('hashed:secret');
      expect(id).toBe(String(user.id));

      const byId = await adapter.findUserById(id);

      expect(byId.email).toBe('felix@usehenri.io');
      expect(byId.password).toBeUndefined();
      expect(adapter.toPlain(user)).toEqual(
        expect.objectContaining({ email: 'felix@usehenri.io', id: user.id })
      );
      expect(adapter.toPlain(user).password).toBeUndefined();

      await expect(adapter.findUserByEmail('nobody@usehenri.io')).resolves.toBe(
        null
      );
      await expect(adapter.findUserByEmail('')).resolves.toBe(null);
      await expect(adapter.findUserById('not-a-number')).resolves.toBe(null);
      await expect(adapter.findUserById(999)).resolves.toBe(null);
      await expect(adapter.findUserById(null)).resolves.toBe(null);
    });

    test('re-encrypts the password only when it changes', async () => {
      const user = await User.findOne({
        where: { email: 'felix@usehenri.io' },
      });

      user.name = 'renamed';
      await user.save();
      expect((await adapter.findUserByEmail(user.email)).password).toBe(
        'hashed:secret'
      );

      user.password = 'other';
      await user.save();
      expect((await adapter.findUserByEmail(user.email)).password).toBe(
        'hashed:other'
      );
    });

    test('hashes passwords written in bulk', async () => {
      const [one, two] = await User.bulkCreate([
        { email: 'one@usehenri.io', password: 'one' },
        { email: 'two@usehenri.io', password: 'two' },
      ]);
      const [three] = await User.bulkCreate(
        [{ email: 'three@usehenri.io', password: 'three' }],
        { individualHooks: true }
      );

      expect([one.password, two.password, three.password]).toEqual([
        'hashed:one',
        'hashed:two',
        'hashed:three',
      ]);

      await User.update({ password: 'bulk' }, { where: { id: one.id } });
      await User.update(
        { password: 'individual' },
        { individualHooks: true, where: { id: two.id } }
      );

      expect((await adapter.findUserByEmail(one.email)).password).toBe(
        'hashed:bulk'
      );
      expect((await adapter.findUserByEmail(two.email)).password).toBe(
        'hashed:individual'
      );
    });

    test('drops roles from mass-assigned creates and updates', async () => {
      const user = await User.create({
        email: 'roles@usehenri.io',
        password: 'secret',
        roles: ['admin'],
      });

      expect(user.roles).toEqual(['member']);

      user.roles = ['admin'];
      user.name = 'still member';
      await user.save();

      await User.update(
        { name: 'bulk', roles: ['admin'] },
        {
          where: { id: user.id },
        }
      );

      const reloaded = await User.findByPk(user.id);

      expect(reloaded.roles).toEqual(['member']);
      expect(reloaded.name).toBe('bulk');

      const [bulk] = await User.bulkCreate([
        { email: 'bulk@usehenri.io', password: 'secret', roles: ['admin'] },
      ]);

      expect(bulk.roles).toEqual(['member']);
    });

    test('changes roles through setRoles or with unsafe', async () => {
      const user = await User.findOne({
        where: { email: 'roles@usehenri.io' },
      });

      await user.setRoles(['admin', 'member']);
      expect((await User.findByPk(user.id)).roles).toEqual(['admin', 'member']);

      await User.setRoles(user.id, 'editor');
      expect((await User.findByPk(user.id)).roles).toEqual(['editor']);
      await expect(User.setRoles(999, 'editor')).resolves.toBe(null);

      await User.update(
        { roles: ['bulk'] },
        {
          unsafe: true,
          where: { id: user.id },
        }
      );
      expect((await User.findByPk(user.id)).roles).toEqual(['bulk']);

      const created = await User.create(
        { email: 'unsafe@usehenri.io', password: 'secret', roles: ['root'] },
        { unsafe: true }
      );

      expect(created.roles).toEqual(['root']);
    });

    test('checks roles with hasRole', async () => {
      const user = await User.findOne({
        where: { email: 'roles@usehenri.io' },
      });

      await expect(user.hasRole('bulk')).resolves.toBe(true);
      await expect(user.hasRole(['bulk'])).resolves.toBe(true);
      await expect(user.hasRole(['bulk', 'root'])).resolves.toBe(false);
      await expect(user.hasRole()).resolves.toBe(true);
    });

    test('stores roles as JSON with the base role as default', async () => {
      expect(User.rawAttributes.roles.type).toBeInstanceOf(DataTypes.JSON);

      const [[row]] = await adapter.query(
        'SELECT roles FROM Users WHERE email = ?',
        ['felix@usehenri.io']
      );

      expect(JSON.parse(row.roles)).toEqual(['member']);
    });
  });

  describe('without a base role', () => {
    test('warns and defaults the roles to an empty list', async () => {
      const { adapter, henri } = build();
      const User = adapter.addModel(
        { globalId: 'User', identity: 'user', schema: {} },
        'user'
      );

      await adapter.start();

      const user = await User.create({
        email: 'code@usehenri.io',
        password: 'secret',
      });

      expect(user.roles).toEqual([]);
      await expect(user.hasRole('admin')).resolves.toBe(false);
      expect(henri.calls).toContainEqual([
        'warn',
        'sqlite',
        'no basic user role. are you sure?',
      ]);

      await adapter.stop();
    });
  });

  describe('sessions', () => {
    test('provides a ready express-session store', async () => {
      const { adapter } = build();

      adapter.addModel(userModel, 'user');
      await adapter.start();

      const store = await adapter.getSessionConnector(session);
      const api = sessions(store);

      expect(store).toBeInstanceOf(session.Store);
      expect(await adapter.getSessionConnector(session)).toBe(store);

      await api.set('sid', { cookie: { maxAge: 60000 }, user: 1 });
      await expect(api.get('sid')).resolves.toEqual({
        cookie: { maxAge: 60000 },
        user: 1,
      });
      await api.destroy('sid');
      await expect(api.get('sid')).resolves.toBeNull();

      await adapter.stop();
    });

    test('forwards the session configuration to the store', async () => {
      const { adapter } = build(
        {},
        { session: { tableName: 'henri_sessions' } }
      );

      await adapter.start();

      const store = await adapter.getSessionConnector(session.Store);
      const tables = await adapter.connector
        .getQueryInterface()
        .showAllTables();

      expect(store).toBeInstanceOf(session.Store);
      expect(tables).toContain('henri_sessions');

      await adapter.stop();
    });
  });

  describe('lifecycle', () => {
    test('start syncs the schema before resolving', async () => {
      const { adapter } = build();
      const Item = adapter.addModel(
        { globalId: 'Item', identity: 'item', schema: { name: 'string' } },
        'user'
      );

      await adapter.start();

      const tables = await adapter.connector
        .getQueryInterface()
        .showAllTables();

      expect(tables).toContain(Item.getTableName());

      await adapter.stop();
    });

    test('starts again after a stop', async () => {
      const { adapter, henri } = build({ baseRole: 'member' });
      const before = adapter.addModel(userModel, 'user');

      await adapter.start();
      await adapter.getSessionConnector(session);
      await adapter.stop();

      expect(adapter.connector).toBeNull();
      expect(adapter.getModels()).toEqual({});
      expect(adapter.sessionStore).toBeNull();

      await adapter.start();

      const { User } = adapter.getModels();

      expect(User).not.toBe(before);
      expect(henri._user).toBe(User);

      const user = await User.create({
        email: 'again@usehenri.io',
        password: 'secret',
      });

      expect(user.password).toBe('hashed:secret');
      expect(user.roles).toEqual(['member']);

      const api = sessions(await adapter.getSessionConnector(session));

      await api.set('sid', { cookie: {}, user: user.id });
      await expect(api.get('sid')).resolves.toEqual({
        cookie: {},
        user: user.id,
      });

      await adapter.stop();
    });

    test('start rejects when the connection fails', async () => {
      const adapter = new Sql(
        'broken',
        { dialect: 'sqlite', storage: '/nonexistent/dir/db.sqlite' },
        fakeHenri()
      );

      await expect(adapter.start()).rejects.toThrow();
    });
  });
});
