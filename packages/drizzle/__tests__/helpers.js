const fs = require('fs');
const os = require('os');
const path = require('path');
const Drizzle = require('../index');
const Encryption = require('@usehenri/core/src/1.encryption');
const { generateKey } = require('@usehenri/core/src/base/encryption');
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
    pen[level] = (...args) => {
      calls.push([level, ...args]);

      return level === 'fatal' ? new Error(args[1]) : undefined;
    };
  });

  const henri = {
    _user: null,
    calls,
    config: {
      get: (key) => settings[key],
      has: (key) => typeof settings[key] !== 'undefined',
      sourceOf: () => 'the test',
    },
    cwd: () => process.cwd(),
    isProduction: false,
    pen,
    user: {
      encrypt: async (password) => `hashed:${password}`,
    },
  };

  // The real module, not a stand-in: what the adapter is being tested
  // against is the envelope core writes, and a double would drift from it
  const encryption = new Encryption();

  encryption.henri = henri;
  henri.encryption = encryption;

  return henri;
};

/**
 * A henri whose encryption module is loaded with the given keys
 *
 * @param {Array<string>} keys The keys, the one that writes first
 * @param {object} [settings={}] Other configuration values
 * @returns {Promise<object>} The fake henri
 */
const withKeys = async (keys, settings = {}) => {
  const henri = fakeHenri({ encryption: { keys }, ...settings });

  await henri.encryption.init();

  return henri;
};

/**
 * Builds an adapter backed by the target database: sqlite in memory, or a
 * database of its own on the live server of the environment
 *
 * @param {object} [settings={}] configuration values
 * @param {object} [config={}] extra store configuration
 * @param {string} [key] A stable key: two stores built with the same key
 *   share one database (one sqlite file), the way an application restarts
 *   on the same data
 * @returns {{ adapter: Drizzle, henri: object }} adapter and its fake henri
 */
const build = (settings = {}, config = {}, key) =>
  buildWith(fakeHenri(settings), config, key);

/**
 * The same, on a henri that was built already (the encryption suites,
 * which need `henri.encryption.init()` awaited before the first model)
 *
 * @param {object} henri A fake henri
 * @param {object} [config={}] extra store configuration
 * @param {string} [key] A stable key (see build)
 * @returns {{ adapter: Drizzle, henri: object }} adapter and its fake henri
 */
const buildWith = (henri, config = {}, key) => {
  // A suite pointing the store somewhere itself (a sqlite file) keeps it
  const store = config.url ? {} : target.store(key);
  const adapter = new Drizzle('default', { ...store, ...config }, henri);

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
 * @returns {object} set, get, destroy, touch, all, length and clear
 */
const sessions = (store) => {
  const call = (method, ...args) =>
    new Promise((resolve, reject) =>
      store[method](...args, (error, result) =>
        error ? reject(error) : resolve(result)
      )
    );

  return {
    all: () => call('all'),
    clear: () => call('clear'),
    destroy: (sid) => call('destroy', sid),
    get: (sid) => call('get', sid),
    length: () => call('length'),
    set: (sid, data) => call('set', sid, data),
    touch: (sid, data) => call('touch', sid, data),
  };
};

/**
 * A temporary directory, removed by the caller
 *
 * @param {string} [prefix='henri-drizzle-'] Directory prefix
 * @returns {string} The directory
 */
const tmpdir = (prefix = 'henri-drizzle-') =>
  fs.mkdtempSync(path.join(os.tmpdir(), prefix));

module.exports = {
  Drizzle,
  build,
  buildWith,
  fakeHenri,
  generateKey,
  sessions,
  target,
  taskModel,
  tmpdir,
  userModel,
  withKeys,
};
