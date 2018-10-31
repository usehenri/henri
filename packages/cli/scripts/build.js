process.env.FORCE_BUILD = 'true';
process.env.NODE_ENV = 'production';
process.env.CMD_BUILD = 'true';

module.exports = require('./server');
