const winston = require('winston');
const { config } = henri;

const log = new winston.Logger();

log.add(winston.transports.Console, { colorize: true });

if (config.has('log') && typeof config.get('log') === 'string') {
  log.info(`logger initialized. also logging to ${config.get('log')}`);
  log.add(winston.transports.File, { filename: config.get('log') });
}

if (!global['henri']) {
  global['henri'] = {};
}

global['henri'].log = log;
