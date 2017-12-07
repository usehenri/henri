const config = require('config');

class Config {
  constructor(opts) {
    if (!opts) {
      return config;
    }
    this.config = opts;
    return this.config;
  }

  has(key) {
    if (typeof this.config[key] !== 'undefined') {
      return this.config[key];
    }
    return false;
  }

  get(key) {
    return (
      this.has(key) || new Error(`Configuration key ${key} does not exists`)
    );
  }

  set(key, value) {
    this.config[key] = value;
  }
}

module.exports = Config;
