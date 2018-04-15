const BaseModule = require('./base/module');
const path = require('path');
const fs = require('fs');
const includeAll = require('include-all');
const bounce = require('bounce');

/**
 * Model module
 *
 * @class Model
 * @extends {BaseModule}
 */
class Model extends BaseModule {
  /**
   * Creates an instance of Model.
   * @memberof Model
   */
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 3;
    this.name = 'model';
    this.henri = null;

    this.ids = [];
    this.models = [];
    this.stores = {};

    this.configure = this.configure.bind(this);
    this.reset = this.reset.bind(this);
    this.loadStore = this.loadStore.bind(this);
    this.getStore = this.getStore.bind(this);
    this.init = this.init.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.reload = this.reload.bind(this);
    this.addToEslintRc = this.addToEslintRc.bind(this);
    this.checkStoreOrDie = this.checkStoreOrDie.bind(this);
  }

  /**
   * Loads the files from disk
   *
   * @static
   * @async
   * @param {string} location defaults: ./app/models
   * @returns {Promise<(Object|Error)>} list of objects
   * @memberof Model
   * @todo Change this to an inhouse loader with prettier validation
   */
  static async load(location) {
    return new Promise((resolve, reject) => {
      includeAll.optional(
        {
          dirname: path.resolve(location),
          excludeDirs: /^\.(git|svn)$/,
          filter: /(.+)\.js$/,
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

  /**
   * Configure the models and adapters
   *
   * @param {object} models Models loaded from disk
   * @returns {{ adapters: object, models: object}} Model configuration
   * @throws
   * @memberof Model
   */
  async configure(models) {
    const { config } = this.henri;
    const user = config.has('user') ? config.get('user').toLowerCase() : 'user';

    this.reset();

    const configuration = {
      adapters: {},
      models: {},
    };

    for (const id of Object.keys(models)) {
      try {
        const model = models[id];

        this.checkStoreOrDie(model);

        const storeName = model.store || 'default';
        const store = await this.getStore(storeName);

        global[model.globalId] = store.addModel(model, user);
        this.ids.push(model.globalId);
        configuration.adapters[storeName] = store;

        this.models.push(model);

        if (model.graphql) {
          this.henri.graphql.extract(model);
        }
      } catch (error) {
        bounce.rethrow(error, 'system');

        return {};
      }
    }

    this.henri.graphql.merge();

    return configuration;
  }

  /**
   * Resets private variables prior to reloading
   *
   * @returns {boolean} result
   * @memberof Model
   */
  reset() {
    delete this.henri._user;
    delete this.stores;
    delete this.ids;
    delete this.models;

    this.henri._user = null;
    this.stores = {};
    this.ids = [];
    this.models = [];

    return true;
  }

  /**
   * Load dynamically a store constructor
   *
   * @param {object} store exerpt from store configuration
   * @param {string} conn Adapter name (ex: disk, mongoose, mysql, ..)
   * @returns {function} Adapter constructor
   * @memberof Model
   */
  loadStore(store, conn) {
    const { cwd, pen } = this.henri;

    try {
      // eslint-disable-next-line global-require
      const Pkg = require(path.join(
        cwd(),
        'node_modules',
        `@usehenri/${conn}`
      ));

      return Pkg;
    } catch (error) {
      bounce.rethrow(error, 'system');

      return pen.fatal(
        'models',
        `
      Unable to load database adapter '${store.adapter}'. Seems like you 
      should install it using: npm install @usehenri/${store.adapter}`
      );
    }
  }

  /**
   * Get an existing store or return a new one
   *
   * @param {any} name Store name
   * @returns {object} A store object
   * @memberof Model
   */
  getStore(name) {
    const { config, pen } = this.henri;

    if (this.stores[name]) {
      return this.stores[name];
    }
    const store = config.get(`stores.${name}`);

    const valid = {
      disk: 'disk',
      mariadb: 'mysql',
      mongoose: 'mongoose',
      mssql: 'mssql',
      mysql: 'mysql',
      postgresql: 'postgresql',
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

    try {
      this.stores[name] = new Pkg(name, store, this.henri);
    } catch (error) {
      bounce.rethrow(error, 'system');
      pen.error('model', 'store', store.adapter, 'unable to load');
    }

    return this.stores[name];
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {Promise<string>} The name of the module
   * @memberof Model
   */
  async init() {
    return new Promise(async resolve => {
      try {
        await this.start(
          await this.configure(await Model.load('./app/models'))
        );
      } catch (error) {
        bounce.rethrow(error, 'system');
      }
      resolve(this.name);
    });
  }

  /**
   * Start the store adapters
   *
   * @async
   * @returns {Promise<void>} result
   * @memberof Model
   */
  async start() {
    return new Promise(async resolve => {
      try {
        for (const store of Object.keys(this.stores)) {
          await this.stores[store].start();
        }
      } catch (error) {
        bounce.rethrow(error, 'system');
      }
      if (this.ids.length > 0) {
        this.addToEslintRc();
      }

      return resolve();
    });
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {(string|Promise|boolean)} Module name or false
   * @memberof Model
   */
  async stop() {
    const { pen } = this.henri;

    return new Promise(async resolve => {
      if (this.stores.length < 1) {
        pen.warn('model', 'no models/stores needed to be stopped.');

        return resolve(true);
      }
      try {
        for (const store of Object.keys(this.stores)) {
          await this.stores[store].stop();
        }
      } catch (error) {
        bounce.rethrow(error, 'system');
      }
      this.ids.forEach(name => delete global[name]);
      this.ids = [];

      return resolve(true);
    });
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Model
   */
  async reload() {
    try {
      await this.stop();
      await this.init();
    } catch (error) {
      bounce.rethrow(error, 'system');
      henri.pen.error('model', error);
    }

    return this.name;
  }

  /**
   * Add models global ids to .eslintrc
   *
   * @return {void}
   * @memberof Model
   */
  addToEslintRc() {
    const eslintFile = path.resolve(this.henri.cwd(), '.eslintrc');

    try {
      const eslintRc = JSON.parse(fs.readFileSync(eslintFile, 'utf8'));

      this.ids.map(modelName => (eslintRc.globals[modelName] = true));
      fs.writeFileSync(eslintFile, JSON.stringify(eslintRc, null, 2));
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Gets the connect/express session storage connector from the db adapter
   *
   * @param {Express.Session} session The express session object
   * @param {string} name The store to get
   * @returns {Express.MemoryStore} Session.Store or Session.MemoryStore instance
   * @memberof Model
   */
  getSessionConnector(session, name = 'default') {
    try {
      const connector = this.stores[name].getSessionConnector(session);

      if (connector instanceof session.MemoryStore) {
        this.henri.pen.error('model', 'session', 'using MemoryStore instead');
      } else {
        this.henri.pen.info(
          'model',
          'session',
          `${this.stores[name].name} (${this.stores[name].adapterName})`
        );
      }

      return connector;
    } catch (error) {
      bounce.rethrow(error, 'system');
      this.henri.pen.fatal('model', error);
    }
  }

  /**
   * Check if the store exists or DIE DIE DIE!
   *
   * @param {any} model A model
   * @returns {void}
   * @memberof Model
   */
  checkStoreOrDie(model) {
    const { config, pen } = this.henri;

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
}

module.exports = Model;
