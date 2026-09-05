const supertest = require('supertest');

const state = {
  instance: null,
  starting: null,
};

/**
 * Resolve a module from the app first (an app pins its own henri version),
 * then from this package
 *
 * @param {string} id module id
 * @returns {string} resolved path
 */
const resolveFromApp = (id) =>
  require.resolve(id, { paths: [process.cwd(), __dirname] });

/**
 * Load the Henri class of the app's @usehenri/core
 *
 * @returns {Function} the Henri constructor
 * @throws when @usehenri/core is not installed in the app
 */
const loadHenri = () => {
  try {
    return require(resolveFromApp('@usehenri/core/src/henri'));
  } catch (error) {
    throw new Error(
      `@usehenri/testing: unable to load @usehenri/core from ${process.cwd()} (${error.message})`,
      { cause: error }
    );
  }
};

/**
 * Boot henri for the app in the current directory
 *
 * @param {object} [options={}] options
 * @param {boolean} [options.workers=false] start app/workers too
 * @returns {Promise<object>} the running henri instance
 */
const boot = async ({ workers = false } = {}) => {
  process.env.NODE_ENV = 'test';

  if (!workers) {
    process.env.SKIP_WORKERS = 'true';
  }

  const Henri = loadHenri();
  const instance = new Henri();

  // Core does not register the global in test mode; apps and models expect it
  global.henri = instance;

  try {
    await instance.init();
  } catch (error) {
    delete global.henri;
    throw error;
  }

  return instance;
};

/**
 * Boot henri (once) for the app in process.cwd()
 *
 * Safe to call from every test file's beforeAll: a no-op when a setup file
 * (or an earlier call) already booted it. Sets NODE_ENV=test, skips workers
 * unless asked otherwise, picks a free port and registers `global.henri`
 * together with the model globals.
 *
 * @param {object} [options] options
 * @param {boolean} [options.workers=false] start app/workers too
 * @returns {Promise<object>} the running henri instance
 */
const setup = (options) => {
  const opts = options && typeof options.workers === 'boolean' ? options : {};

  if (state.instance) {
    return Promise.resolve(state.instance);
  }

  if (!state.starting) {
    state.starting = boot(opts).then(
      (instance) => {
        state.instance = instance;
        state.starting = null;

        return instance;
      },
      (error) => {
        state.starting = null;
        throw error;
      }
    );
  }

  return state.starting;
};

/**
 * Stop the henri instance started by setup()
 *
 * @returns {Promise<boolean>} whether an instance was stopped
 */
const teardown = async () => {
  if (state.starting) {
    await state.starting.catch(() => null);
  }

  const { instance } = state;

  if (!instance) {
    return false;
  }

  state.instance = null;

  try {
    await instance.stop();
  } finally {
    if (global.henri === instance) {
      delete global.henri;
    }
  }

  return true;
};

/**
 * The running henri instance, if any
 *
 * @returns {object|undefined} henri
 */
const current = () => state.instance || global.henri;

/**
 * The target supertest should hit: the running http server, or the url
 * exported by the global setup
 *
 * @param {object} [instance] a henri instance
 * @returns {import('http').Server|string} server or base url
 * @throws when henri is not running
 */
const target = (instance) => {
  if (instance && instance.server && instance.server.httpServer) {
    return instance.server.httpServer;
  }

  if (process.env.HENRI_TEST_URL) {
    return process.env.HENRI_TEST_URL.replace(/\/$/, '');
  }

  throw new Error(
    'henri is not running: `await setup()` in beforeAll, or add "@usehenri/testing/setup-file" to vitest setupFiles'
  );
};

/**
 * A supertest request bound to the running henri server
 *
 * @param {object} [instance] a henri instance (defaults to the one setup() started)
 * @returns {import('supertest').Agent} supertest bound to the server
 */
const request = (instance = current()) => supertest(target(instance));

/**
 * A supertest agent (keeps cookies between requests, for login flows)
 *
 * @param {object} [instance] a henri instance (defaults to the one setup() started)
 * @returns {import('supertest').Agent} a supertest agent
 */
const agent = (instance = current()) => supertest.agent(target(instance));

module.exports = {
  agent,
  request,
  setup,
  supertest,
  teardown,
};

Object.defineProperty(module.exports, 'henri', {
  enumerable: true,
  get: current,
});
