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
  const { pen, utils: { clearConsole } } = henri;
  watcher.on('ready', () => {
    watcher.on('all', async (event, path) => {
      if (henri.status.get('locked')) {
        return;
      }
      henri.status.set('locked', true);
      clearConsole();
      pen.line();
      pen.warn('server', 'changes detected in', path);
      pen.line(2);
      await checkSyntax(path);
      setTimeout(() => henri.status.set('locked', false), 750);
      !henri.status.get('locked') && henri.reload();
    });
    pen.info('server', 'watching filesystem for changes...');
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
  }, 2 * 1000);
}

function keyboardShortcuts() {
  const { pen, utils: { clearConsole } } = henri;
  process.stdin.resume();
  process.stdin.on('data', async data => {
    const chr = data.toString().charCodeAt(0);
    const open = () => henri._url && openBrowser(henri._url);
    const actions = {
      '3': async () => {
        await henri.stop();
        pen.warn('server', 'exiting application...');
        pen.line();
        process.exit(0);
      },
      '18': async () => {
        clearConsole();
        pen.line();
        pen.warn('server', 'user-requested server reload...');
        pen.line();
        henri.reload();
      },
      '14': () => {
        open();
      },
      '15': () => {
        open();
      },
    };
    if (typeof actions[chr] !== 'undefined') {
      actions[chr]();
    }
  });
  process.stdin.setRawMode(true);
}

function handleError(err) {
  const { pen } = henri;
  if (err.code === 'EADDRINUSE') {
    pen.fatal(
      'server',
      `
    port is already in use
    
    modify your config or kill the other process
    `
    );
  }
  pen.error('server', err);
}

const checkSyntax = file => {
  const { pen } = henri;
  return new Promise(resolve => {
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) {
        pen.error('server', 'error in writefile');
        pen.error('server', err);
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
      henri.status.set('locked', false);
      return resolve();
    }
    if (ext === '.js') {
      prettier.format(data.toString(), {
        singleQuote: true,
        trailingComma: 'es5',
      });
      henri.status.set('locked', false);
      return resolve();
    }
    resolve();
  } catch (e) {
    pen.error('server', `Trying to reload but caught an error:`);
    console.log(' '); // eslint-disable-line no-console
    console.log(e.message); // eslint-disable-line no-console
    resolve();
  }
}

class Server extends BaseModule {
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

    this.init = this.init.bind(this);
    this.start = this.start.bind(this);
  }

  init() {
    const app = (this.app = express());
    this.httpServer = require('http').Server(this.app);
    // const ws = new Websocket(this.httpServer);
    // ws.init();

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

  async start(delay, cb = null) {
    let { app, henri, httpServer, port } = this;

    app.use((req, res, next) => henri.router.handler(req, res, next));

    // if (henri.getStatus('http') && typeof cb === 'function') return cb();

    port = henri.isTest ? await detect(port) : port;
    port = henri.isDev ? await choosePort('0.0.0.0', port) : port;
    return httpServer
      .listen(port, function() {
        henri.pen.info('server', 'ready for battle');
        const urls = prepareUrls('http', '0.0.0.0', port);
        henri.isDev && watch();

        this.url = urls.localUrlForBrowser;
        this.port = port;

        typeof cb === 'function' && cb();
      })
      .on('error', handleError);
  }

  stop() {
    return false;
  }
}

module.exports = Server;
