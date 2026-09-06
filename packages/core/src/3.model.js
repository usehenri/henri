const { check } = require('./base/arguments');
const { fail, stamp } = require('./base/errors');
const BaseModule = require('./base/module');
const path = require('path');
const fs = require('fs');
const { loadModules } = require('./utils');
const debug = require('debug')('henri:model');
const { userConfig } = require('./base/auth');
const { modelErrors } = require('./base/model-errors');
const { engine: graphqlEngine } = require('./base/graphql');
const { blocksOf: graphqlBlocks } = require('./base/graphql-schema');
const {
  build: buildReferences,
  publish: publishRecords,
} = require('./base/references');

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
    // The keyring is read before the models, because a field marked
    // `encrypted` is registered as the adapter builds it and a model that
    // says it and an application that has no key must not agree to run
    this.needs = ['config', 'encryption'];
    // Ordering only: the schema is built from the models, but an
    // application without @usehenri/graphql has no graphql module at all
    this.after = ['graphql'];
    this.runlevel = 3;
    this.name = 'model';
    this.henri = null;

    this.ids = [];
    this.models = [];
    this.stores = {};
    // Which fields are foreign keys, which models carry a public
    // identifier, and which constructor belongs to which model (see
    // base/references.js). Rebuilt every time the stores start, because
    // the associations only exist once `associate()` has run.
    this.referenceTable = { classes: new Map(), models: {} };

    this.configure = this.configure.bind(this);
    this.extractGraphql = this.extractGraphql.bind(this);
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
          // Asked here so the failure names the model that reached for the
          // package; what it extracts is built once the models are all in
          graphqlEngine(
            this.henri,
            `${model.globalId} declares graphql types and resolvers`
          );
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

    this.extractGraphql();

    // Without @usehenri/graphql there is nothing to merge, and nothing to
    // say: only a model reaching for it above is worth an error
    this.henri.graphql && this.henri.graphql.merge();

    return configuration;
  }

  /**
   * Hands the GraphQL engine what every model that asked for it declares.
   *
   * A model writing `graphql: { types, resolvers }` is extracted exactly as
   * it wrote it; one saying `graphql: true` gets the definition derived
   * from its own schema (`base/graphql-schema.js`), which is why this runs
   * once the models are all loaded rather than one at a time: the privacy
   * map that decides which fields may leave the server is built from all of
   * them at once, the way `base/openapi.js` builds it.
   *
   * @returns {Array<string>} the models henri generated a definition for
   * @throws HENRI_API_GRAPHQL_INVALID_DECLARATION on a `graphql` key henri cannot read
   * @memberof Model
   */
  extractGraphql() {
    const generated = [];

    if (!this.henri.graphql) {
      return generated;
    }

    for (const block of graphqlBlocks(this.henri, this.models)) {
      this.henri.graphql.extract(block);

      if (block.description.generate) {
        generated.push(block.globalId);
      }
    }

    if (generated.length > 0) {
      this.henri.pen.info(
        'graphql',
        `derived from ${generated.length} model${generated.length === 1 ? '' : 's'}`,
        generated.join(', ')
      );
    }

    debug('graphql derived for %o', generated);

    return generated;
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
    this.referenceTable = { classes: new Map(), models: {} };

    // What the models declared `encrypted` is registered by the adapters
    // as they build them, so a reload starts from nothing here too
    if (this.henri.encryption) {
      this.henri.encryption.reset();
    }

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
      should install it using: npm install @usehenri/${store.adapter}`,
        null,
        null,
        'HENRI_STORE_ADAPTER_NOT_INSTALLED'
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

    check('henri.model.getStore', [name]);

    if (this.stores[name]) {
      debug('store %s is already loaded, returning from cache', name);

      return this.stores[name];
    }

    // `config.get` would answer HENRI_CONFIG_UNKNOWN_KEY here, which reads
    // as a problem with the configuration file rather than with the name
    // that was asked for
    if (!config.has(`stores.${name}`)) {
      throw fail(
        'HENRI_MODEL_UNKNOWN_STORE',
        `there is no store named "${name}": the configuration holds ${
          Object.keys(config.has('stores') ? config.get('stores') : {}).join(
            ', '
          ) || 'none'
        }`
      );
    }

    const store = config.get(`stores.${name}`);

    const valid = {
      disk: 'disk',
      drizzle: 'drizzle',
      mariadb: 'mysql',
      mongoose: 'mongoose',
      mssql: 'mssql',
      mysql: 'mysql',
      postgresql: 'postgresql',
    };

    if (typeof valid[store.adapter] === 'undefined') {
      throw pen.fatal(
        'models',
        `Adapter '${store.adapter}' is not valid. Check your configuration file.`,
        null,
        null,
        'HENRI_STORE_UNKNOWN_ADAPTER'
      );
    }

    const Pkg = this.loadStore(store, valid[store.adapter]);

    try {
      this.stores[name] = this.instrument(new Pkg(name, store, this.henri));
    } catch (error) {
      pen.error('model', 'store', store.adapter, 'unable to load');
      throw error;
    }

    return this.stores[name];
  }

  /**
   * Give the adapter's `query()` a span, when spans of stores are wanted
   *
   * `query()` is the one store call henri makes on its own behalf -- the
   * queue's claim, the trail's insert, a webhook lookup -- and the one
   * boundary here that does not need anybody's driver opened up. A model
   * call an application makes is *not* covered, deliberately: that belongs
   * to the ORM's own instrumentation package, and `base/telemetry.js` says
   * so.
   *
   * The wrapping **is** the instrumentation: an application that is not
   * tracing gets the adapter's own method, untouched, with nothing to test
   * per call.
   *
   * The statement is never an attribute. It carries values.
   *
   * @param {object} store the adapter henri just built
   * @returns {object} the same adapter
   * @memberof Model
   */
  instrument(store) {
    const { telemetry } = this.henri;

    if (!telemetry || !telemetry.on('stores')) {
      return store;
    }

    if (typeof store.query !== 'function') {
      return store;
    }

    const query = store.query.bind(store);
    const options = {
      attributes: {
        'db.system': store.dialect || store.adapterName || 'unknown',
        'henri.store': store.name,
      },
      boundary: 'stores',
      kind: 'client',
    };

    store.query = (...args) =>
      telemetry.span('henri.store.query', options, () => query(...args));

    return store;
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
      this.henri.pen.fatal(
        'model',
        'failed to start a store',
        null,
        error,
        'HENRI_STORE_START_FAILED'
      );

      throw stamp(error, 'HENRI_STORE_START_FAILED');
    }
    // The associations exist now: `associate(models)` ran inside start()
    this.referenceTable = buildReferences(this.stores);
    debug(
      'reference table: %d models, %d classes',
      Object.keys(this.referenceTable.models).length,
      this.referenceTable.classes.size
    );

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
    this.referenceTable = { classes: new Map(), models: {} };
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
      throw fail(
        'HENRI_STORE_SESSION_UNAVAILABLE',
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
   * The public form of a record, a list of records, or anything holding
   * some: no internal id anywhere, and every declared foreign key replaced
   * by the public identifier of the row it names.
   *
   * `res.render()`, `res.resource()` and `res.collection()` call this on
   * their way out, so an application never has to. It is exposed for the
   * one case they cannot cover: a controller that presents its records --
   * builds a new object out of them -- hands those calls a plain object,
   * and a plain object carries no model, so nothing downstream can tell a
   * foreign key from any other number. Publish first, present second.
   *
   * ```js
   * const published = await henri.model.publish(records);
   *
   * return res.collection(published.map(present), { subject: records });
   * ```
   *
   * One call covers one whole answer: the lookups behind the foreign keys
   * are batched, one statement per target model (see base/references.js).
   *
   * @param {*} value a record, a list of records, or anything else
   * @returns {Promise<*>} the value, published
   * @memberof Model
   */
  publish(value) {
    return publishRecords(this.henri, value);
  }

  /**
   * The validation messages of an error, in one shape for every adapter
   *
   * Mongoose, Sequelize and Drizzle reject an invalid write differently;
   * this answers `{ field: message }` for all of them (a duplicate key
   * included) and `null` when the error is not a validation failure, so a
   * controller can answer a 422 and rethrow the rest.
   *
   * @param {*} error What the model threw
   * @returns {?object} The messages by field, or null
   * @memberof Model
   */
  errors(error) {
    return modelErrors(error);
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
      throw fail(
        'HENRI_MODEL_NO_STORE',
        `There is no default store and ${model.identity} is missing one`
      );
    }

    if (model.store && !config.has(`stores.${model.store}`)) {
      throw fail(
        'HENRI_MODEL_UNKNOWN_STORE',
        `It seems like ${model.store} is not configured. ${model.identity} is using it.`
      );
    }
  }
}

module.exports = Model;
