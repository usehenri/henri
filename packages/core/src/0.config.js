const BaseModule = require('./base/module');
const path = require('path');
const _ = require('lodash');

class Config extends BaseModule {
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 0;
    this.name = 'config';
    this.config = null;
    this.reloadable = true;
    this.henri = null;

    this.get = this.get.bind(this);
    this.has = this.has.bind(this);
    this.reload = this.reload.bind(this);
    this.init = this.init.bind(this);
  }

  init() {
    try {
      this.config = require(path.join(
        this.henri.cwd(),
        'config',
        `${process.env.NODE_ENV || 'dev'}.json`
      ));
      return this.name;
    } catch (e) {}

    try {
      this.config = require(path.join(
        this.henri.cwd(),
        'config',
        'default.json'
      ));
      return this.name;
    } catch (e) {}
    console.error('nothing to do...');
    console.log('conf', this.config);
  }

  get(key, safe = false) {
    if (safe && !this.has(key)) {
      return false;
    }
    return _.get(this.config, key);
  }

  has(key) {
    return _.has(this.config, key);
  }

  async reload() {
    delete this.config;
    await this.init();
    return this.name;
  }

  stop() {
    return false;
  }
}

module.exports = Config;
