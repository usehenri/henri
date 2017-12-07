const winston = require('winston');
const chalk = require('chalk');
const path = require('path');
const stringWidth = require('string-width');
const notifier = require('node-notifier');

class Log {
  constructor({ customWidth = null } = {}) {
    this.since = Date.now();
    this.customWidth = customWidth;
    this.winston = new winston.Logger();
    this._time = process.uptime();
    this._timeSkipped = 0;
    this.setup();
    this.file = this.file.bind(this);
    this.time = this.time.bind(this);
    this.setup = this.setup.bind(this);
    this.error = this.error.bind(this);
    this.warn = this.warn.bind(this);
    this.info = this.info.bind(this);
    this.verbose = this.verbose.bind(this);
    this.debug = this.debug.bind(this);
    this.silly = this.silly.bind(this);
    this.output = this.output.bind(this);
    return this;
  }

  static name() {
    return 'log';
  }

  static reloadable() {
    return false;
  }

  setup() {
    let config = new Map();

    /* istanbul ignore if */
    if (global['henri'] && global['henri'].config) {
      config = henri.config;
    }

    this.winston.add(winston.transports.Console, {
      colorize: true,
      customWidth: this.customWidth,
      formatter: options => {
        const { dateString, fullMsg } = this.output(options);

        let space =
          (this.customWidth || process.stdout.columns) -
          stringWidth(fullMsg) -
          stringWidth(dateString);
        /* istanbul ignore if */
        if (space <= 0) {
          space = 10;
        }
        return `${fullMsg}${' '.repeat(space)}${dateString}`;
      },
    });
    this.file(config);
  }

  file(config) {
    /* istanbul ignore next */
    if (config.has('log') && typeof config.get('log') === 'string') {
      // eslint-disable-next-line no-console
      console.log('');
      this.winston.info(
        `logger initialized. also logging to ${config.get('log')}`
      );
      this.winston.add(winston.transports.File, {
        filename: path.resolve(process.cwd(), 'logs', `${config.get('log')}`),
      });
    } else {
      this.winston.warn(
        'no file set in configuration file: logging to console only'
      );
    }
  }

  /* istanbul ignore next */
  error(...args) {
    this.winston.error(...args);
  }

  /* istanbul ignore next */
  warn(...args) {
    this.winston.warn(...args);
  }

  /* istanbul ignore next */
  info(...args) {
    this.winston.info(...args);
  }

  /* istanbul ignore next */
  verbose(...args) {
    this.winston.verbose(...args);
  }

  /* istanbul ignore next */
  debug(...args) {
    this.winston.debug(...args);
  }

  /* istanbul ignore next */
  silly(...args) {
    this.winston.silly(...args);
  }

  getColor(color) {
    return getColor(color);
  }

  fatalError(msg) {
    // eslint-disable-next-line no-console
    console.log('');
    const lines = msg.split('\n');
    for (let line of lines) {
      /* istanbul ignore next */
      if (line.length > 2) {
        this.error(line);
      }
    }
    // eslint-disable-next-line no-console
    console.log('');
    throw new Error(msg);
  }

  /* istanbul ignore next */
  notify(title = 'No title', message = 'No message') {
    if (henri.isDev) {
      return notifier.notify({
        title,
        message,
        icon: path.join(__dirname, 'henri.png'),
      });
    }
  }

  /* istanbul ignore next */
  space() {
    // eslint-disable-next-line no-console
    return console.log(' ');
  }

  time() {
    const delta = Math.round((process.uptime() - this._time) * 1000, 1);
    if (delta < 6 && this._timeSkipped < 3) {
      this._timeSkipped++;
      return '';
    }
    this._timeSkipped = 0;
    this._time = process.uptime();
    return `+${delta}ms`;
  }

  output(options) {
    const color = getColor(options.level);
    const dateString = chalk.grey(new Date().toLocaleTimeString());
    const title = chalk[color].inverse(` ${options.level.toUpperCase()} `);
    /* istanbul ignore next */
    const message = chalk[color](options.message ? options.message : '');
    /* istanbul ignore next */
    const meta = chalk[color](
      options.meta && Object.keys(options.meta).length
        ? '\n\t' + JSON.stringify(options.meta, null, 2)
        : ''
    );
    /* istanbul ignore next */
    const fullMsg = `${title} ${message || meta} ${chalk['grey'](this.time())}`;

    return { dateString, fullMsg };
  }
}

function getColor(level) {
  const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    verbose: 'white',
    debug: 'blue',
    silly: 'magenta',
  };
  return colors[level.toLowerCase()] || 'red';
}

module.exports = Log;
