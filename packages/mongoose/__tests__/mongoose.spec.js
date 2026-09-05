const { MongoMemoryServer } = require('mongodb-memory-server');
const session = require('express-session');
const Mongoose = require('../index');
const { normalizeSchema } = require('../schema');
const types = require('../types');
const { buildUrl, redact } = require('../utils');

let mongod;

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
    isTest: true,
    pen,
    user: {
      encrypt: async (password) => `hashed:${password}`,
    },
  };
};

/**
 * Builds an adapter on the shared in-memory server
 *
 * @param {string} database A database name, one per describe block
 * @param {object} [settings={}] configuration values
 * @param {object} [config={}] extra store configuration
 * @returns {{ adapter: Mongoose, henri: object }} adapter and its fake henri
 */
const build = (database, settings = {}, config = {}) => {
  const henri = fakeHenri(settings);
  const adapter = new Mongoose(
    'default',
    { url: mongod.getUri(database), ...config },
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

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
}, 120000);

afterAll(async () => {
  await mongod.stop();
}, 60000);

describe('mongoose adapter', () => {
  describe('configuration', () => {
    test('throws after logging a fatal without url or host', () => {
      const henri = fakeHenri();

      expect(() => new Mongoose('broken', {}, henri)).toThrow(
        'Missing url or host in store broken'
      );
      expect(henri.calls).toEqual([
        ['fatal', 'mongoose', 'Missing url or host in store broken'],
      ]);
    });

    test('builds the url from host, port, database and credentials', () => {
      expect(buildUrl({ host: 'ignored', url: 'mongodb://a/b' })).toBe(
        'mongodb://a/b'
      );
      expect(buildUrl({ host: 'mongodb+srv://cluster/db' })).toBe(
        'mongodb+srv://cluster/db'
      );
      expect(buildUrl({ host: 'localhost' })).toBe('mongodb://localhost/');
      expect(
        buildUrl({
          database: 'henri',
          host: 'db.local',
          password: 'p@ss',
          port: 27018,
          username: 'felix',
        })
      ).toBe('mongodb://felix:p%40ss@db.local:27018/henri');
      expect(buildUrl({})).toBeNull();

      const store = new Mongoose(
        'named',
        { database: 'henri', host: 'db.local' },
        fakeHenri()
      );

      expect(store.url).toBe('mongodb://db.local/henri');
    });

    test('fails fast on a bad url with the server selection timeout', () => {
      const { adapter } = build('none');

      expect(adapter.connectOptions()).toEqual({
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 10000,
      });
      expect(
        new Mongoose(
          'custom',
          { opts: { serverSelectionTimeoutMS: 500 }, url: 'mongodb://x/y' },
          fakeHenri()
        ).connectOptions()
      ).toEqual({ connectTimeoutMS: 10000, serverSelectionTimeoutMS: 500 });
    });

    test('start rejects quickly when the server is unreachable', async () => {
      const henri = fakeHenri();
      const adapter = new Mongoose(
        'unreachable',
        {
          opts: { serverSelectionTimeoutMS: 300 },
          url: 'mongodb://127.0.0.1:1/henri',
        },
        henri
      );
      const started = Date.now();

      await expect(adapter.start()).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5000);
      expect(henri.calls).toContainEqual([
        'error',
        'mongoose',
        'failed to connect to server',
      ]);
    }, 10000);

    test('redacts credentials from debug output', () => {
      expect(
        redact({
          auth: { password: 'p', username: 'u' },
          pass: 'secret',
          url: 'mongodb://felix:secret@db.local:27017/henri',
          user: 'felix',
        })
      ).toEqual({
        auth: '***',
        pass: '***',
        url: 'mongodb://felix:***@db.local:27017/henri',
        user: 'felix',
      });
    });
  });

  describe('schema normalizer', () => {
    test('maps the henri type names to mongoose types', () => {
      const definition = normalizeSchema({
        active: 'boolean',
        age: { required: true, type: 'integer' },
        birthday: 'date',
        id: 'uuid',
        name: { type: 'string' },
        notes: 'text',
        ratio: 'float',
        settings: 'json',
        weight: 'number',
      });

      expect(definition.active).toBe(Boolean);
      expect(definition.age).toEqual({ required: true, type: Number });
      expect(definition.birthday).toBe(Date);
      expect(definition.id).toBe(String);
      expect(definition.name).toEqual({ type: String });
      expect(definition.notes).toBe(String);
      expect(definition.ratio).toBe(Number);
      expect(definition.settings).toBe(types.json);
      expect(definition.weight).toBe(Number);
      expect(Object.keys(types).sort()).toEqual([
        'boolean',
        'date',
        'float',
        'integer',
        'json',
        'number',
        'string',
        'text',
        'uuid',
      ]);
    });

    test('passes mongoose definitions through and translates sequelize keys', () => {
      const definition = normalizeSchema({
        address: { city: 'string', street: { trim: true, type: 'text' } },
        author: { ref: 'User', type: 'ObjectId' },
        name: { allowNull: false, defaultValue: 'x', type: String },
        tags: ['string'],
        tasks: {},
      });

      expect(definition.address).toEqual({
        city: String,
        street: { trim: true, type: String },
      });
      expect(definition.author).toEqual({ ref: 'User', type: 'ObjectId' });
      expect(definition.name).toEqual({
        default: 'x',
        required: true,
        type: String,
      });
      expect(definition.tags).toEqual([String]);
      expect(definition.tasks).toEqual({});
    });
  });

  describe('models', () => {
    let adapter;
    let henri;
    let Task;
    const associated = [];

    beforeAll(async () => {
      ({ adapter, henri } = build('models'));
      Task = adapter.addModel(taskModel, 'user');
      adapter.addModel(
        {
          /**
           * Records the models handed to associate()
           *
           * @param {object} models The store models
           * @returns {void}
           */
          associate(models) {
            associated.push(Object.keys(models));
          },
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

    test('registers models and calls associate once every model exists', () => {
      expect(Object.keys(adapter.getModels())).toEqual(['Task', 'Note']);
      expect(adapter.getModels().Note.collection.collectionName).toBe(
        'my_notes'
      );
      expect(associated).toEqual([['Task', 'Note']]);
      expect(henri._user).toBeNull();
    });

    test('boots the scaffolded model with defaults, required and enum', async () => {
      const task = await Task.create({ name: 'write docs' });

      expect(task.category).toBe('low');
      expect(task.done).toBe(false);
      expect(task.createdAt).toBeInstanceOf(Date);
      await expect(Task.create({})).rejects.toThrow(/`name` is required/);
      await expect(
        Task.create({ category: 'nope', name: 'x' })
      ).rejects.toThrow(/not a valid enum value/);
    });

    test('pings the server', async () => {
      await expect(adapter.ping()).resolves.toBe(true);
    });
  });

  describe('user model', () => {
    let adapter;
    let henri;
    let User;

    beforeAll(async () => {
      ({ adapter, henri } = build('users', { baseRole: 'member' }));
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
        'mongoose',
        'basic user role',
        ['member'],
      ]);
    });

    test('requires email and password', async () => {
      await expect(User.create({ name: 'nobody' })).rejects.toThrow(
        /is required/
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
      expect(user.roles.toObject()).toEqual(['member']);
    });

    test('rejects duplicate (mixed-case) and invalid emails', async () => {
      await expect(
        User.create({ email: 'FELIX@usehenri.io', password: 'secret' })
      ).rejects.toThrow(/duplicate key/);
      await expect(
        User.create({ email: 'not-an-email', password: 'secret' })
      ).rejects.toThrow(/is not a valid email/);
    });

    test('does not select the password by default', async () => {
      const user = await User.findOne({ email: 'felix@usehenri.io' });
      const withPassword = await User.findOne({
        email: 'felix@usehenri.io',
      }).select('+password');

      expect(user.password).toBeUndefined();
      expect(Object.keys(user.toObject())).not.toContain('password');
      expect(withPassword.password).toBe('hashed:secret');
    });

    test('finds users for authentication and sessions', async () => {
      const user = await adapter.findUserByEmail(' FELIX@usehenri.io ');
      const id = adapter.userId(user);

      expect(user.password).toBe('hashed:secret');
      expect(id).toBe(String(user._id));

      const byId = await adapter.findUserById(id);

      expect(byId.email).toBe('felix@usehenri.io');
      expect(byId.password).toBeUndefined();
      expect(adapter.toPlain(user)).toEqual(
        expect.objectContaining({ _id: user._id, email: 'felix@usehenri.io' })
      );
      expect(adapter.toPlain(user).password).toBeUndefined();

      await expect(adapter.findUserByEmail('nobody@usehenri.io')).resolves.toBe(
        null
      );
      await expect(adapter.findUserByEmail('')).resolves.toBe(null);
      await expect(adapter.findUserById('not-an-id')).resolves.toBe(null);
      await expect(
        adapter.findUserById('000000000000000000000000')
      ).resolves.toBe(null);
      await expect(adapter.findUserById(null)).resolves.toBe(null);
    });

    test('re-encrypts the password only when it changes', async () => {
      const user = await adapter.findUserByEmail('felix@usehenri.io');

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

    test('hashes passwords written through queries', async () => {
      await User.updateOne({ email: 'felix@usehenri.io' }, { password: 'one' });
      expect(
        (await adapter.findUserByEmail('felix@usehenri.io')).password
      ).toBe('hashed:one');

      await User.updateOne(
        { email: 'felix@usehenri.io' },
        { $set: { password: 'two' } }
      );
      expect(
        (await adapter.findUserByEmail('felix@usehenri.io')).password
      ).toBe('hashed:two');

      const updated = await User.findOneAndUpdate(
        { email: 'felix@usehenri.io' },
        { $set: { password: 'three' } },
        { returnDocument: 'after' }
      ).select('+password');

      expect(updated.password).toBe('hashed:three');
    });

    test('drops roles from mass-assigned creates and updates', async () => {
      const user = await User.create({
        email: 'roles@usehenri.io',
        password: 'secret',
        roles: ['admin'],
      });

      expect(user.roles.toObject()).toEqual(['member']);

      user.roles = ['admin'];
      user.name = 'still member';
      await user.save();

      await User.updateOne(
        { email: 'roles@usehenri.io' },
        { name: 'query', roles: ['admin'] }
      );
      await User.updateOne(
        { email: 'roles@usehenri.io' },
        { $push: { roles: 'admin' }, $set: { roles: ['admin'] } }
      );

      const reloaded = await User.findById(user._id);

      expect(reloaded.roles.toObject()).toEqual(['member']);
      expect(reloaded.name).toBe('query');
    });

    test('changes roles through setRoles or with unsafe', async () => {
      const user = await User.findOne({ email: 'roles@usehenri.io' });

      await user.setRoles(['admin', 'member']);
      expect((await User.findById(user._id)).roles.toObject()).toEqual([
        'admin',
        'member',
      ]);

      const updated = await User.setRoles(user._id, 'editor');

      expect(updated.roles.toObject()).toEqual(['editor']);
      expect((await User.findById(user._id)).roles.toObject()).toEqual([
        'editor',
      ]);
      await expect(
        User.setRoles('000000000000000000000000', 'editor')
      ).resolves.toBe(null);

      await User.updateOne(
        { _id: user._id },
        { $set: { roles: ['query'] } },
        { unsafe: true }
      );
      expect((await User.findById(user._id)).roles.toObject()).toEqual([
        'query',
      ]);

      const [created] = await User.create(
        [{ email: 'unsafe@usehenri.io', password: 'secret', roles: ['root'] }],
        { unsafe: true }
      );
      const doc = new User({
        email: 'locals@usehenri.io',
        password: 'secret',
        roles: ['root'],
      });

      doc.$locals.unsafe = true;
      await doc.save();

      expect(created.roles.toObject()).toEqual(['root']);
      expect((await User.findById(doc._id)).roles.toObject()).toEqual(['root']);
    });

    test('checks roles with hasRole', async () => {
      const user = await User.findOne({ email: 'roles@usehenri.io' });

      await expect(user.hasRole('query')).resolves.toBe(true);
      await expect(user.hasRole(['query'])).resolves.toBe(true);
      await expect(user.hasRole(['query', 'root'])).resolves.toBe(false);
      await expect(user.hasRole()).resolves.toBe(true);
    });
  });

  describe('without a base role', () => {
    test('warns and defaults the roles to an empty list', async () => {
      const { adapter, henri } = build('noroles');
      const User = adapter.addModel(
        { globalId: 'User', identity: 'user', schema: {} },
        'user'
      );

      await adapter.start();

      const user = await User.create({
        email: 'code@usehenri.io',
        password: 'secret',
      });

      expect(user.roles.toObject()).toEqual([]);
      await expect(user.hasRole('admin')).resolves.toBe(false);
      expect(henri.calls).toContainEqual([
        'warn',
        'mongoose',
        'no basic user role. are you sure?',
      ]);

      await adapter.stop();
    });
  });

  describe('sessions and lifecycle', () => {
    test('provides a ready express-session store on the mongoose client', async () => {
      const { adapter } = build('sessions');

      adapter.addModel(userModel, 'user');

      await expect(adapter.getSessionConnector(session)).rejects.toThrow(
        'called before start()'
      );

      await adapter.start();

      const store = await adapter.getSessionConnector(session);
      const api = sessions(store);

      expect(store).toBeInstanceOf(session.Store);
      expect(await adapter.getSessionConnector(session)).toBe(store);
      expect(await store.clientP).toBe(adapter.mongoose.connection.getClient());

      await api.set('sid', { cookie: { maxAge: 60000 }, user: 1 });
      await expect(api.get('sid')).resolves.toEqual({
        cookie: { maxAge: 60000 },
        user: 1,
      });
      await api.destroy('sid');
      await expect(api.get('sid')).resolves.toBeNull();

      const collections = await adapter.mongoose.connection.db
        .listCollections()
        .toArray();

      expect(collections.map((item) => item.name)).toContain('henriSessions');

      await adapter.stop();
    });

    test('stops cleanly and starts again', async () => {
      const { adapter, henri } = build('restart', { baseRole: 'member' });
      const before = adapter.addModel(userModel, 'user');

      await adapter.start();
      await adapter.getSessionConnector(session);
      await adapter.stop();

      expect(adapter.sessionStore).toBeNull();
      expect(adapter.getModels()).toEqual({});
      expect(adapter.mongoose.connection.readyState).toBe(0);

      await adapter.start();

      const { User } = adapter.getModels();

      expect(User).not.toBe(before);
      expect(henri._user).toBe(User);

      const user = await User.create({
        email: 'again@usehenri.io',
        password: 'secret',
      });

      expect(user.password).toBe('hashed:secret');
      expect(user.roles.toObject()).toEqual(['member']);

      const api = sessions(await adapter.getSessionConnector(session));

      await api.set('sid', { cookie: {}, user: String(user._id) });
      await expect(api.get('sid')).resolves.toEqual({
        cookie: {},
        user: String(user._id),
      });

      await adapter.stop();
    });
  });
});
