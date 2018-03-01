const time = process.hrtime();
const Henri = require('./henri');
global['henri'] = henri = new Henri();

require('./checks');

function reload() {
  delete henri.config;
  henri.config = require('config');
}

henri.addLoader(reload);

henri.log.info(`config module loaded in ${henri.diff(time)}ms.`);
