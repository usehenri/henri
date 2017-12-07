const time = process.hrtime();
const Henri = require('./henri');
global['henri'] = henri = new Henri();
const Log = require('@usehenri/log');

/* istanbul ignore next */

// We don't use addModule as it is not yet registered
henri.log = new Log();

require('./checks');

function reload() {
  delete henri.config;
  henri.config = require('config');
}

henri.addLoader(reload);

henri.log.info(`config module loaded in ${henri.diff(time)}ms.`);
