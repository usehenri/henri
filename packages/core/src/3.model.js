const BaseModule = require('./base/module');
const path = require('path');
const fs = require('fs');
const { loadModules } = require('./utils');
const debug = require('debug')('henri:model');
const { userConfig } = require('./base/auth');

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
    debug('constructor initialized');
  }

  /**
   * Loads the files from disk
   *
   * @static
   * @async
   * @param {string} location defaults: ./app/models
   * @returns {Promise<Object>} the models, keyed by identity
   * @throws when a model fails to load
   * @memberof Model
   */
  static async load(location) {
    const models = loadModules(path.resolve(location));

    debug('loaded from fs');

    return models;
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
    const user = userConfig(config).model.toLowerCase();

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
        this.henri.pen.error(
          'model',
          `unable to configure ${id}`,
          error.message
        );

        throw error;
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
    debug('done resetting');

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
    const {
      cwd,
      pen,
      utils: { resolveFrom },
    } = this.henri;

    try {
      const Pkg = require(resolveFrom(`@usehenri/${conn}`, cwd()));

      debug('loaded adapter %s (%s)', store.adapter, conn);

      return Pkg;
    } catch (error) {
      debug('adapter %s failed to load: %s', conn, error.message);

      throw pen.fatal(
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
      debug('store %s is already loaded, returning from cache', name);

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
      throw pen.fatal(
        'models',
        `Adapter '${store.adapter}' is not valid. Check your configuration file.`
      );
    }

    const Pkg = this.loadStore(store, valid[store.adapter]);

    try {
      this.stores[name] = new Pkg(name, store, this.henri);
    } catch (error) {
      pen.error('model', 'store', store.adapter, 'unable to load');
      throw error;
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
    try {
      await this.start(await this.configure(await Model.load('./app/models')));
      debug('init done');
    } catch (error) {
      this.henri.pen.error('model', 'error', error);
      throw error;
    }

    return this.name;
  }

  /**
   * Start the store adapters
   *
   * @async
   * @returns {Promise<void>} result
   * @memberof Model
   */
  async start() {
    try {
      for (const store of Object.keys(this.stores)) {
        debug('starting store %s', store);
        await this.stores[store].start();
      }
    } catch (error) {
      this.henri.pen.fatal('model', 'failed to start a store', null, error);
      throw error;
    }
    if (this.ids.length > 0) {
      this.addToEslintRc();
    }
    debug('start done');

    return true;
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

    if (!this.stores || Object.keys(this.stores).length < 1) {
      pen.warn('model', 'no models/stores needed to be stopped.');

      return true;
    }
    try {
      for (const store of Object.keys(this.stores)) {
        await this.stores[store].stop();
        debug('stopped %s', store);
      }
    } catch (error) {
      this.henri.pen.error('model', 'stop', error);
      throw error;
    }
    this.ids.forEach((name) => delete global[name]);
    delete this.stores;

    this.ids = [];
    this.stores = {};
    debug('stop done');

    return true;
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
      debug('reloading began');
      await this.stop();
      await this.init();
      debug('reloading done!');
    } catch (error) {
      this.henri.pen.error('model', error);
      throw error;
    }

    return this.name;
  }

  /**
   * Expose the models global ids to the linter
   *
   * Writes `.henri/globals.json` in the project (read by the project's
   * eslint.config.js) and, if a legacy `.eslintrc` exists, updates its
   * `globals` too. Nothing is written in test mode.
   *
   * @return {void}
   * @memberof Model
   */
  addToEslintRc() {
    if (this.henri.isTest) {
      return;
    }

    const globals = {};

    this.ids.forEach((modelName) => (globals[modelName] = true));

    const henriDir = path.resolve(this.henri.cwd(), '.henri');

    try {
      fs.mkdirSync(henriDir, { recursive: true });
      fs.writeFileSync(
        path.join(henriDir, 'globals.json'),
        `${JSON.stringify(globals, null, 2)}\n`
      );
    } catch (error) {
      debug('unable to write .henri/globals.json: %s', error.message);
    }

    const eslintFile = path.resolve(this.henri.cwd(), '.eslintrc');

    if (!fs.existsSync(eslintFile)) {
      return;
    }

    try {
      const eslintRc = JSON.parse(fs.readFileSync(eslintFile, 'utf8'));

      eslintRc.globals = Object.assign({}, eslintRc.globals, globals);
      fs.writeFileSync(eslintFile, `${JSON.stringify(eslintRc, null, 2)}\n`);
    } catch (error) {
      debug('unable to update .eslintrc: %s', error.message);
    }
  }

  /**
   * Gets the connect/express session storage connector from the db adapter
   *
   * The store is asked to the adapter every time this is called: the user
   * module wraps it in a proxy (base/session-store.js) that calls back here
   * after a reload, so nothing closes or replaces the store during a reload;
   * the adapter closes it in its own stop().
   *
   * @async
   * @param {Express.Session} session The express session object
   * @param {string} name The store to get
   * @returns {Promise<Express.Store>} Session.Store (or MemoryStore) instance
   * @throws when the store is not loaded or the adapter fails
   * @memberof Model
   */
  async getSessionConnector(session, name = 'default') {
    const { pen } = this.henri;
    const store = this.stores && this.stores[name];

    if (!store || typeof store.getSessionConnector !== 'function') {
      throw new Error(
        `unable to create a session store: store '${name}' is not loaded`
      );
    }

    let connector;

    try {
      connector = await store.getSessionConnector(session);

      // Adapters implementing the async contract return a ready store; a
      // sequelize-backed store built synchronously still needs its table
      if (
        connector &&
        typeof connector.sync === 'function' &&
        !(connector instanceof session.MemoryStore)
      ) {
        await connector.sync();
      }
    } catch (error) {
      pen.error('model', 'session', `unable to create the store of ${name}`);
      throw error;
    }

    if (connector instanceof session.MemoryStore) {
      pen.error('model', 'session', 'using MemoryStore instead');
    } else {
      pen.info('model', 'session', `${store.name} (${store.adapterName})`);
    }

    return connector;
  }

  /**
   * Check if the store exists or DIE DIE DIE!
   *
   * @param {any} model A model
   * @returns {void}
   * @memberof Model
   */
  checkStoreOrDie(model) {
    const { config } = this.henri;

    if (!model.store && !config.has('stores.default')) {
      throw new Error(
        `There is no default store and ${model.identity} is missing one`
      );
    }

    if (model.store && !config.has(`stores.${model.store}`)) {
      throw new Error(
        `It seems like ${model.store} is not configured. ${model.identity} is using it.`
      );
    }
  }
}

module.exports = Model;
