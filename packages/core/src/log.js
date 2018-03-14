const BaseModule = require('./base/module');
const { getColor } = require('./utils');
const winston = require('winston');
const chalk = require('chalk');
const path = require('path');
const stringWidth = require('string-width');

class Log extends BaseModule {
  constructor(henri) {
    super();
    this.runlevel = 2;
    this.name = 'log';
    this.reloadable = false;
    this.since = Date.now();
    this.winston = new winston.Logger();
    this.henri = henri;
    this._time = process.uptime();
    this._timeSkipped = 0;

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

  /* istanbul ignore next */
  init() {
    return new Promise(resolve => {
      this.winston.add(winston.transports.Console, {
        colorize: true,
        formatter: options => {
          const { dateString, fullMsg } = this.output(options);

          let space =
            (process.stdout.columns || 100) -
            stringWidth(fullMsg) -
            stringWidth(dateString);
          if (space <= 0) {
            space = 10;
          }
          return `${fullMsg}${' '.repeat(space)}${dateString}`;
        },
      });
      this.file();
      resolve();
    });
  }

  file() {
    const { config, pen } = this.henri;

    /* istanbul ignore next */
    if (config.has('log') && typeof config.get('log') === 'string') {
      pen.info('log', 'target', `${config.get('log')}`);

      this.winston.add(winston.transports.File, {
        filename: path.resolve(process.cwd(), 'logs', `${config.get('log')}`),
      });
    } else {
      pen.warn('log', 'no config', 'console only');
    }
  }

  error(...args) {
    this.winston.error(...args);
  }

  warn(...args) {
    this.winston.warn(...args);
  }

  info(...args) {
    this.winston.info(...args);
  }

  verbose(...args) {
    this.winston.verbose(...args);
  }

  debug(...args) {
    this.winston.debug(...args);
  }

  silly(...args) {
    this.winston.silly(...args);
  }

  getColor(color) {
    return getColor(color);
  }

  time() {
    const delta = Math.round((process.uptime() - this._time) * 1000);
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

module.exports = Log;
