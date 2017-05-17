const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const timings = require('server-timings');
const compress = require('compression');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(timings);
app.use(compress());
app.options('*', cors());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'app/public')));

function start(delay) {
  const { config, log } = henri;
  const port = config.has('port') ? config.get('port') : 3000;
  app.listen(port, function() {
    const bootTiming = delay
      ? ` (took ${Math.round(process.hrtime(delay)[1] / 1000000)}ms)`
      : '';
    log.info(`server started on port ${port}${bootTiming}`);
  });
}

if (!global['henri']) {
  global['henri'] = {};
}

global['henri'].app = app;
global['henri'].start = start;
