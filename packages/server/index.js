const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const timings = require('server-timings');
const compress = require('compression');
const cors = require('cors');
const path = require('path');
const chokidar = require('chokidar');

const { config, log } = henri;

const app = express();
const port = config.has('port') ? config.get('port') : 3000;

app.use(timings);
app.use(compress());
app.options('*', cors());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'app/public')));

function start(delay) {
  app
    .listen(port, function() {
      const bootTiming = delay
        ? ` (took ${Math.round(process.hrtime(delay)[1] / 1000000)}ms)`
        : '';
      log.info(`server started on port ${port}${bootTiming}`);
      process.env.NODE_ENV !== 'production' && watch();
    })
    .on('error', handleError);
}

async function watch() {
  const ignored = ['node_modules/', 'app/views/**', 'logs/', '.tmp/'];
  const watcher = chokidar.watch('.', { ignored });
  watcher.on('ready', () => {
    watcher.on('all', (event, path) => {
      const loaders = henri._loaders.list;
      log.warn('changes detected in', path);
      reload(loaders);
    });
    log.info('watching filesystem for changes...');
  });
}

async function reload(loaders) {
  const start = process.hrtime();
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

henri.log.info('server module loaded.');
