const path = require('path');
const fs = require('fs');
const validator = require('validator');
const readline = require('readline');
const prettier = require('prettier');
const Modules = require('./modules');

class Henri {
  constructor(runlevel = 6) {
    this.setProcess();
    const { env: { NODE_ENV }, arch, platform } = process;
    this.env = NODE_ENV;
    this.isProduction = NODE_ENV === 'production';
    this.isDev = NODE_ENV !== 'production' && NODE_ENV !== 'test';
    this.isTest = NODE_ENV === 'test';
    this.modules = new Modules(this);
    this._loaders = [];
    this._unloaders = [];
    this._models = [];
    this._middlewares = [];
    this._paths = {};
    this._routes = {};
    this._user = null;
    this.setup = this.setup.bind(this);
    this.setup();
    this.settings = {
      package: { version: '0.22.0' },
      arch,
      platform,
      runlevel,
    };
    Object.freeze(this.settings);
    this.release = this.settings.package.version || undefined;
    this.version = this.release;
    this.cwd = process.cwd();
    this.validator = validator;
    this.folders = {
      view: path.resolve('./app/views'),
    };
    this.status = {};
    this.utils = require('./utils');
  }

  setup() {
    this.setProcess = this.setProcess.bind(this);
    this.addMiddleware = this.addMiddleware.bind(this);
    this.setStatus = this.setStatus.bind(this);
    this.getStatus = this.getStatus.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
    this.syntax = this.syntax.bind(this);
    this._parseSyntax = this._parseSyntax.bind(this);
  }

  setProcess() {
    // Remove config warning when no file is available
    process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

    /* istanbul ignore next */
    if (process.env.NODE_ENV !== 'production') {
      process.on('unhandledRejection', r => console.log(r)); // eslint-disable-line no-console
    }
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
    const { log, diff } = this;
    const start = diff();
    const loaders = this._loaders;
    /* istanbul ignore next */
    Object.keys(require.cache).forEach(function(id) {
      delete require.cache[id];
    });
    try {
      /* istanbul ignore next */
      if (loaders.length > 0) {
        for (let loader of loaders) {
          await loader();
        }
      }
      // @ts-ignore
      log.info(`server hot reload completed in ${diff(start)}ms`);
      log.space();
      log.notify('Hot-reload', 'Server-side hot reload completed..');
    } catch (e) {
      console.log('got some error deep in here');
      console.log(e);
      /* istanbul ignore next */
      log.error(e);
    }
  }

  async stop() {
    const { log, diff } = this;
    const start = diff();
    const reapers = this._unloaders;
    try {
      /* istanbul ignore next */
      if (reapers.length > 0) {
        for (let reaper of reapers) {
          await reaper();
        }
      }
      // @ts-ignore
      log.warn(`server tear down completed in ${diff(start)}ms`);
    } catch (e) {
      /* istanbul ignore next */
      log.error(e);
    }
  }

  diff(ms = null) {
    if (!ms) {
      return process.hrtime();
    }
    const diff = process.hrtime(ms);
    return Math.round(diff[0] * 1000 + diff[1] / 1e6);
  }

  clearConsole() {
    // Thanks to friendly-errors-webpack-plugin
    if (process.stdout.isTTY) {
      // Fill screen with blank lines. Then move to 0 (beginning of visible part) and clear it
      const blank = '\n'.repeat(process.stdout.rows || 1);
      console.log(blank); // eslint-disable-line no-console
      readline.cursorTo(process.stdout, 0, 0);
      readline.clearScreenDown(process.stdout);
    }
  }

  // Mock function to get the data to be linted
  gql(ast) {
    return `${ast}`;
  }

  async syntax(location, onSuccess) {
    const { log } = this;
    return new Promise(resolve => {
      fs.readFile(location, 'utf8', (err, data) => {
        if (err) {
          log.error(`unable to check the syntax of ${location}`);
          return resolve(false);
        }
        this._parseSyntax(resolve, location, data, onSuccess);
      });
    });
  }

  _parseSyntax(resolve, file, data, onSuccess) {
    const { log } = this;
    try {
      prettier.format(data.toString(), {
        singleQuote: true,
        trailingComma: 'es5',
      });
      typeof onSuccess === 'function' && onSuccess();
      return resolve();
    } catch (e) {
      log.error(`while parsing ${file}`);
      console.log(' '); // eslint-disable-line no-console
      console.log(e.message); // eslint-disable-line no-console
      resolve();
    }
  }
}

module.exports = new Henri();
