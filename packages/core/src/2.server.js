const BaseModule = require('./base/module');

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const timings = require('server-timings');
const compress = require('compression');
const cors = require('cors');
const path = require('path');
const chokidar = require('chokidar');
const boom = require('boom');
// REMOVED: const Websocket = require('@usehenri/websocket');

const {
  choosePort,
  prepareUrls,
} = require('react-dev-utils/WebpackDevServerUtils');
const openBrowser = require('react-dev-utils/openBrowser');
const detect = require('detect-port');

/**
 * Watch the filesystem in dev mode
 *
 * @async
 * @return {void}
 */
async function watch() {
  let watching = [
    'app/controllers/**',
    'app/helpers/**',
    'app/models/**',
    'app/routes.js',
    'app/websocket/**',
    'app/views/partials/**/*.html',
    'config/',
    './**.json',
    './**.lock',
  ];
  const { pen, utils: { clearConsole } } = henri;

  henri.status.set('locked', true);
  chokidar.watch(watching).on('all', async (event, path) => {
    if (henri.status.get('locked')) {
      return;
    }
    henri.status.set('locked', true);
    clearConsole();
    pen.line();
    pen.warn('server', 'changes detected in', path);
    pen.line(2);
    await henri.utils.checkSyntax(path);
    setTimeout(() => henri.status.set('locked', false), 3000);
    !henri.status.get('locked') && henri.reload();
  });

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

/**
 * Keyboard shortcuts
 *
 * @returns {void}
 * @todo Move this to its own module with a menu and dynamic shortcuts
 */
function keyboardShortcuts() {
  const { pen, utils: { clearConsole } } = henri;

  process.stdin.resume();
  process.stdin.on('data', async data => {
    /**
     * Opens the browser at dev url
     *
     * @return {void}
     */
    const open = () => henri.server.url && openBrowser(henri.server.url);
    const chr = data.toString().charCodeAt(0);
    const actions = {
      '14': () => {
        open();
      },
      '15': () => {
        open();
      },
      '18': async () => {
        clearConsole();
        pen.line();
        pen.warn('server', 'user-requested server reload...');
        pen.line();
        henri.reload();
      },
      '3': async () => {
        await henri.stop();
        pen.warn('server', 'exiting application...');
        pen.line();
        process.exit(0);
      },
    };

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

    this.boom = boom;

    this.init = this.init.bind(this);
    this.start = this.start.bind(this);
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

    // eslint-disable-next-line global-require
    this.httpServer = require('http').Server(this.app);

    // WEBSOCKET: const ws = new Websocket(this.httpServer);
    // WEBSOCKET: ws.init();

    this.port = this.henri.config.has('port')
      ? this.henri.config.get('port')
      : 3000;

    app.use(timings);

    if (this.henri.isProduction) {
      app.use(compress());
    }

    app.options('*', cors());
    app.use(cors());
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(cookieParser());

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
    return new Promise(async resolve => {
      let { app, henri, httpServer, port } = this;
      let self = this; // Oh no!

      app.use((req, res, next) => henri.router.handler(req, res, next));

      port = henri.isTest ? await detect(port) : port;
      port = henri.isDev ? await choosePort('0.0.0.0', port) : port;

      httpServer
        .listen(port, function() {
          const urls = prepareUrls('http', '0.0.0.0', port);

          henri.pen.info('server', 'ready for battle');
          henri.isDev && watch();

          self.url = urls.localUrlForBrowser;
          self.port = port;

          typeof cb === 'function' && cb();
          resolve(true);
        })
        .on('error', error => {
          if (error.code === 'EADDRINUSE') {
            throw new Error(`port ${self.port} already in use`);
          }
          throw new Error(`unable to start server: ${error.message}`);
        });
    });
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {(string|boolean)} Module name or false
   * @memberof Server
   * @todo wish we could stop that http/express instance in a clean manner...
   */
  async stop() {
    return false;
  }
}

module.exports = Server;
