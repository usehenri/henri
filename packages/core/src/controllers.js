const BaseModule = require('./base/module');
const includeAll = require('include-all');
const path = require('path');

class Controllers extends BaseModule {
  constructor(henri) {
    super();
    this.reloadable = true;
    this.runlevel = 2;
    this.name = 'controller';
    this.henri = henri;

    this.load = this.load.bind(this);
    this.configure = this.configure.bind(this);
    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
  }

  load(location) {
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
    const configured = {};
    for (const id in controllers) {
      const controller = controllers[id];
      for (const key in controller) {
        const method = controller[key];
        if (typeof method === 'function') {
          configured[`${id}#${key}`] = method;
        }
      }
    }

    henri.controllers = configured;
  }

  async init() {
    const { config } = this.henri;
    await this.configure(
      await this.load(
        config.has('location.controllers')
          ? path.resolve(config.get('location.controllers'))
          : './app/controllers'
      )
    );
  }

  async reload() {
    delete this.henri.controllers;
    await this.init();
  }
}

module.exports = Controllers;
