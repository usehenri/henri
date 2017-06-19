// Remove config warning when no file is available
process.env.SUPPRESS_NO_CONFIG_WARNING = true;

const path = require('path');
const config = require('config');

if (!global['henri']) {
  global['henri'] = {
    _modules: {},
    _loaders: {
      list: [],
    },
    _reapers: {
      list: [],
    },
    _models: [],
    _routes: [],
    folders: {
      view: path.resolve('./app/views'),
    },
  };
}

// We don't use addModule as it is not yet registered
henri.config = config;

require('@usehenri/log');

require('./register');

require('./checks');

function reload() {
  henri.config = require('config');
}

henri.addLoader(reload);

henri.addModule('config', config, true);
