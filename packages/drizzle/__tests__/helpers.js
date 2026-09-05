const fs = require('fs');
const os = require('os');
const path = require('path');
const Drizzle = require('../index');

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

  return {
    _user: null,
    calls,
    config: {
      get: (key) => settings[key],
      has: (key) => typeof settings[key] !== 'undefined',
    },
    cwd: () => process.cwd(),
    isProduction: false,
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
 * @returns {{ adapter: Drizzle, henri: object }} adapter and its fake henri
 */
const build = (settings = {}, config = {}) => {
  const henri = fakeHenri(settings);
  const adapter = new Drizzle(
    'default',
    { dialect: 'sqlite', url: ':memory:', ...config },
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
  fakeHenri,
  sessions,
  taskModel,
  tmpdir,
  userModel,
};
