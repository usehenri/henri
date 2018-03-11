const config = require('config');
const { importFresh } = require('./utils');
const BaseModule = require('./base/module');

class Config extends BaseModule {
  constructor(henri) {
    super();
    this.reloadable = true;
    this.runlevel = 1;
    this.name = 'config';
    this.config = config;
    this.reloadable = true;
    this.henri = henri;

    this.get = this.get.bind(this);
    this.has = this.has.bind(this);
    this.reload = this.reload.bind(this);
    return this;
  }

  init() {
    return this;
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
    return true;
  }
}

module.exports = Config;
