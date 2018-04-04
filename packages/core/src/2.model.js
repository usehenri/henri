const BaseModule = require('./base/module');
const path = require('path');
const fs = require('fs');

function checkStoreOrDie(model) {
  const { config, pen } = henri;
  if (!model.store && !config.has('stores.default')) {
    return pen.fatal(
      'models',
      `There is no default store and ${model.identity} is missing one`
    );
  }

  if (model.store && !config.has(`stores.${model.store}`)) {
    return pen.fatal(
      'models',
      `It seems like ${model.store} is not configured. ${
        model.identity
      } is using it.`
    );
  }
}

class Model extends BaseModule {
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 2;
    this.name = 'model';
    this.henri = null;

    this.ids = [];
    this.models = [];
    this.stores = {};

    this.start = this.start.bind(this);
    this.init = this.init.bind(this);
    this.stop = this.stop.bind(this);
    this.reload = this.reload.bind(this);
  }

  async load(location) {
    const includeAll = require('include-all');
    return new Promise((resolve, reject) => {
      includeAll.optional(
        {
          dirname: path.resolve(location),
          filter: /(.+)\.js$/,
          excludeDirs: /^\.(git|svn)$/,
          flatten: true,
          force: true,
        },
        (err, modules) => {
          if (err) {
            return reject(err);
          }
          return resolve(modules);
        }
      );
    });
  }

  async configure(models) {
    const { config } = this.henri;
    const user = config.has('user') ? config.get('user').toLowerCase() : 'user';

    this.reset();

    const configuration = {
      adapters: {},
      models: {},
    };

    for (const id of Object.keys(models)) {
      const model = models[id];
      checkStoreOrDie(model);
      const storeName = model.store || 'default';
      const store = await this.getStore(storeName);
      global[model.globalId] = store.addModel(model, user);
      this.ids.push(model.globalId);
      configuration.adapters[storeName] = store;
      this.models.push(model);
    }

    return configuration;
  }

  reset() {
    delete this.henri._user;
    delete this.stores;
    delete this.ids;
    delete this.models;

    this.henri._user = null;
    this.stores = {};
    this.ids = [];
    this.models = [];
  }

  loadStore(store, conn) {
    const { cwd, pen } = this.henri;
    try {
      const Pkg = henri.isTest
        ? require(`@usehenri/${conn}`)
        : require(path.resolve(cwd(), 'node_modules', `@usehenri/${conn}`));
      return Pkg;
    } catch (e) {
      return pen.fatal(
        'models',
        `
      Unable to load database adapter '${store.adapter}'. Seems like you 
      should install it using: npm install @usehenri/${store.adapter}`
      );
    }
  }

  getStore(name) {
    const { config, pen } = this.henri;

    if (this.stores[name]) {
      return this.stores[name];
    }
    const store = config.get(`stores.${name}`);

    const valid = {
      mongoose: 'mongoose',
      disk: 'disk',
      mysql: 'mysql',
      mariadb: 'mysql',
      postgresql: 'postgresql',
      mssql: 'mssql',
    };

    if (typeof valid[store.adapter] === 'undefined') {
      return pen.fatal(
        'models',
        `Adapter '${
          store.adapter
        }' is not valid. Check your configuration file.`
      );
    }

    const Pkg = this.loadStore(store, valid[store.adapter]);

    this.stores[name] = new Pkg(name, store);

    return this.stores[name];
  }

  async init() {
    return new Promise(async resolve => {
      await this.start(await this.configure(await this.load('./app/models')));
      resolve(this.name);
    });
  }

  async start(configuration) {
    return new Promise(async (resolve, reject) => {
      for (const store of Object.keys(this.stores)) {
        await this.stores[store].start();
      }
      if (this.ids.length > 0) {
        this.addToEslintRc();
      }
      return resolve();
    });
  }

  async stop() {
    const { pen } = this.henri;
    return new Promise(async (resolve, reject) => {
      if (this.stores.length < 1) {
        pen.warn('model', 'no models/stores needed to be stopped.');
        return resolve(true);
      }
      for (const store of Object.keys(this.stores)) {
        await this.stores[store].stop();
      }
      this.ids.forEach(name => delete global[name]);
      this.ids = [];
      return resolve(true);
    });
  }

  async reload() {
    await this.stop();
    await this.init();
    return this.name;
  }

  addToEslintRc() {
    const eslintFile = path.resolve(this.henri.cwd(), '.eslintrc');
    try {
      const eslintRc = JSON.parse(fs.readFileSync(eslintFile, 'utf8'));
      this.ids.map(modelName => (eslintRc.globals[modelName] = true));
      fs.writeFileSync(eslintFile, JSON.stringify(eslintRc, null, 2));
    } catch (e) {} // Do nothing
  }
}

module.exports = Model;
