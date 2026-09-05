const Sequelize = require('sequelize');
const session = require('express-session');
const Sql = require('../index');
const types = require('../types');

const { DataTypes } = Sequelize;

/**
 * Builds a minimal henri stand-in for the adapter
 *
 * @param {object} [settings={}] configuration values
 * @returns {object} fake henri
 */
const fakeHenri = (settings = {}) => ({
  _user: null,
  config: {
    get: (key) => settings[key],
    has: (key) => typeof settings[key] !== 'undefined',
  },
  pen: {
    error: jest.fn(),
    fatal: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
  user: {
    encrypt: async (password) => `hashed:${password}`,
  },
});

/**
 * Builds an adapter backed by an in-memory sqlite database
 *
 * @param {object} [settings={}] configuration values
 * @returns {Sql} adapter
 */
const build = (settings = {}) => {
  const henri = fakeHenri(settings);
  const adapter = new Sql('default', { adapter: 'sqlite' }, henri);

  adapter.connector = new Sequelize({
    dialect: 'sqlite',
    logging: false,
    storage: ':memory:',
  });

  return { adapter, henri };
};

describe('sequelize adapter', () => {
  describe('models', () => {
    let adapter;
    let henri;
    let Task;
    let User;

    beforeAll(async () => {
      ({ adapter, henri } = build({ baseRole: 'member' }));

      Task = adapter.addModel(
        {
          globalId: 'Task',
          identity: 'task',
          schema: { title: { type: DataTypes.STRING } },
        },
        'user'
      );

      User = adapter.addModel(
        {
          globalId: 'User',
          identity: 'user',
          options: { timestamps: true },
          schema: { name: { type: DataTypes.STRING } },
        },
        'user'
      );

      await adapter.start();
    });

    afterAll(async () => {
      await adapter.stop();
    });

    test('registers models and exposes them', () => {
      expect(adapter.getModels()).toEqual({ Task, User });
      expect(Task.getTableName()).toBe('Tasks');
    });

    test('creates and finds plain records', async () => {
      await Task.create({ title: 'hello' });

      const tasks = await Task.findAll();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('hello');
    });

    test('flags the user model on henri', () => {
      expect(henri._user).toBe(User);
      expect(henri.pen.info).toHaveBeenCalledWith(
        'sequelize',
        'basic user role',
        ['member']
      );
    });

    test('requires email and password on the user model', async () => {
      await expect(User.create({ name: 'nobody' })).rejects.toThrow(
        /notNull Violation/
      );
    });

    test('encrypts the password on create', async () => {
      const user = await User.create({
        email: 'code@usehenri.io',
        name: 'felix',
        password: 'secret',
      });

      expect(user.password).toBe('hashed:secret');
    });

    test('defaults the roles to the base role', async () => {
      const user = await User.findOne({ where: { email: 'code@usehenri.io' } });

      expect(user.roles).toEqual(['member']);
    });

    test('round-trips roles as an array', async () => {
      const user = await User.findOne({ where: { email: 'code@usehenri.io' } });

      user.roles = ['admin', 'member'];
      await user.save();

      const reloaded = await User.findByPk(user.id);

      expect(reloaded.roles).toEqual(['admin', 'member']);
      expect(reloaded.getDataValue('roles')).toBe('["admin","member"]');
    });

    test('accepts a single role in the setter', async () => {
      const user = await User.create({
        email: 'single@usehenri.io',
        password: 'secret',
        roles: 'editor',
      });

      expect((await User.findByPk(user.id)).roles).toEqual(['editor']);
    });

    test('checks roles with hasRole', async () => {
      const user = await User.findOne({ where: { email: 'code@usehenri.io' } });

      await expect(user.hasRole('admin')).resolves.toBe(true);
      await expect(user.hasRole(['admin', 'member'])).resolves.toBe(true);
      await expect(user.hasRole(['admin', 'root'])).resolves.toBe(false);
      await expect(user.hasRole()).resolves.toBe(true);
    });

    test('re-encrypts the password only when it changes', async () => {
      const user = await User.findOne({ where: { email: 'code@usehenri.io' } });

      user.name = 'renamed';
      await user.save();
      expect((await User.findByPk(user.id)).password).toBe('hashed:secret');

      user.password = 'other';
      await user.save();
      expect((await User.findByPk(user.id)).password).toBe('hashed:other');
    });

    test('provides an express-session store', () => {
      const store = adapter.getSessionConnector(session);

      expect(store).toBeInstanceOf(session.Store);
      expect(typeof store.get).toBe('function');
      expect(typeof store.set).toBe('function');
      expect(typeof store.destroy).toBe('function');

      expect(adapter.getSessionConnector(session.Store)).toBeInstanceOf(
        session.Store
      );
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
      expect(henri.pen.warn).toHaveBeenCalledWith(
        'sequelize',
        'no basic user role. are you sure?'
      );

      await adapter.stop();
    });
  });

  describe('lifecycle', () => {
    test('start syncs the schema before resolving', async () => {
      const { adapter } = build();

      const Item = adapter.addModel(
        {
          globalId: 'Item',
          identity: 'item',
          schema: { name: { type: DataTypes.STRING } },
        },
        'user'
      );

      await adapter.start();

      const tables = await adapter.connector
        .getQueryInterface()
        .showAllTables();

      expect(tables).toContain(Item.getTableName());

      await adapter.stop();
    });

    test('start rejects when the connection fails', async () => {
      const henri = fakeHenri();
      const adapter = new Sql('broken', {}, henri);

      adapter.connector = new Sequelize({
        dialect: 'sqlite',
        logging: false,
        storage: '/nonexistent/dir/db.sqlite',
      });

      await expect(adapter.start()).rejects.toThrow();
    });
  });

  describe('types', () => {
    test('maps mongoose style names to sequelize data types', () => {
      expect(types.String).toBe(DataTypes.STRING);
      expect(types.Number).toBe(DataTypes.INTEGER);
      expect(types.Boolean).toBe(DataTypes.BOOLEAN);
      expect(types.Date).toBe(DataTypes.DATE);
      expect(types.Mixed).toBe(DataTypes.JSON);
    });

    test('exposes the sequelize data types', () => {
      expect(types.STRING).toBe(DataTypes.STRING);
      expect(types.TEXT).toBe(DataTypes.TEXT);
      expect(types.UUID).toBe(DataTypes.UUID);
      expect(types.JSONB).toBe(DataTypes.JSONB);
    });
  });
});
