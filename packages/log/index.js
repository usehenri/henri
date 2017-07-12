const winston = require('winston');
const chalk = require('chalk');
const path = require('path');
const stringWidth = require('string-width');
const notifier = require('node-notifier');
const { config } = henri;

const log = new winston.Logger();

log.add(winston.transports.Console, {
  colorize: true,
  formatter: function(options) {
    // thanks to https://github.com/geowarin/friendly-errors-webpack-plugin/
    const color = getColor(options.level);
    const date = new Date();
    const dateString = chalk.grey(date.toLocaleTimeString());
    const title = chalk[color].inverse(` ${options.level.toUpperCase()} `);
    const message = chalk[color](options.message ? options.message : '');
    const meta = chalk[color](
      options.meta && Object.keys(options.meta).length
        ? '\n\t' + JSON.stringify(options.meta, null, 2)
        : ''
    );
    const fullMsg = `${title} ${message || meta}`;
    let space =
      process.stdout.columns - stringWidth(fullMsg) - stringWidth(dateString);
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
  log.info(`logger initialized. also logging to ${config.get('log')}`);
  log.add(winston.transports.File, {
    filename: path.resolve(process.cwd(), 'logs', `${config.get('log')}`),
  });
} else {
  log.warn('no file set in configuration file: logging to console only');
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

function notify(title = 'No title', message = 'No message') {
  if (process.env.NODE_ENV !== 'production') {
    return notifier.notify({
      title,
      message,
      icon: path.join(__dirname, 'henri.png'),
    });
  }
}

log.fatalError = msg => {
  // eslint-disable-next-line no-console
  console.log('');
  const lines = msg.split('\n');
  for (let line of lines) {
    log.error(line);
  }
  // eslint-disable-next-line no-console
  console.log('');
  throw new Error(msg);
};

// We don't use addModule as it is not yet registered
henri.log = log;
henri.log.getColor = getColor;
henri.notify = notify;
