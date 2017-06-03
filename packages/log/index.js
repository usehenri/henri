const winston = require('winston');
const { config } = henri;

const log = new winston.Logger();

log.add(winston.transports.Console, { colorize: true });

if (config.has('log') && typeof config.get('log') === 'string') {
  log.info(`logger initialized. also logging to ${config.get('log')}`);
  log.add(winston.transports.File, { filename: `logs/${config.get('log')}` });
} else {
  log.warn('no file set in configuration file: logging to console only');
}

// We don't use addModule as it is not yet registered
henri.log = log;
