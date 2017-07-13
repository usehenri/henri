// Remove config warning when no file is available
process.env.SUPPRESS_NO_CONFIG_WARNING = true;

const path = require('path');
const config = require('config');

if (!global['henri']) {
  global['henri'] = {
    _modules: {},
    _loaders: [],
    _unloaders: [],
    _models: [],
    _routes: [],
    folders: {
      view: path.resolve('./app/views'),
    },
    status: {},
  };
}

// We don't use addModule as it is not yet registered
henri.config = config;

require('@usehenri/log');

require('./helpers');

require('./register');

require('./checks');

function reload() {
  delete henri.config;
  henri.config = require('config');
}

henri.addLoader(reload);

henri.addModule('config', config, true);
