const Sql = require('../index');
const target = require('./targets');

// Every store the suites open lives on the target (sqlite in memory, or
// its own database on the postgres or mysql server of the environment);
// the databases are dropped when the file is done
if (typeof afterAll === 'function') {
  afterAll(() => target.cleanup());
}

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
 * Builds an adapter backed by the target database: sqlite in memory, or a
 * database of its own on the live server of the environment
 *
 * @param {object} [settings={}] configuration values
 * @param {object} [config={}] extra store configuration
 * @param {string} [key] A stable key: two stores built with the same key
 *   share one database (one sqlite file)
 * @returns {{ adapter: Sql, henri: object }} adapter and its fake henri
 */
const build = (settings = {}, config = {}, key) => {
  const henri = fakeHenri(settings);
  // A suite pointing the store somewhere itself (a sqlite file) keeps it
  const store = config.storage ? {} : target.store(key);
  const adapter = new Sql('default', { ...store, ...config }, henri);

  return { adapter: target.prepare(adapter), henri };
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

module.exports = {
  Sql,
  build,
  fakeHenri,
  sessions,
  target,
  taskModel,
  userModel,
};
