const BaseModule = require('./base/module');

const express = require('express');
const cookieParser = require('cookie-parser');
const timings = require('server-timings');
const compress = require('compression');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const chokidar = require('chokidar');
const boom = require('express-boom');
const debug = require('debug')('henri:server');
const { detect } = require('detect-port');
const internalIp = require('internal-ip');

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
 * @param {string} lanIp the LAN ip of this machine
 * @param {number} port the port
 * @returns {{localUrlForTerminal: string, lanUrlForTerminal: string, localUrlForBrowser: string}} urls
 */
function prepareUrls(protocol, lanIp, port) {
  const localUrl = `${protocol}://localhost:${port}/`;
  const lanUrl = lanIp ? `${protocol}://${lanIp}:${port}/` : null;

  return {
    lanUrlForTerminal: lanUrl,
    localUrlForBrowser: localUrl,
    localUrlForTerminal: localUrl,
  };
}

/**
 * Find a usable port, starting with the one requested
 *
 * @param {number} port the port we would like to use
 * @param {Pen} pen henri's pen, to warn if we had to change port
 * @returns {Promise<number>} a free port
 */
async function choosePort(port, pen) {
  const free = await detect(port);

  if (free !== port) {
    pen.warn('server', `port ${port} is busy, using ${free} instead`);
  }

  return free;
}

/* istanbul ignore next */
/**
 * Watch the filesystem in dev mode
 *
 * @async
 * @return {void}
 */
async function watch() {
  const watching = [
    'app/controllers',
    'app/helpers',
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
  const {
    pen,
    utils: { clearConsole },
  } = henri;

  henri.status.set('locked', true);

  const watcher = chokidar.watch(watching, {
    ignoreInitial: true,
    ignored: (file, stats) =>
      Boolean(stats && stats.isFile()) &&
      file.includes(`${path.sep}partials${path.sep}`) &&
      !/\.(html|htm|hbs)$/.test(file),
  });

  watcher.on('all', async (event, file) => {
    if (henri.status.get('locked')) {
      debug('received file modification trigger. henri is locked. returning');

      return;
    }
    henri.status.set('locked', true);
    clearConsole();
    debug('console cleared');
    pen.line();
    pen.warn('server', 'changes detected in', path.relative(henri.cwd(), file));
    pen.line(2);
    debug('checking the syntax of the changed file');
    await henri.utils.syntax(file);
    setTimeout(() => henri.status.set('locked', false), 3000);
    debug('unlocking and reloading');
    !henri.status.get('locked') && henri.reload();
  });

  henri.server.watcher = watcher;

  keyboardShortcuts();

  setTimeout(() => {
    const cmdCtrl = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';

    pen.info('server', `To reload the server codebase, use ${cmdCtrl}+R`);
    pen.info(
      'server',
      `To open the a new browser tab with the project, use ${cmdCtrl}+O or ${cmdCtrl}+N`
    );
    pen.info('server', `To quit, use ${cmdCtrl}+C`);
    henri.status.set('locked', false);
  }, 1 * 1000);
}

/* istanbul ignore next */
/**
 * Keyboard shortcuts (only when running in an interactive terminal)
 *
 * @returns {void}
 * @todo Move this to its own module with a menu and dynamic shortcuts
 */
function keyboardShortcuts() {
  const {
    pen,
    utils: { clearConsole },
  } = henri;

  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    debug('stdin is not a tty, keyboard shortcuts disabled');

    return;
  }

  process.stdin.resume();
  process.stdin.on('data', async (data) => {
    /**
     * Opens the browser at dev url
     *
     * @return {void}
     */
    const open = () => henri.server.url && openBrowser(henri.server.url);

    const chr = data.toString().charCodeAt(0);

    const actions = {
      114: async () => {
        const loaded = henri.router._results.loaded;
        const num = loaded.length;

        debug('showing routes information');

        if (num > 0) {
          clearConsole();
          henri.pen.info('router', `loaded route${num > 1 ? 's' : ''}`);
          loaded.map((val) => henri.pen.info(...val));
          henri.pen.info('router', 'total loaded', num);
        } else {
          henri.pen.info('router', 'no routes to show...');
        }
      },
      117: async () => {
        const unknown = henri.router._results.unknown;
        const num = unknown.length;

        if (num > 0) {
          clearConsole();
          henri.pen.info('router', `unknown route${num > 1 ? 's' : ''}`);
          unknown.map((val) => henri.pen.error(...val));
          henri.pen.info('router', 'total unknown', num);
        } else {
          henri.pen.info('router', 'no unknown routes to show...');
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
        henri.reload();
      },
      3: async () => {
        await henri.stop();
        pen.warn('server', 'exiting application...');
        pen.line();
        process.exit(0);
      },
    };

    /* istanbul ignore next */
    if (typeof actions[chr] !== 'undefined') {
      actions[chr]();
    }
  });
  process.stdin.setRawMode(true);
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
    this.runlevel = 2;
    this.name = 'server';
    this.henri = null;
    this.reloadable = false;

    this.port = 3000;
    this.url = '';
    this.app = null;
    this.express = null;
    this.httpServer = null;
    this.watcher = null;

    this.init = this.init.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
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
    const app = (this.app = express());

     
    this.httpServer = require('http').createServer(this.app);

    this.port = this.henri.config.has('port')
      ? this.henri.config.get('port')
      : 3000;

    app.use(timings);

    if (this.henri.isProduction) {
      /* istanbul ignore next */
      app.use(compress());
    }

    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser());

    app.use(boom());

    app.use(express.static(path.resolve(this.henri.cwd(), 'app/views/public')));

    this.app = app;
    this.express = express;

    return this.name;
  }

  /**
   * Start the server (called later from router)
   *
   * @param {number} delay ms delay
   * @param {function} [cb=null] call back after running
   * @returns {void} hangs perpetually in space, answering request...
   * @memberof Server
   */
  async start(delay, cb = null) {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise(async (resolve, reject) => {
      let { app, henri, httpServer, port } = this;
      let self = this; // Oh no!
      const lanIp = internalIp.v4.sync() || null;

      debug('using %s as the internal ip', lanIp);

      app.use((req, res, next) => henri.router.handler(req, res, next));

      port = henri.isTest ? await detect(port) : port;
      port = henri.isDev ? await choosePort(port, henri.pen) : port;

      httpServer
        .listen(port, function () {
          const urls = prepareUrls('http', lanIp, port);

          henri.pen.info('server', 'ready for battle');
          henri.pen.info('server', 'local url', urls.localUrlForTerminal);
          urls.lanUrlForTerminal &&
            henri.pen.info('server', 'network url', urls.lanUrlForTerminal);

          henri.isDev && debug('watching the filesystem as we are in dev');
          henri.isDev && watch();

          self.url = urls.localUrlForBrowser;
          self.port = port;

          typeof cb === 'function' && cb();
          resolve(true);
        })
        .on('error', (error) => {
          /* istanbul ignore next */
          if (error.code === 'EADDRINUSE') {
            return reject(new Error(`port ${port} already in use`));
          }

          /* istanbul ignore next */
          return reject(new Error(`unable to start server: ${error.message}`));
        });
    });
  }

  /**
   * Stops the module: closes the http server and the file watcher
   *
   * @async
   * @returns {(string|boolean)} Module name or false
   * @memberof Server
   */
  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
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
