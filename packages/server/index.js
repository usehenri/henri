const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const timings = require('server-timings');
const compress = require('compression');
const cors = require('cors');
const path = require('path');
const chokidar = require('chokidar');
const {
  choosePort,
  prepareUrls,
} = require('react-dev-utils/WebpackDevServerUtils');
const openBrowser = require('react-dev-utils/openBrowser');
const detect = require('detect-port');

const { config, cwd, log } = henri;

const app = express();

let port = config.has('port') ? config.get('port') : 3000;

app.use(timings);
app.use(compress());
app.options('*', cors());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.resolve(cwd, 'app/views/public')));

async function start(delay, cb = null) {
  if (henri.getStatus('http') && typeof cb === 'function') return cb();

  port = henri.isTest ? await detect(port) : port;
  port = henri.isDev ? await choosePort('0.0.0.0', port) : port;
  return app
    .listen(port, function() {
      const bootTiming = delay ? ` (took ${henri.getDiff(delay)}ms)` : '';
      const urls = prepareUrls('http', '0.0.0.0', port);
      log.info(`server started on port ${port}${bootTiming}`);
      henri.isDev && watch();
      henri._url = urls.localUrlForBrowser;
      henri._port = port;
      henri.setStatus('http', true);
      typeof cb === 'function' && cb();
    })
    .on('error', typeof cb === 'function' && cb)
    .on('error', handleError);
}

async function watch() {
  const ignored = ['node_modules/', 'app/views/**', 'logs/', '.tmp/'];
  const watcher = chokidar.watch('.', { ignored });
  watcher.on('ready', () => {
    watcher.on('all', (event, path) => {
      log.warn('changes detected in', path);
      henri.reload();
    });
    log.info('watching filesystem for changes...');
  });
  process.stdin.resume();
  process.stdin.on('data', async data => {
    data = data.toString();
    const chr = data.charCodeAt(0);
    if (chr === 3) {
      await henri.stop();
      log.warn('exiting application...');
      log.space();
      process.exit(0);
    }
    if (chr === 18) {
      log.warn('user-requested server reload...');
      henri.reload();
    }
    if (chr === 14 || chr === 15) {
      if (henri._url) {
        openBrowser(henri._url);
      }
    }
  });
  process.stdin.setRawMode(true);
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

function handleError(err) {
  if (err.code === 'EADDRINUSE') {
    log.fatalError(`
    port ${port} is already in use

    modify your config or kill the other process
    `);
  }
  log.error(err);
}
henri.router = undefined;

app.use((req, res, next) => henri.router(req, res, next));

henri.app = app;
henri.express = express;
henri.start = start;

module.exports = { start, handleError, watch };

log.info('server module loaded.');
