const BaseModule = require('./base/module');
const path = require('path');

class Controllers extends BaseModule {
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 2;
    this.name = 'controllers';
    this.henri = null;

    this._controllers = new Map();

    this.load = this.load.bind(this);
    this.configure = this.configure.bind(this);
    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.get = this.get.bind(this);
    this.set = this.set.bind(this);
  }

  load(location) {
    const includeAll = require('include-all');
    return new Promise((resolve, reject) => {
      includeAll.optional(
        {
          dirname: path.resolve(location),
          filter: /(.+)\.js$/,
          excludeDirs: /^\.(git|svn)$/,
          flatten: true,
          keepDirectoryPath: true,
          force: true,
        },
        // with optional, it should silently fail...
        (none, modules) => {
          return resolve(modules);
        }
      );
    });
  }

  async configure(controllers) {
    for (const id in controllers) {
      const controller = controllers[id];
      for (const key in controller) {
        const method = controller[key];
        if (typeof method === 'function') {
          this._controllers.set(`${id}#${key}`, method);
        }
      }
    }
  }

  async init() {
    await this.configure(await this.load('./app/controllers'));
    return this.name;
  }

  async reload() {
    this._controllers.clear();
    await this.init();
    return this.name;
  }

  get(key) {
    return this._controllers.get(key);
  }

  set(key, value) {
    if (typeof value === 'function') {
      this._controllers.set(key, value);
      return true;
    }
    return false;
  }

  all() {
    return Array.from(this._controllers);
  }

  size() {
    return this._controllers.size;
  }

  stop() {
    return false;
  }
}

module.exports = Controllers;
