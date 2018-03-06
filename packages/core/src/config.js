const config = require('config');
const { importFresh } = require('./utils');
const BaseModule = require('./base/module');

class Config extends BaseModule {
  constructor() {
    super();
    this.name = 'config';
    this.config = config;
    this.reloadable = true;
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
  }
}

module.exports = Config;
