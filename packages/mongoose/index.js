const mongoose = require('mongoose');
const { config, pen } = henri;

if (global.Promise) {
  mongoose.Promise = global.Promise;
}

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
   * @param {Henri} henri Current henri instance
   * @memberof Mongoose
   */
  constructor(name, config, henri) {
    if (!config.url && !config.host) {
      pen.fatal('mongoose', `Missing url or host in store ${name}`);
    }
    this.adapterName = 'mongoose';
    this.name = name;
    this.config = config;
    this.models = {};
    this.mongoose = mongoose;
    this.henri = henri;

    this.addModel = this.addModel.bind(this);
    this.overload = this.overload.bind(this);
    this.getModels = this.getModels.bind(this);
    this.getSessionConnector = this.getSessionConnector.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
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

    if (model.identity === user) {
      this.overload(schema, model, user);
      isUser = true;
    }

    const instance = this.mongoose.model(model.globalId, schema);

    if (isUser) {
      henri._user = instance;
    }

    this.models[model.globalId] = instance;

    return this.models[model.globalId];
  }

  /**
   * Overload the user entity
   *
   * @param {any} schema The schema
   * @param {any} model  The model
   * @param {any} user The user name
   * @returns {object} The model
   * @memberof Mongoose
   */
  overload(schema, model, user) {
    const { pen } = this.henri;

    pen.info('mongoose', `user model`, model.globalId, `overloading...`);
    schema.add({ email: { required: true, type: String } });
    schema.add({ password: { required: true, type: String } });
    const baseRole = (config.has('baseRole') && [config.get('baseRole')]) || [];

    schema.add({ roles: { default: baseRole, type: Array } });
    schema.pre('save', async function(next) {
      if (!this.isModified('password')) return next();
      this.password = await user.encrypt(this.password);
      next();
    });
    schema.methods.hasRole = async function(roles = []) {
      let given = Array.isArray(roles) ? roles : [roles];

      return given.every(element => this.roles.includes(element));
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
   *
   * @param {function} session session-store function
   * @returns {object} a store
   * @memberof Mongoose
   */
  getSessionConnector(session) {
    // eslint-disable-next-line global-require
    const MongoStore = require('connect-mongo')(session);

    return new MongoStore({
      collection: 'henriSessions',
      mongooseConnection: this.mongoose.connection,
    });
  }

  /**
   * Start the store
   *
   * @returns {Promise} Resolves or not
   * @memberof Mongoose
   */
  async start() {
    return new Promise((resolve, reject) => {
      mongoose
        .connect(this.config.url || this.config.host)
        .then(() => resolve(), err => reject(err));
    });
  }

  /**
   * Stops the store
   *
   * @returns {Promise} Success or not?
   * @memberof Mongoose
   */
  async stop() {
    return new Promise((resolve, reject) => {
      mongoose.disconnect().then(() => resolve(), err => reject(err));
    });
  }
}

module.exports = Mongoose;
