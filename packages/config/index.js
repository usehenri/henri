// Remove config warning when no file is available
process.env.SUPPRESS_NO_CONFIG_WARNING = true;

const config = require('config');

if (!global['henri']) {
  global['henri'] = {
    _modules: {},
    _loaders: {
      list: [],
    },
    _models: [],
    _globalRoutes: [],
  };
}

// We don't use addModule as it is not yet registered
henri.config = config;

require('@usehenri/log');

require('./checks');

require('./register');

function reload() {
  henri.config = require('config');
}

henri.addLoader(reload);

henri.addModule('config', config, true);
