const config = require('config');

export default class Config {
  config: any;
  constructor(opts?: object) {
    if (!opts) {
      return config;
    }
    this.config = opts;
    return this.config;
  }

  has(key: string): any {
    if (typeof this.config[key] !== 'undefined') {
      return this.config[key];
    }
    return false;
  }

  get(key: string) {
    return (
      this.has(key) || new Error(`Configuration key ${key} does not exists`)
    );
  }

  set(key: string, value: any) {
    this.config[key] = value;
  }
}
