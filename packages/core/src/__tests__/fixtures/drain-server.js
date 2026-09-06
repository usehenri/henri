/**
 * A listening henri server in a process of its own, so a test can send it a
 * real signal and watch what a real socket gets.
 *
 * Everything but the server module is a stand-in: the point is the wiring
 * from SIGTERM to the drain to `henri.stop()`, which cannot be observed from
 * inside the test process (raising a signal there would take the test runner
 * with it, and a mocked signal proves nothing about the ordering).
 *
 * It prints one JSON line per event on stdout -- `listening`, `served`,
 * `stopped` -- which is what the test reads to know the order things happened
 * in. `DRAIN_CONFIG` is the `config` henri answers with.
 *
 * Run: DRAIN_CONFIG='{"shutdown":{"drain":300}}' node drain-server.js
 */
const Server = require('../../2.server');

const config = JSON.parse(process.env.DRAIN_CONFIG || '{}');

/**
 * Says what happened, one JSON line at a time
 *
 * @param {string} event the name of the event
 * @param {object} [extra={}] what else to say about it
 * @returns {void}
 */
const say = (event, extra = {}) =>
  process.stdout.write(`${JSON.stringify(Object.assign({ event }, extra))}\n`);

/** How long the slow route takes to answer (ms) */
const SLOW = Number(process.env.DRAIN_SLOW || 500);

const henri = {
  config: {
    get: (key, safe) => {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        return config[key];
      }

      if (safe) {
        return false;
      }

      throw new Error(`Config key ${key} does not exist`);
    },
    has: (key) => Object.prototype.hasOwnProperty.call(config, key),
  },
  cwd: () => process.cwd(),
  isDev: false,
  isProduction: false,
  isTest: false,
  modules: { initialized: true },
  pen: {
    error: (...args) => say('log', { args, level: 'error' }),
    fatal: (...args) => say('log', { args, level: 'fatal' }),
    info: (...args) => say('log', { args, level: 'info' }),
    line: () => {},
    warn: (...args) => say('log', { args, level: 'warn' }),
  },
  release: '0.42.0',
  stop: async () => {
    say('stopped');
    await server.stop();

    return [];
  },
  utils: { clearConsole: () => {} },
};

const server = new Server();

henri.server = server;
server.henri = henri;

/**
 * The routes, where the real router would be: one slow answer, and one that
 * never comes -- the socket the drain deadline has to destroy
 *
 * @param {object} req the request
 * @param {object} res the answer
 * @param {function} next the next middleware
 * @returns {void}
 */
const handler = (req, res, next) => {
  if (req.path === '/slow') {
    say('received', { path: req.path });

    return setTimeout(() => {
      say('served', { path: req.path });
      res.json({ ok: true });
    }, SLOW);
  }

  if (req.path === '/forever') {
    say('received', { path: req.path });

    return undefined;
  }

  return next();
};

henri.router = { handler };

/**
 * Boots the server and says where it listens
 *
 * @returns {Promise<void>} resolves once listening
 */
const main = async () => {
  await server.init();
  await server.start();

  say('listening', { port: server.httpServer.address().port });
};

main().catch((error) => {
  say('failed', { message: error.message });
  process.exit(1);
});
