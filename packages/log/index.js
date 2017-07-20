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
    this.setup({ customWidth });

    return this;
  }

  static name() {
    return 'log';
  }

  static reloadable() {
    return false;
  }

  setup() {
    const { config = new Set() } = henri;

    this.winston.add(winston.transports.Console, {
      colorize: true,
      customWidth: this.customWidth,
      formatter: options => {
        // thanks to https://github.com/geowarin/friendly-errors-webpack-plugin/
        const color = getColor(options.level);
        const dateString = chalk.grey(new Date().toLocaleTimeString());
        const title = chalk[color].inverse(` ${options.level.toUpperCase()} `);
        const message = chalk[color](options.message ? options.message : '');
        const meta = chalk[color](
          options.meta && Object.keys(options.meta).length
            ? '\n\t' + JSON.stringify(options.meta, null, 2)
            : ''
        );
        const fullMsg = `${title} ${message || meta}`;

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

  fatalError(msg) {
    // eslint-disable-next-line no-console
    console.log('');
    const lines = msg.split('\n');
    for (let line of lines) {
      this.error(line);
    }
    // eslint-disable-next-line no-console
    console.log('');
    throw new Error(msg);
  }

  notify(title = 'No title', message = 'No message') {
    if (henri.isDev) {
      return notifier.notify({
        title,
        message,
        icon: path.join(__dirname, 'henri.png'),
      });
    }
  }

  space() {
    // eslint-disable-next-line no-console
    console.log(' ');
  }
}

function getColor(level) {
  switch (level.toLowerCase()) {
    case 'error':
      return 'red';
    case 'warn':
      return 'yellow';
    case 'info':
      return 'green';
    case 'verbose':
      return 'white';
    case 'debug':
      return 'blue';
    case 'silly':
      return 'magenta';
    default:
      return 'red';
  }
}

module.exports = Log;
