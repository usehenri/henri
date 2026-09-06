const BaseModule = require('./base/module');

const express = require('express');
const cookieParser = require('cookie-parser');
const compress = require('compression');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const chokidar = require('chokidar');
const boom = require('./base/boom');
const { errorHandler, notFound } = require('./base/http');
const { createApi } = require('./base/api');
const { userConfig } = require('./base/auth');
const health = require('./base/health');
const { apiVersion, secureHeaders } = require('./base/headers');
const { paginationMiddleware } = require('./base/pagination');
const { authLimiter, limiter } = require('./base/rate-limit');
const { requestId } = require('./base/request-id');
const { callsConfig, inbound } = require('./base/calls');
const { createShared, manyProcesses } = require('./base/shared');
const requestTimeout = require('./base/timeout');
const { drain, settings: stopSettings } = require('./base/shutdown');
const debug = require('debug')('henri:server');

/** How long stopping the modules may take before the process is killed (ms) */
const STOP_TIMEOUT = 5000;

/** Debounce for filesystem events (save-all, editor temp files) (ms) */
const WATCH_DEBOUNCE = 100;

const SIGNALS = ['SIGINT', 'SIGTERM'];

/**
 * Open an url in the default browser (best effort, never throws)
 *
 * @param {string} url the url to open
 * @returns {boolean} whether a command was spawned
 */
function openBrowser(url) {
  const commands = {
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]],
    win32: ['cmd', ['/c', 'start', '""', url]],
  };
  const [cmd, args] = commands[process.platform] || commands.linux;

  try {
    const child = execFile(cmd, args, () => {});

    child.on('error', (error) => debug('unable to open browser: %s', error));

    return true;
  } catch (error) {
    debug('unable to open browser: %s', error);

    return false;
  }
}

/**
 * Build the urls displayed in the terminal and used to open the browser
 *
 * @param {string} protocol http or https
 * @param {string} host the host the server is bound to
 * @param {string} lanIp the LAN ip of this machine
 * @param {number} port the port
 * @returns {{localUrlForTerminal: string, lanUrlForTerminal: string, localUrlForBrowser: string}} urls
 */
function prepareUrls(protocol, host, lanIp, port) {
  const localUrl = `${protocol}://localhost:${port}/`;
  const everywhere = host === '0.0.0.0' || host === '::';
  const lanUrl = everywhere && lanIp ? `${protocol}://${lanIp}:${port}/` : null;

  return {
    lanUrlForTerminal: lanUrl,
    localUrlForBrowser: localUrl,
    localUrlForTerminal: localUrl,
  };
}

/**
 * First non-internal IPv4 address of this machine (replaces internal-ip)
 *
 * @returns {?string} the ip or null
 */
function lanIp() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const entry of interfaces[name] || []) {
      const family = entry.family === 4 || entry.family === 'IPv4';

      if (family && !entry.internal) {
        return entry.address;
      }
    }
  }

  return null;
}

/**
 * The normalized user settings, or nothing when `config.user` is invalid
 * (the user module reports that itself)
 *
 * @param {object} config the config module
 * @returns {object} the settings (see base/auth.js userConfig)
 */
function safeUserConfig(config) {
  try {
    return userConfig(config);
  } catch (error) {
    debug('config.user is invalid: %s', error.message);

    return {};
  }
}

/** How many ports to try after the one asked for, in development */
const PORT_ATTEMPTS = 20;

/**
 * Is this the error of a port already taken?
 *
 * @param {Error} error what listen() reported
 * @returns {boolean} true when the port is busy
 */
function isPortTaken(error) {
  return error && (error.code === 'EADDRINUSE' || error.code === 'EACCES');
}

/* istanbul ignore next */
/**
 * Watch the filesystem in dev mode
 * Events are debounced and handed to server.changed(), which checks the
 * syntax and reloads (reloads are serialized by the module system).
 *
 * @param {Henri} henri the henri instance
 * @return {chokidar.FSWatcher} the watcher
 */
