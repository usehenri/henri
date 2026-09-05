const mongoose = require('mongoose');
const debug = require('debug')('henri:mongoose');

/**
 * Mongoose database adapter
 *
 * @class Mongoose
 */
class Mongoose {
  /**
   * Creates an instance of Mongoose.
   * @param {string} name Store name
   * @param {any} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof Mongoose
   */
  constructor(name, config, thisHenri) {
    debug('constructor => init');
    if (!config.url && !config.host) {
      thisHenri.pen.fatal('mongoose', `Missing url or host in store ${name}`);
    }
    this.adapterName = 'mongoose';
    this.name = name;
    this.config = config;
    this.models = {};
    this.mongoose = new mongoose.Mongoose();
    this.sessionStore = null;
    this.henri = thisHenri;

    debug('using version %s of mongoose', this.mongoose.version);

    this.addModel = this.addModel.bind(this);
    this.overload = this.overload.bind(this);
    this.getModels = this.getModels.bind(this);
    this.getSessionConnector = this.getSessionConnector.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    debug('constructor => done');
  }

  /**
   * Add a model to the store
   *
   * @param {object} model The model object
   * @param {string} user The user object name
   * @returns {object} The model instance (initialized)
   * @memberof Mongoose
   */
  addModel(model, user) {
    let isUser = false;
    const schema = new this.mongoose.Schema(model.schema, model.options || {});

    debug('adding model', model.globalId);

    if (model.identity === user) {
      this.overload(schema, model, user);
      isUser = true;
    }

    const instance = this.mongoose.model(
      model.globalId,
      schema,
      model.name || undefined
    );

    if (isUser) {
      this.henri._user = instance;
    }

    this.models[model.globalId] = instance;

    debug('model', model.globalId, 'added');

    return this.models[model.globalId];
  }

  /**
   * Overload the user entity
   *
   * @param {any} schema The schema
   * @param {any} model  The model
   * @returns {object} The model
   * @memberof Mongoose
   */
  overload(schema, model) {
    const { pen, config } = this.henri;
    const thisHenri = this.henri;

    debug('overloading %s', model.globalId);

    pen.info('mongoose', `user model`, model.globalId, `overloading...`);
    schema.add({
      email: {
        required: true,
        type: String,
      },
    });
    schema.add({
      password: {
        required: true,
        type: String,
      },
    });
    const baseRole = (config.has('baseRole') && [config.get('baseRole')]) || [];

    if (baseRole.length > 0) {
      pen.info('mongoose', 'basic user role', baseRole);
    } else {
      pen.warn('mongoose', 'no basic user role. are you sure?');
    }

    schema.add({
      roles: {
        default: baseRole.flat(),
        type: Array,
      },
    });
    schema.pre('save', async function () {
      if (!this.isModified('password')) {
        return;
      }
      this.password = await thisHenri.user.encrypt(this.password);
    });
    schema.methods.hasRole = async function (roles = []) {
      let given = Array.isArray(roles) ? roles : [roles];

      return given.every((element) => this.roles.includes(element));
    };
  }

  /**
   * Returns the models of this store
   *
   * @returns {object} the models
   * @memberof Mongoose
   */
  getModels() {
    return this.mongoose.models || {};
  }

  /**
   * Returns the session connector (for connect styles session storage)
   * The store opens its own driver connection so it can be closed before the
   * mongoose connection on shutdown.
   *
   * @returns {object} a store
   * @memberof Mongoose
   */
  getSessionConnector() {
    // eslint-disable-next-line global-require
    const { MongoStore } = require('connect-mongo');

    this.sessionStore = MongoStore.create({
      collectionName: 'henriSessions',
      mongoUrl: this.config.url || this.config.host,
    });

    // The store creates its TTL index in the background; make sure a failure
    // there (ex: shutdown before it completes) is reported, not unhandled.
    if (this.sessionStore.clientP) {
      this.sessionStore.clientP.then(
        () => debug('session store connected'),
        (error) => debug('session store connection failed: %s', error.message)
      );
    }
    if (this.sessionStore.collectionP) {
      this.sessionStore.collectionP.then(
        () => debug('session store ready'),
        (error) => debug('session store setup failed: %s', error.message)
      );
    }

    return this.sessionStore;
  }

  /**
   * Starts the store
   *
   * @returns {Promise} Resolves or not
   * @memberof Mongoose
   */
  async start() {
    debug('starting %s', this.name);

    const defaultOpts = {
      connectTimeoutMS: 10 * 1000,
    };

    let opts = Object.assign({}, defaultOpts, this.config.opts || {});

    this.config.opts && debug('using custom configuration for %s', this.name);
    this.config.opts && debug('new configuration is %O', opts);

    try {
      await this.mongoose.connect(this.config.url || this.config.host, opts);
      debug('started %s', this.name);
    } catch (error) {
      debug('failed to start connection to %s', this.name);
      debug('related error is: %O', error);

      this.henri.pen.error('mongoose', 'failed to connect to server');

      throw error;
    }
  }

  /**
   * Stops the store
   *
   * @returns {Promise} Success or not?
   * @memberof Mongoose
   */
  async stop() {
    debug('stopping %s', this.name);

    if (this.sessionStore) {
      try {
        // Let the store finish its setup before pulling the connection
        debug('waiting for the session store setup');
        this.sessionStore.collectionP &&
          (await this.sessionStore.collectionP.catch(() => null));
        debug('closing the session store');
        await this.sessionStore.close();
        debug('session store closed');
      } catch (error) {
        debug('unable to close the session store: %s', error.message);
      }
      this.sessionStore = null;
    }

    debug('disconnecting mongoose');
    await this.mongoose.disconnect();
    delete this.mongoose;
    this.mongoose = new mongoose.Mongoose();
    this.models = {};
    debug('stopped %s', this.name);
  }
}

module.exports = Mongoose;
