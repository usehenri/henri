const config = require('config');
const { importFresh } = require('./utils');
const BaseModule = require('./base/module');

class Config extends BaseModule {
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 0;
    this.name = 'config';
    this.config = config;
    this.reloadable = true;
    this.henri = null;

    this.get = this.get.bind(this);
    this.has = this.has.bind(this);
    this.reload = this.reload.bind(this);
    this.init = this.init.bind(this);
    return this;
  }

  init() {
    return this.name;
  }

  get(key, safe = false) {
    if (safe && !this.config.has(key)) {
      return false;
    }
    return this.config.get(key);
  }

  has(key) {
    return this.config.has(key);
  }

  reload() {
    delete this.config;
    this.config = importFresh('config');
    return this.name;
  }

  stop() {
    return false;
  }
}

module.exports = Config;
