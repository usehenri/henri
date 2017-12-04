const Henri = require('./henri');
const Log = require('@usehenri/log');

/* istanbul ignore next */
global['henri'] = henri = new Henri();

// We don't use addModule as it is not yet registered
henri.log = new Log();

require('./checks');

function reload() {
  delete henri.config;
  henri.config = require('config');
}

henri.addLoader(reload);
