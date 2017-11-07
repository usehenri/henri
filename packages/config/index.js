// Remove config warning when no file is available
process.env.SUPPRESS_NO_CONFIG_WARNING = true;

if (process.env.NODE_ENV !== 'production') {
  process.on('unhandledRejection', r => console.log(r));
}

const path = require('path');
const config = require('config');
const Log = require('@usehenri/log');

if (!global['henri']) {
  global['henri'] = {
    _modules: {},
    _loaders: [],
    _unloaders: [],
    _models: [],
    _routes: [],
    _middlewares: [],
    folders: {
      view: config.has('location.view')
        ? config.get('location.view')
        : path.resolve('./app/views'),
    },
    status: {},
  };
}

// We don't use addModule as it is not yet registered
henri.config = config;
henri.log = new Log();

require('./helpers');

require('./register');

require('./checks');

function reload() {
  delete henri.config;
  henri.config = require('config');
}

henri.addLoader(reload);

henri.addModule('config', config, true);