function watch(henri) {
  const { pen, server } = henri;
  const watching = [
    'app/controllers',
    'app/helpers',
    'app/jobs',
    'app/mailers',
    'app/models',
    'app/workers',
    'app/websocket',
    'app/views/partials',
    'app/routes.js',
    'config',
    'tests',
    'package.json',
  ]
    .map((entry) => path.resolve(henri.cwd(), entry))
    .filter((entry) => fs.existsSync(entry));

  const watcher = chokidar.watch(watching, {
    ignoreInitial: true,
    ignored: (file, stats) =>
      Boolean(stats && stats.isFile()) &&
      file.includes(`${path.sep}partials${path.sep}`) &&
      !/\.(html|htm|hbs)$/.test(file),
  });

  const pending = new Set();
  let timer = null;

  watcher.on('all', (event, file) => {
    pending.add(file);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = Array.from(pending);

      pending.clear();
      server
        .changed(files)
        .catch((error) => pen.error('server', 'reload failed', error));
    }, WATCH_DEBOUNCE);
  });

  server.watcher = watcher;

  keyboardShortcuts(henri);

  setTimeout(() => {
    const cmdCtrl = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';

    pen.info('server', `To reload the server codebase, use ${cmdCtrl}+R`);
    pen.info(
      'server',
      `To open the a new browser tab with the project, use ${cmdCtrl}+O or ${cmdCtrl}+N`
    );
    pen.info('server', `To quit, use ${cmdCtrl}+C`);
  }, 1 * 1000);

  return watcher;
}

/* istanbul ignore next */
/**
 * Keyboard shortcuts (only when running in an interactive terminal)
 * stdin is switched to raw mode, so Ctrl+C arrives as a byte (3) and is
 * routed to the same shutdown as SIGINT.
 *
 * @param {Henri} henri the henri instance
 * @returns {void}
 * @todo Move this to its own module with a menu and dynamic shortcuts
 */
function keyboardShortcuts(henri) {
  const {
    pen,
    server,
    utils: { clearConsole },
  } = henri;

  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    debug('stdin is not a tty, keyboard shortcuts disabled');

    return;
  }

  /**
   * Opens the browser at dev url
   *
   * @return {void}
   */
  const open = () => server.url && openBrowser(server.url);

  const actions = {
    114: async () => {
      const loaded = henri.router._results.loaded;
      const num = loaded.length;

      debug('showing routes information');

      if (num > 0) {
        clearConsole();
        pen.info('router', `loaded route${num > 1 ? 's' : ''}`);
        loaded.map((val) => pen.info(...val));
        pen.info('router', 'total loaded', num);
      } else {
        pen.info('router', 'no routes to show...');
      }
    },
    117: async () => {
      const unknown = henri.router._results.unknown;
      const num = unknown.length;

      if (num > 0) {
        clearConsole();
        pen.info('router', `unknown route${num > 1 ? 's' : ''}`);
        unknown.map((val) => pen.error(...val));
        pen.info('router', 'total unknown', num);
      } else {
        pen.info('router', 'no unknown routes to show...');
      }
    },
    14: () => {
      open();
    },
    15: () => {
      open();
    },
    18: async () => {
      clearConsole();
      pen.line();
      pen.warn('server', 'user-requested server reload...');
      pen.line();
      await henri.reload();
    },
    3: () => server.shutdown('SIGINT'),
  };

  const listener = (data) => {
    const chr = data.toString().charCodeAt(0);

    /* istanbul ignore next */
    if (typeof actions[chr] !== 'undefined') {
      Promise.resolve()
        .then(actions[chr])
        .catch((error) => pen.error('server', 'shortcut failed', error));
    }
  };

  process.stdin.resume();
  process.stdin.on('data', listener);
  process.stdin.setRawMode(true);

  server._stdinListener = listener;
}

/**
 * Server module
 *
 * @class Server
 * @extends {BaseModule}
 */
