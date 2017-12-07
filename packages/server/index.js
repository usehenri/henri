const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const timings = require('server-timings');
const compress = require('compression');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const {
  choosePort,
  prepareUrls,
} = require('react-dev-utils/WebpackDevServerUtils');
const openBrowser = require('react-dev-utils/openBrowser');
const detect = require('detect-port');
const prettier = require('prettier');

const { clearConsole, config, cwd, log } = henri;

const app = express();

let port = config.has('port') ? config.get('port') : 3000;

const ignored = [
  'node_modules/',
  'app/views/**',
  'logs/',
  '.tmp/',
  '.eslintrc',
  '.git',
];

app.use(timings);
app.use(compress());
app.options('*', cors());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.resolve(cwd, 'app/views/public')));

async function start(delay, cb = null) {
  app.use((req, res, next) => henri.router(req, res, next));

  if (henri.getStatus('http') && typeof cb === 'function') return cb();

  port = henri.isTest ? await detect(port) : port;
  port = henri.isDev ? await choosePort('0.0.0.0', port) : port;
  return app
    .listen(port, function() {
      const bootTiming = delay ? ` (took ${henri.diff(delay)}ms)` : '';
      const urls = prepareUrls('http', '0.0.0.0', port);
      log.info(`server started on port ${port}${bootTiming}`);
      henri.isDev && watch();
      henri._url = urls.localUrlForBrowser;
      henri._port = port;
      henri.setStatus('http', true);
      typeof cb === 'function' && cb();
    })
    .on('error', handleError);
}
/* istanbul ignore next */
async function watch() {
  if (config.has('ignore') && Array.isArray(config.get('ignore'))) {
    ignored.concat(config.get('ignore'));
  }
  log.debug(`filesystem watch ignore: ${ignored.join(' ')}`);
  const watcher = chokidar.watch('.', { ignored });
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
    config.has('ignore') &&
      log.info(
        `we will ignore these folders: ${config.get('ignore').join(' ')}`
      );
  });
  keyboardShortcuts();

  setTimeout(() => {
    log.space();
    const cmdCtrl = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
    log.info(`To reload the server codebase, use ${cmdCtrl}+R`);
    log.info(
      `To open the a new browser tab with the project, use ${cmdCtrl}+O or ${cmdCtrl}+N`
    );
    log.info(`To quit, use ${cmdCtrl}+C`);
    log.space();
  }, 2 * 1000);
}

function keyboardShortcuts() {
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
    };
    if (typeof actions[chr] !== 'undefined') {
      actions[chr]();
    }
  });
  process.stdin.setRawMode(true);
}

function handleError(err) {
  if (err.code === 'EADDRINUSE') {
    log.fatalError(`
    port ${port} is already in use
    
    modify your config or kill the other process
    `);
  }
  log.error(err);
}

const checkSyntax = file => {
  return new Promise(resolve => {
    fs.readFile(file, 'utf8', (err, data) => {
      if (err) {
        log.error('error in writefile');
        console.log(err);
        return resolve();
      }
      parseData(resolve, file, data);
    });
  });
};

function parseData(resolve, file, data) {
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
    log.error(`Trying to reload but caught an error:`);
    console.log(' '); // eslint-disable-line no-console
    console.log(e.message); // eslint-disable-line no-console
    resolve();
  }
}

henri.router = undefined;

henri.app = app;
henri.express = express;
henri.start = start;

module.exports = { start, handleError, watch };

log.info('server module loaded.');
