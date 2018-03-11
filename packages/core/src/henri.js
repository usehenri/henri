const validator = require('validator');
const Modules = require('./modules');
const Pen = require('./pen');

class Henri {
  constructor(runlevel = 6) {
    process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

    this.setProcess();
    Object.freeze(this.settings);

    this._loaders = [];
    this._unloaders = [];
    this._models = [];
    this._controllers = [];
    this._middlewares = [];
    this._paths = {};
    this._routes = {};
    this._user = null;

    this.pen = new Pen();
    this.modules = new Modules(this);

    this.setup = this.setup.bind(this);
    this.setup();

    this.release = this.settings.package;
    this.runlevel = runlevel;
    this.prefix = '.';

    this.status = {};

    this.validator = validator;
    this.utils = require('./utils');
  }

  setup() {
    this.setProcess = this.setProcess.bind(this);
    this.addMiddleware = this.addMiddleware.bind(this);
    this.setStatus = this.setStatus.bind(this);
    this.getStatus = this.getStatus.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
  }

  setProcess() {
    const { env: { NODE_ENV }, arch, platform } = process;

    this.env = NODE_ENV;
    this.isProduction = NODE_ENV === 'production';
    this.isDev = NODE_ENV !== 'production' && NODE_ENV !== 'test';
    this.isTest = NODE_ENV === 'test';

    this.settings = {
      package: require('../package.json').version,
      arch,
      platform,
    };

    this.cwd = process.cwd();

    /* istanbul ignore next */
    process.on('unhandledRejection', (reason, p) =>
      this.pen.fatal('promise', reason, null, p)
    );
  }

  addMiddleware(func) {
    this._middlewares.push(func);
  }

  setStatus(key, value = false) {
    this.status[key] = value;
  }

  getStatus(key) {
    return this.status[key] || undefined;
  }

  async reload() {
    const { pen, diff } = this;

    const start = diff();
    const loaders = this._loaders;

    /* istanbul ignore next */
    Object.keys(require.cache).forEach(function(id) {
      delete require.cache[id];
    });

    try {
      if (loaders.length > 0) {
        for (let loader of loaders) {
          await loader();
        }
      }

      pen.info('henri', `server hot reload completed in ${diff(start)}ms`);
      pen.line();
      pen.notify('Hot-reload', 'Server-side hot reload completed..');

      return true;
    } catch (e) {
      pen.error('henri', 'caught some error reloading');
      pen.error(e);

      return false;
    }
  }

  async stop() {
    const { pen, diff } = this;
    const start = diff();
    const reapers = this._unloaders;
    try {
      if (reapers.length > 0) {
        for (let reaper of reapers) {
          await reaper();
        }
      }
      pen.warn('henri', `server tear down completed in ${diff(start)}ms`);
      return true;
    } catch (e) {
      pen.error(e);
      return false;
    }
  }

  diff(ms = null) {
    if (!ms) {
      return process.hrtime();
    }
    const diff = process.hrtime(ms);
    return Math.round(diff[0] * 1000 + diff[1] / 1e6);
  }

  // Mock function to get the data to be linted
  gql(ast) {
    return `${ast}`;
  }
}

module.exports = new Henri();
