const session = require('express-session');
const Sql = require('../index');
const { redact } = require('../utils');
const {
  build,
  fakeHenri,
  sessions,
  target,
  taskModel,
  userModel,
} = require('./helpers');

const { DataTypes, QueryTypes } = Sql.Sequelize;

// Raw queries need the identifiers quoted the way the target does
const tasks = target.quote('Tasks');
const users = target.quote('Users');

// How a bad enum value is refused: sqlite validates it in the model, the
// dialects with a native ENUM column let the server refuse the value
const ENUM_ERROR = {
  mysql: /Data truncated for column 'category'|CHECK constraint/,
  postgres: /invalid input value for enum/,
  sqlite: /isIn/,
};

/**
 * A JSON column, read back (a string on sqlite, parsed elsewhere)
 *
 * @param {*} value The value the driver answered
 * @returns {*} The parsed value
 */
const asJson = (value) =>
  typeof value === 'string' ? JSON.parse(value) : value;

describe('sequelize adapter', () => {
  describe('constructor', () => {
    test('builds the connector from the configuration', () => {
      const { adapter } = build({}, { pool: { max: 3 } });

      expect(adapter.adapterName).toBe(target.name);
      expect(adapter.connector.getDialect()).toBe(target.name);
      expect(adapter.connector.options.pool.max).toBe(3);
      expect(adapter.connector.options.adapter).toBeUndefined();
      expect(adapter.connector.options.session).toBeUndefined();
    });

    test('logs queries through debug unless configured', () => {
      const { adapter } = build();
      const { adapter: quiet } = build({}, { logging: false });

      expect(typeof adapter.connector.options.logging).toBe('function');

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
        null,
        null,
        'HENRI_STORE_URL_MISSING',
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
      // The dialects with a native ENUM check the value themselves
      await expect(
        Task.create({ category: 'nope', name: 'x' })
      ).rejects.toThrow(ENUM_ERROR[target.name]);
    });

    test('exposes ping, query and transaction', async () => {
      await expect(adapter.ping()).resolves.toBe(true);

      const [counted, metadata] = await adapter.query(
        `SELECT COUNT(*) AS total FROM ${tasks} WHERE name = ?`,
        ['write docs']
      );

      // Postgres counts in a bigint, which the driver reads as a string
      expect(Number(counted[0].total)).toBe(1);
      expect(metadata).toBeDefined();
      await expect(
        adapter.query(`SELECT name FROM ${tasks}`, [], {
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
        target.name,
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
      // The public identifier finds the user too
      const byExternalId = await adapter.findUserById(user.externalId);

      expect(byExternalId.email).toBe('felix@usehenri.io');
      expect(adapter.toPlain(user)).toEqual(
        expect.objectContaining({
          email: 'felix@usehenri.io',
          externalId: user.externalId,
        })
      );
      expect(adapter.toPlain(user).id).toBeUndefined();
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

    test('passwordsHashed writes a hash straight through, in bulk too', async () => {
      // The bulk create hook used to hash whatever it was given, ignoring
      // the flag, so a hash handed to it came out hashed twice and its owner
      // could not sign in
      const [written] = await User.bulkCreate(
        [{ email: 'already@usehenri.io', password: 'hashed:already' }],
        { passwordsHashed: true }
      );

      expect(written.password).toBe('hashed:already');
      expect(
        (await adapter.findUserByEmail('already@usehenri.io')).password
      ).toBe('hashed:already');

      await User.update(
        { password: 'hashed:untouched' },
        { passwordsHashed: true, where: { email: 'already@usehenri.io' } }
      );

      expect(
        (await adapter.findUserByEmail('already@usehenri.io')).password
      ).toBe('hashed:untouched');
    });

    test('every row created in bulk keeps its own public identifier', async () => {
      // What the binding of a hash to its row is made of: the uuid is there
      // before the insert, one per record, even in a bulk create
      const [first, second] = await User.bulkCreate([
        { email: 'bulk-id-one@usehenri.io', password: 'one' },
        { email: 'bulk-id-two@usehenri.io', password: 'two' },
      ]);

      expect(first.externalId).toEqual(expect.any(String));
      expect(second.externalId).toEqual(expect.any(String));
      expect(first.externalId).not.toBe(second.externalId);
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
        `SELECT roles FROM ${users} WHERE email = ?`,
        ['felix@usehenri.io']
      );

      expect(asJson(row.roles)).toEqual(['member']);
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
        target.name,
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
        // A database nobody created on the server, an impossible file on sqlite
        target.live
          ? target.store('never-created')
          : { dialect: 'sqlite', storage: '/nonexistent/dir/db.sqlite' },
        fakeHenri()
      );

      await expect(adapter.start()).rejects.toThrow();
    });
  });
  describe('timestamps, soft deletes and paginate', () => {
    let adapter;
    let Task;
    let Note;
    let Bare;

    beforeAll(async () => {
      ({ adapter } = build());
      Task = adapter.addModel(
        { ...taskModel, options: { paranoid: true } },
        'user'
      );
      Note = adapter.addModel(
        { globalId: 'Note', identity: 'note', schema: { body: 'text' } },
        'user'
      );
      Bare = adapter.addModel(
        {
          globalId: 'Bare',
          identity: 'bare',
          options: { timestamps: false },
          schema: { body: 'text' },
        },
        'user'
      );
      await adapter.start();
    });

    afterAll(async () => {
      await adapter.stop();
    });

    afterEach(async () => {
      await Task.destroy({ force: true, where: {} });
      await Note.destroy({ where: {} });
    });

    test('a model without options gets createdAt and updatedAt', async () => {
      const note = await Note.create({ body: 'written' });

      expect(note.createdAt).toBeInstanceOf(Date);
      expect(note.updatedAt).toBeInstanceOf(Date);
    });

    test('options.timestamps false opts out', async () => {
      const bare = await Bare.create({ body: 'plain' });

      expect(bare.get('createdAt')).toBeUndefined();
      expect(Object.keys(Bare.rawAttributes)).not.toContain('updatedAt');
    });

    test('destroy stamps deletedAt and hides the row', async () => {
      const task = await Task.create({ name: 'archived' });

      await task.destroy();

      expect(task.deletedAt).toBeInstanceOf(Date);
      expect(await Task.count()).toBe(0);
      expect(await Task.findByPk(task.id)).toBeNull();
      expect(await Task.count({ paranoid: false })).toBe(1);
    });

    test('restore brings the row back and force deletes for real', async () => {
      const task = await Task.create({ name: 'gone' });

      await task.destroy();
      await task.restore();

      expect(await Task.count()).toBe(1);

      await task.destroy({ force: true });

      expect(await Task.count({ paranoid: false })).toBe(0);
    });

    test('paginate returns the records and the counters', async () => {
      await Task.bulkCreate(
        ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name }))
      );

      const page = await Task.paginate({
        order: [['name', 'ASC']],
        page: 2,
        perPage: 2,
      });

      expect(page.records.map((task) => task.name)).toEqual(['c', 'd']);
      expect(page).toMatchObject({ page: 2, pages: 3, perPage: 2, total: 5 });

      const all = await Task.paginate();

      expect(all).toMatchObject({ page: 1, pages: 1, perPage: 25, total: 5 });

      const bad = await Task.paginate({ page: 'x', perPage: -3 });

      expect(bad).toMatchObject({ page: 1, perPage: 25 });

      await Task.destroy({ where: { name: ['a', 'b'] } });

      expect((await Task.paginate({ perPage: 10 })).total).toBe(3);
      expect(
        (await Task.paginate({ paranoid: false, perPage: 10 })).total
      ).toBe(5);
    });
  });
});
