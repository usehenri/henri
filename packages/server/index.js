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

const { config, cwd, log, notify } = henri;

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

async function start(delay) {
  port = process.env.NODE_ENV !== 'production'
    ? await choosePort('0.0.0.0', port)
    : port;
  app
    .listen(port, function() {
      const bootTiming = delay
        ? ` (took ${Math.round(process.hrtime(delay)[1] / 1000000)}ms)`
        : '';
      const urls = prepareUrls('http', '0.0.0.0', port);
      log.info(`server started on port ${port}${bootTiming}`);
      process.env.NODE_ENV !== 'production' && watch();
      henri.localUrlForBrowser = urls.localUrlForBrowser;
    })
    .on('error', handleError);
}

async function watch() {
  const ignored = ['node_modules/', 'app/views/**', 'logs/', '.tmp/'];
  const watcher = chokidar.watch('.', { ignored });
  watcher.on('ready', () => {
    watcher.on('all', (event, path) => {
      log.warn('changes detected in', path);
      reload();
    });
    log.info('watching filesystem for changes...');
  });
  process.stdin.resume();
  process.stdin.on('data', async data => {
    data = data.toString();
    const chr = data.charCodeAt(0);
    if (chr === 3) {
      await stop();
      log.warn('exiting application...');
      console.log('');
      process.exit(0);
    }
    if (chr === 18) {
      log.warn('user-requested server reload...');
      reload();
    }
    if (chr === 14 || chr === 15) {
      if (henri.localUrlForBrowser) {
        openBrowser(henri.localUrlForBrowser);
      }
    }
  });
  process.stdin.setRawMode(true);
  setTimeout(() => {
    console.log('');
    const cmdCtrl = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
    log.info(`To reload the server codebase, use ${cmdCtrl}+R`);
    log.info(
      `To open the a new browser tab with the project, use ${cmdCtrl}+O or ${cmdCtrl}+N`
    );
    log.info(`To quit, use ${cmdCtrl}+C`);
    console.log('');
  }, 2 * 1000);
}

async function reload() {
  const start = process.hrtime();
  const loaders = henri._loaders.list;
  Object.keys(require.cache).forEach(function(id) {
    delete require.cache[id];
  });
  try {
    if (loaders.length > 0) {
      for (loader of loaders) {
        await loader();
      }
    }
    const end = Math.round(process.hrtime(start)[1] / 1000000);
    log.info(`server hot reload completed in ${end}ms`);
    console.log('');
    notify('Hot-reload', 'Server-side hot reload completed..');
  } catch (e) {
    log.error(e);
  }
}

async function stop() {
  const start = process.hrtime();
  const reapers = henri._reapers.list;
  try {
    if (reapers.length > 0) {
      for (reaper of reapers) {
        await reaper();
      }
    }
    const end = Math.round(process.hrtime(start)[1] / 1000000);
    log.warn(`server tear down completed in ${end}ms`);
  } catch (e) {
    log.error(e);
  }
}

function handleError(err) {
  if (err.code === 'EADDRINUSE') {
    log.error(`port ${port} is already in use`);
    console.log('');
    log.error('modify your config or kill the other process');
    console.log('');
    process.exit(-1);
  }
  log.error(err);
}
henri.router = undefined;

app.use((req, res, next) => henri.router(req, res, next));

henri.app = app;
henri.express = express;
henri.start = start;

log.info('server module loaded.');
