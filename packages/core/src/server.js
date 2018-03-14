const BaseModule = require('./base/module');

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const timings = require('server-timings');
const compress = require('compression');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
// const Websocket = require('@usehenri/websocket');

const {
  choosePort,
  prepareUrls,
} = require('react-dev-utils/WebpackDevServerUtils');
const openBrowser = require('react-dev-utils/openBrowser');
const detect = require('detect-port');
const prettier = require('prettier');

/* istanbul ignore next */
async function watch() {
  let watching = [
    'app/controllers',
    'app/helpers',
    'app/models',
    'app/routes.js',
    'app/websocket',
    'config/',
    './**.json',
    './**.lock',
  ];
  const watcher = chokidar.watch(watching);
  const { log, utils: { clearConsole } } = henri;
  watcher.on('ready', () => {
    watcher.on('all', async (event, path) => {
      if (henri.getStatus('locked')) {
        return;
      }
      henri.setStatus('locked', true);
      clearConsole();
      log.space();
      log.warn('changes detected in', path);
      log.space();
      log.space();
      await checkSyntax(path);
      setTimeout(() => henri.setStatus('locked', false), 750);
      !henri.getStatus('locked') && henri.reload();
    });
    log.info('watching filesystem for changes...');
  });
  keyboardShortcuts();

  setTimeout(() => {
    const cmdCtrl = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
    log.info(`To reload the server codebase, use ${cmdCtrl}+R`);
    log.info(
      `To open the a new browser tab with the project, use ${cmdCtrl}+O or ${cmdCtrl}+N`
    );
    log.info(`To quit, use ${cmdCtrl}+C`);
  }, 2 * 1000);
}

function keyboardShortcuts() {
  const { log, utils: { clearConsole } } = henri;
  process.stdin.resume();
  process.stdin.on('data', async data => {
    const chr = data.toString().charCodeAt(0);
    const open = () => henri._url && openBrowser(henri._url);
    const actions = {
      '3': async () => {
        await henri.stop();
        log.warn('exiting application...');
        log.space();
        process.exit(0);
      },
      '18': async () => {
        clearConsole();
        log.space();
        log.warn('user-requested server reload...');
        log.space();
        henri.reload();
      },
      '14': () => {
        open();
      },
      '15': () => {
        open();
      },
      '9': () => {
        log.getInspection();
      },
    };
    if (typeof actions[chr] !== 'undefined') {
      actions[chr]();
    }
  });
  process.stdin.setRawMode(true);
}

function handleError(err) {
  const { log } = henri;
  if (err.code === 'EADDRINUSE') {
    log.fatalError(`
    port is already in use
    
    modify your config or kill the other process
    `);
  }
  log.error(err);
}

const checkSyntax = file => {
  const { pen } = henri;
  return new Promise(resolve => {
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) {
        pen.error('error in writefile');
        pen.error(err);
        return resolve();
      }
      parseData(resolve, file, data);
    });
  });
};

function parseData(resolve, file, data) {
  const { pen } = henri;
  try {
    const ext = path.extname(file);
    if (ext === '.json') {
      JSON.parse(data);
      henri.setStatus('locked', false);
      return resolve();
    }
    if (ext === '.js') {
      prettier.format(data.toString(), {
        singleQuote: true,
        trailingComma: 'es5',
      });
      henri.setStatus('locked', false);
      return resolve();
    }
    resolve();
  } catch (e) {
    pen.error(`Trying to reload but caught an error:`);
    console.log(' '); // eslint-disable-line no-console
    console.log(e.message); // eslint-disable-line no-console
    resolve();
  }
}

module.exports = { handleError, watch };

class Server extends BaseModule {
  constructor(henri) {
    super();
    this.reloadable = true;
    this.runlevel = 3;
    this.name = 'server';
    this.henri = henri;
    this.reloadable = false;

    this.port = 3000;
    this.app = null;
    this.httpServer = null;

    this.init = this.init.bind(this);
    this.start = this.start.bind(this);
  }

  init() {
    const app = (this.app = express());
    this.httpServer = require('http').Server(this.app);
    // const ws = new Websocket(this.httpServer);
    // ws.init();

    this.port = henri.config.has('port') ? henri.config.get('port') : 3000;

    app.use(timings);
    if (this.henri.isProduction) {
      app.use(compress());
    }
    app.options('*', cors());
    app.use(cors());
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(cookieParser());

    app.use(express.static(path.resolve(this.henri.cwd, 'app/views/public')));

    this.henri.router = undefined;
    this.henri.app = app;
    this.henri.express = express;
    this.henri.start = this.start;
  }

  async start(delay, cb = null) {
    let { app, henri, httpServer, port } = this;
    app.use((req, res, next) => henri.router(req, res, next));

    if (henri.getStatus('http') && typeof cb === 'function') return cb();

    port = henri.isTest ? await detect(port) : port;
    port = henri.isDev ? await choosePort('0.0.0.0', port) : port;
    return httpServer
      .listen(port, function() {
        const bootTiming = delay ? ` (took ${henri.diff(delay)}ms)` : '';
        const urls = prepareUrls('http', '0.0.0.0', port);
        henri.log.info(`server started on port ${port}${bootTiming}`);
        henri.isDev && watch();
        henri._url = urls.localUrlForBrowser;
        henri._port = port;
        henri.setStatus('http', true);
        typeof cb === 'function' && cb();
      })
      .on('error', handleError);
  }
}

module.exports = Server;