class Server extends BaseModule {
  /**
   * Creates an instance of Server.
   * @memberof Server
   */
  constructor() {
    super();
    this.needs = ['config'];
    this.runlevel = 2;
    this.name = 'server';
    this.henri = null;
    this.reloadable = false;

    this.port = 3000;
    this.host = null;
    this.url = '';
    this.app = null;
    this.express = null;
    this.httpServer = null;
    this.watcher = null;

    this._signalHandlers = [];
    this._stdinListener = null;
    this._stopping = false;

    /** True from the first moment of a shutdown: `/readyz` answers 503 */
    this.draining = false;

    /** Exit the process (replaceable in tests) */
    this.exit = (code) => process.exit(code);

    this.init = this.init.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.changed = this.changed.bind(this);
    this.drain = this.drain.bind(this);
    this.shutdown = this.shutdown.bind(this);
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof Server
   */
  async init() {
    const { config } = this.henri;
    const app = (this.app = express());

    app.disable('x-powered-by');
    // Weak ETags on every body: JSON clients revalidate with If-None-Match
    app.set('etag', 'weak');

    this.httpServer = require('http').createServer(this.app);

    this.port = config.has('port') ? config.get('port') : 3000;
    this.host =
      process.env.HENRI_HOST ||
      config.get('host', true) ||
      (this.henri.isProduction ? '0.0.0.0' : '127.0.0.1');

    // `henri.shared`: the backend the rate limit, the lockout and the
    // idempotency keys count in, when `config.shared` names one. It is built
    // before `henri.api`, which hands its stores to all three.
    this.henri.shared = createShared(this.henri);

    if (this.henri.shared) {
      const { name, onError } = this.henri.shared;
      const reached = await this.henri.shared.start();

      this.henri.pen.info(
        'shared',
        name,
        this.henri.shared.describe(),
        `rate limit, lockout and idempotency${reached ? '' : ' (not reachable yet)'}, fail ${onError}`
      );
    }

    // `henri.api`: settings of the JSON api and the stores it uses
    const api = (this.henri.api = createApi(
      this.henri,
      safeUserConfig(config)
    ));
    const { settings } = api;

    // Middleware order: request id, telemetry, the call log, the N+1
    // detector, timeout,
    // secure headers,
    // compression, cors, body parsers, cookies, boom, api version,
    // pagination, the health endpoints, static files. The user module adds
    // permit, session, passport and csrf (runlevel 4), start() adds the rate
    // limits, the router, the 404 and the error handler.
    app.use(requestId());

    // Two records want to be as far out as they can get, and they are not
    // competing: the span goes second so it covers the whole request and
    // carries the request id, and the call log goes third so it still sees
    // what the rate limit, the body parser and the CSRF check refuse --
    // which are exactly the requests worth having in it. Neither is mounted
    // when nothing asked for it: an application without @opentelemetry/api
    // has no telemetry middleware in its stack, one recording no boundary
    // has none either, and one that keeps no call log has no call-log
    // middleware, not even one that returns
    const traces =
      this.henri.telemetry &&
      this.henri.telemetry.enabled &&
      this.henri.telemetry.middleware();

    if (traces) {
      app.use(traces);
    }

    if (callsConfig(config).inbound) {
      app.use(inbound(this.henri));
    }

    // The N+1 detector, and only when something detects: it needs to be
    // outside enough to set a header before the answer goes out, and it does
    // no work on the way in -- the bucket is made by the first model call, on
    // the request-id store that already exists
    const queries =
      this.henri.queries &&
      this.henri.queries.enabled &&
      this.henri.queries.middleware();

    if (queries) {
      app.use(queries);
    }

    if (settings.requestTimeout) {
      app.use(requestTimeout(this.henri, settings.requestTimeout));
    }

    const helmet = secureHeaders(this.henri);

    if (helmet) {
      app.use(helmet);
    }

    if (this.henri.isProduction) {
      /* istanbul ignore next */
      app.use(compress());
    }

    // CORS is opt-in: `"cors": true` for the defaults, or the cors() options
    if (config.has('cors') && config.get('cors')) {
      const options = config.get('cors');

      app.use(cors(typeof options === 'object' ? options : undefined));
    }

    app.use(express.json({ limit: settings.bodyLimit }));
    app.use(express.urlencoded({ extended: true, limit: settings.bodyLimit }));
    app.use(cookieParser());

    app.use(boom());
    app.use(apiVersion());
    app.use(paginationMiddleware(() => this.henri.api.settings.pagination));

    // Liveness, readiness, and the name readiness answered before it had one
    const readiness = health.ready(this.henri);

    app.get(health.LIVE_PATH, health.live(this.henri));
    app.get(health.READY_PATH, readiness);
    app.get(health.HEALTH_PATH, readiness);
    app.get(health.PATH, readiness);

    app.use(express.static(path.resolve(this.henri.cwd(), 'app/views/public')));

    this.app = app;
    this.express = express;

    return this.name;
  }

  /**
   * Start the server (called later from router)
   * Mounts the router, then the 404 and error handlers, and listens.
   *
   * @async
   * @param {function} [cb=null] call back after running
   * @returns {Promise<boolean>} true once listening
   * @throws when the port is busy or the server cannot listen
   * @memberof Server
   */
  async start(cb = null) {
    const { app, henri, httpServer } = this;
    const { pen } = henri;

    if (httpServer.listening) {
      debug('server already started');

      return true;
    }

    this.rateLimits();

    app.use((req, res, next) => henri.router.handler(req, res, next));
    app.use(notFound(henri));
    app.use(errorHandler(henri));

    let { port } = this;

    // Tests get whatever port the kernel has free: asking for one and
    // binding it are a single operation, where detecting a free port and
    // then binding it races with anything else binding meanwhile
    port = henri.isTest ? 0 : port;

    // Binding is the only honest way to know a port is free: asking first and
    // binding after leaves a window for anything else to take it, which is
    // the same race that made the test suite answer from the wrong server.
    // In development we walk up from the port asked for; elsewhere a busy
    // port is an error the operator wants to see.
    const wanted = port;
    const attempts = henri.isDev ? PORT_ATTEMPTS : 0;

    for (let attempt = 0; ; attempt++) {
      try {
        await this.listen(port, this.host);
        break;
      } catch (error) {
        if (!isPortTaken(error.cause || error) || attempt >= attempts) {
          throw error;
        }

        port = wanted + attempt + 1;
      }
    }

    if (port !== wanted && wanted !== 0) {
      pen.warn('server', `port ${wanted} is busy, using ${port} instead`);
    }

    port = this.httpServer.address().port;

    const ip = lanIp();
    const urls = prepareUrls('http', this.host, ip, port);

    debug('bound to %s:%d (lan ip: %s)', this.host, port, ip);

    this.url = urls.localUrlForBrowser;
    this.port = port;

    pen.info('server', 'ready for battle');
    pen.info('server', 'local url', urls.localUrlForTerminal);
    urls.lanUrlForTerminal &&
      pen.info('server', 'network url', urls.lanUrlForTerminal);

    if (henri.isDev) {
      debug('watching the filesystem as we are in dev');
      watch(henri);
    }

    if (!henri.isTest && this.shutdownSettings().signals) {
      this.installSignalHandlers();
    }

    typeof cb === 'function' && cb();

    return true;
  }

  /**
   * Where the counters are kept, for the rate limit line of the boot.
   *
   * The boot says it on every application, shared or not, because "counted
   * in this process" is the whole of the gap `config.shared` closes and a
   * line that only appears when something is wrong is a line nobody reads.
   *
   * @returns {string} `in redis (fail closed)`, or `in this process`
   * @memberof Server
   */
  countedIn() {
    const { api, shared } = this.henri;
    const named = api && api.settings.rateLimit && api.settings.rateLimit.store;

    if (named) {
      return `in ${named}`;
    }

    return shared
      ? `in ${shared.name} (fail ${shared.onError})`
      : 'in this process';
  }

  /**
   * Warns when the counters are per process and the environment says this
   * process is one of several.
   *
   * Not on every production boot: a single process is a perfectly good
   * deployment and a warning that fires on all of them is one people learn
   * to skip. It fires when something in the environment actually says there
   * is more than one process -- a cluster worker, a numbered pm2 instance,
   * `WEB_CONCURRENCY`, a Heroku dyno past the first -- and names it.
   *
   * @returns {boolean} whether it warned
   * @memberof Server
   */
  warnUnsharedCounters() {
    const { api, pen, shared } = this.henri;
    const named = api && api.settings.rateLimit && api.settings.rateLimit.store;

    if (shared || named) {
      return false;
    }

    const evidence = manyProcesses();

    if (!evidence) {
      return false;
    }

    pen.warn(
      'api',
      `${evidence}, and the rate limit, lockout and idempotency counters are in this process only`,
      'name a shared backend once with config.shared ({ "adapter": "redis", "url": "..." })'
    );

    return true;
  }

  /**
   * Mounts the rate limits (`config.rateLimit`): the authentication
   * endpoints first (10 per minute per ip), then the global limit, counted
   * per user or ip. The global limit is not enforced in development, where
   * the view engines serve hundreds of assets per page; per-route limits
   * (`rateLimit` in the routes) always are.
   *
   * @returns {boolean} whether a limit was mounted
   * @memberof Server
   */
  rateLimits() {
    const { app, henri } = this;
    const { api, pen } = henri;
    const settings = api.settings.rateLimit;

    if (!settings) {
      pen.warn('api', 'rate limiting is disabled by configuration');

      return false;
    }

    if (settings.auth) {
      const guard = authLimiter(
        henri,
        Object.assign({}, settings.auth, { store: api.rateLimitStore('auth') })
      );

      api.limiters.push(guard);
      app.use(guard);
    }

    const global = limiter(henri, {
      max: settings.max,
      name: 'global',
      skip: () => henri.isDev,
      store: api.rateLimitStore('global'),
      windowMs: settings.windowMs,
    });

    api.limiters.push(global);
    app.use(global);

    pen.info(
      'api',
      'rate limit',
      `${settings.max} requests per ${settings.windowMs / 1000}s per user or ip${
        henri.isDev ? ' (not enforced in development)' : ''
      }, counted ${this.countedIn()}`
    );

    this.warnUnsharedCounters();

    if (henri.isProduction && app.get('trust proxy') === true) {
      pen.warn(
        'api',
        'config.trustProxy is true: ip based limits can be bypassed by forging X-Forwarded-For',
        'set it to the number of proxies in front of henri'
      );
    }

    return true;
  }

  /**
   * Listen on a port and host, as a promise
   *
   * @param {number} port the port
   * @param {string} host the host to bind to
   * @returns {Promise<void>} resolves once listening
   * @throws when the server cannot listen
   * @memberof Server
   */
  listen(port, host) {
    const { httpServer } = this;

    return new Promise((resolve, reject) => {
      const onError = (error) => {
        /* istanbul ignore next */
        if (error.code === 'EADDRINUSE') {
          return reject(
            new Error(`port ${port} already in use`, { cause: error })
          );
        }

        /* istanbul ignore next */
        return reject(
          new Error(`unable to start server: ${error.message}`, {
            cause: error,
          })
        );
      };

      httpServer.once('error', onError);
      httpServer.listen(port, host, () => {
        httpServer.off('error', onError);
        httpServer.on('error', (error) =>
          this.henri.pen.error('server', 'http server error', error)
        );
        resolve();
      });
    });
  }

  /**
   * Files changed on disk (development): check their syntax then reload
   *
   * @async
   * @param {Array<string>} files the changed files
   * @returns {Promise<boolean>} whether a reload happened
   * @memberof Server
   */
  async changed(files) {
    const { pen, utils } = this.henri;

    utils.clearConsole();
    pen.line();
    for (const file of files) {
      pen.warn(
        'server',
        'changes detected in',
        path.relative(this.henri.cwd(), file)
      );
    }
    pen.line(2);

    for (const file of files) {
      if (!fs.existsSync(file)) {
        continue;
      }

      const result = await utils.syntax(file, null, this.henri);

      if (result instanceof Error) {
        pen.warn('server', 'fix the error above to reload');

        return false;
      }
    }

    await this.henri.reload();

    return true;
  }

  /**
   * The `shutdown` settings of the configuration (read every time, so a
   * reloaded configuration is the one a later signal is served by)
   *
   * @returns {{delay: number, drain: number, signals: boolean}} the settings
   * @memberof Server
   */
  shutdownSettings() {
    return stopSettings(this.henri && this.henri.config);
  }

  /**
   * Stops accepting connections and lets the requests in flight finish
   *
   * Readiness is already 503 when this runs (`draining`), so this is the
   * moment a load balancer still polling has to notice. See
   * `base/shutdown.js` for the order and why it is that order.
   *
   * @async
   * @returns {Promise<object>} `{ drained, forced, open }`
   * @memberof Server
   */
  async drain() {
    const { delay, drain: deadline } = this.shutdownSettings();

    this.draining = true;

    return drain(this.httpServer, { deadline, delay, pen: this.henri.pen });
  }

  /**
   * Handle SIGINT/SIGTERM: drain the requests in flight, stop henri, exit
   * when done (or after the drain and stop deadlines).
   * A second signal exits immediately.
   *
   * @async
   * @param {string} signal the signal name
   * @returns {Promise<void>} resolves once the process has been told to exit
   * @memberof Server
   */
  async shutdown(signal) {
    const { pen } = this.henri;

    if (this._stopping) {
      pen.warn('server', `${signal} received again, exiting now`);

      return this.exit(1);
    }

    this._stopping = true;
    this.draining = true;
    pen.line();
    pen.warn('server', `${signal} received, stopping...`);

    const { delay, drain: deadline } = this.shutdownSettings();
    const budget = delay + deadline + STOP_TIMEOUT;
    const timer = setTimeout(() => {
      pen.error('server', `unable to stop within ${budget}ms, exiting`);
      this.exit(1);
    }, budget);

    timer.unref();

    try {
      await this.drain();
    } catch (error) {
      pen.error('server', 'unable to drain', error);
    }

    return this.henri.stop().then(
      (errors) => {
        clearTimeout(timer);
        pen.warn('server', 'exiting application...');
        pen.line();

        return this.exit(errors && errors.length > 0 ? 1 : 0);
      },
      (error) => {
        clearTimeout(timer);
        pen.fatal('server', error);

        return this.exit(1);
      }
    );
  }

  /**
   * Install the SIGINT/SIGTERM handlers (removed by stop())
   *
   * @returns {void}
   * @memberof Server
   */
  installSignalHandlers() {
    if (this._signalHandlers.length > 0) {
      return;
    }

    for (const signal of SIGNALS) {
      const handler = () =>
        this.shutdown(signal).catch((error) =>
          this.henri.pen.error('server', 'shutdown failed', error)
        );

      process.on(signal, handler);
      this._signalHandlers.push([signal, handler]);
    }
  }

  /**
   * Stops the module: closes the http server and the file watcher, restores
   * the terminal and removes the signal handlers
   *
   * This is the teardown, not the drain: `shutdown()` has already closed the
   * listener and waited for the requests in flight by the time the modules
   * stop. An application calling `henri.stop()` itself lands here directly,
   * where what is still open is closed rather than waited for -- it asked for
   * a stop, and the modules it depends on are stopping around it.
   *
   * @async
   * @returns {(string|boolean)} Module name or false
   * @memberof Server
   */
  async stop() {
    this.draining = true;

    for (const [signal, handler] of this._signalHandlers) {
      process.off(signal, handler);
    }
    this._signalHandlers = [];

    /* istanbul ignore next */
    if (this._stdinListener) {
      process.stdin.off('data', this._stdinListener);
      this._stdinListener = null;
      typeof process.stdin.setRawMode === 'function' &&
        process.stdin.setRawMode(false);
      process.stdin.pause();
    }

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    if (this.henri.api && typeof this.henri.api.stop === 'function') {
      await this.henri.api.stop();
    }

    if (this.httpServer && this.httpServer.listening) {
      await new Promise((resolve) => {
        this.httpServer.closeAllConnections &&
          this.httpServer.closeAllConnections();
        this.httpServer.close(() => resolve());
      });

      return this.name;
    }

    return false;
  }
}

module.exports = Server;
module.exports.lanIp = lanIp;
module.exports.STOP_TIMEOUT = STOP_TIMEOUT;
