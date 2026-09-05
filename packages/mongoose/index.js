const mongoose = require('mongoose');
const debug = require('debug')('henri:mongoose');
const { paginate, paranoid } = require('./plugins');
const { normalizeSchema } = require('./schema');
const { buildUrl, fatal, normalizeEmail, redact } = require('./utils');

/**
 * Store adapter contract, shared by @usehenri/mongoose (and @usehenri/disk
 * built on it) and @usehenri/sequelize (mysql, postgresql, mssql).
 *
 * Core builds an adapter with `new Adapter(name, config, henri)`, registers
 * every model file with `addModel()`, then calls `start()`.
 *
 * @interface HenriAdapter
 * @property {string} adapterName mysql, postgresql, mssql, mongoose, disk, ...
 * @property {string} name The store name from the configuration
 * @method addModel(model, userModelName) Registers a model file; returns the
 *   ORM model. The model matching `userModelName` is overloaded with `email`
 *   (unique, lowercased, trimmed, validated), `password` (hashed, never
 *   selected by default) and `roles` (only writable through `setRoles()` or
 *   with `{ unsafe: true }`).
 * @method getModels() All ORM models by global id
 * @method async start() Connects; calls the `associate(models)` export of
 *   each model file once every model exists
 * @method async stop() Disconnects; `start()` may be called again
 * @method async getSessionConnector(session) A ready express-session Store
 * @method async findUserByEmail(email) The user with its password, or null
 * @method async findUserById(id) The user without its password, or null
 * @method userId(user) The user id as a string
 * @method toPlain(user) The user as a plain object, without its password
 * @method async ping() Resolves true when the database answers
 * @method async transaction(fn) Runs fn inside a transaction
 * @method async query(sql, params) Raw query (SQL adapters only)
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Query middleware where passwords are hashed and roles protected
const UPDATE_HOOKS = ['updateOne', 'updateMany', 'findOneAndUpdate'];

/**
 * Removes the roles from an update, whatever the operator
 *
 * @param {object} update A Mongoose update object
 * @returns {void}
 */
const stripRoles = (update) => {
  delete update.roles;

  Object.keys(update).forEach((key) => {
    const value = update[key];

    if (key.startsWith('$') && value && typeof value === 'object') {
      delete value.roles;

      if (Object.keys(value).length === 0) {
        delete update[key];
      }
    }
  });
};

/**
 * Mongoose database adapter
 *
 * @class Mongoose
 * @implements {HenriAdapter}
 */
class Mongoose {
  /**
   * Does the adapter provision its own server (no url needed)?
   *
   * @readonly
   * @static
   * @returns {boolean} false for a real MongoDB server
   * @memberof Mongoose
   */
  static get managed() {
    return false;
  }

  /**
   * Creates an instance of Mongoose.
   *
   * @param {string} name Store name
   * @param {object} config Store configuration: `url` or `host`, `port`,
   *   `database`, `username`, `password`; `opts` (passed to
   *   `mongoose.connect()`); `session` (connect-mongo options)
   * @param {Henri} thisHenri Current henri instance
   * @memberof Mongoose
   */
  constructor(name, config, thisHenri) {
    debug('constructor => init');
    this.adapterName = 'mongoose';
    this.name = name;
    this.config = config || {};
    this.henri = thisHenri;
    this.models = {};
    this.definitions = {};
    this.associated = new Set();
    this.userModelName = null;
    this.mongoose = new mongoose.Mongoose();
    this.sessionStore = null;
    this.url = buildUrl(this.config);

    if (!this.url && !this.constructor.managed) {
      throw fatal(
        thisHenri,
        'mongoose',
        `Missing url or host in store ${name}`
      );
    }

    debug('using version %s of mongoose', this.mongoose.version);
    debug('constructor => done');
  }

  /**
   * Add a model to the store
   *
   * @param {object} model The model file (`schema`, `options`, `name`,
   *   `associate`) with the `globalId` and `identity` set by core
   * @param {string} user The user model name
   * @returns {object} The Mongoose model
   * @memberof Mongoose
   */
  addModel(model, user) {
    const isUser = model.identity === user;
    const { paranoid: soft = false, ...options } = model.options || {};
    // Rails has timestamps on every table: `timestamps: false` opts out
    const schema = new this.mongoose.Schema(
      normalizeSchema(model.schema || {}),
      {
        timestamps: true,
        ...options,
      }
    );

    debug('adding model %s', model.globalId);

    paginate(schema);

    if (soft) {
      paranoid(schema);
    }

    if (isUser) {
      this.overload(schema, model);
    }

    const instance = this.mongoose.model(
      model.globalId,
      schema,
      model.name || undefined
    );

    if (isUser) {
      this.henri._user = instance;
      this.userModelName = model.globalId;
    }

    this.definitions[model.globalId] = { model, user };
    this.models[model.globalId] = instance;

    return instance;
  }

  /**
   * Reads the base role from the configuration
   *
   * @returns {Array<string>} The default roles of a new user
   * @memberof Mongoose
   */
  baseRoles() {
    const { config, pen } = this.henri;
    const baseRole = config.has('baseRole') ? config.get('baseRole') : null;
    const roles = baseRole ? [baseRole].flat() : [];

    if (roles.length > 0) {
      pen.info(this.adapterName, 'basic user role', roles);
    } else {
      pen.warn(this.adapterName, 'no basic user role. are you sure?');
    }

    return roles;
  }

  /**
   * Overload the user entity
   *
   * Roles are dropped from mass-assigned creates and updates unless the
   * operation is flagged unsafe: `doc.save({ unsafe: true })`,
   * `doc.$locals.unsafe = true`, `Model.create([doc], { unsafe: true })`,
   * `Model.updateOne(filter, update, { unsafe: true })`.
   *
   * @param {object} schema The Mongoose schema
   * @param {object} model  The model file
   * @returns {object} The schema
   * @memberof Mongoose
   */
  overload(schema, model) {
    const { pen } = this.henri;
    const thisHenri = this.henri;
    const baseRoles = this.baseRoles();

    debug('overloading %s', model.globalId);
    pen.info(this.adapterName, 'user model', model.globalId, 'overloading...');

    schema.add({
      email: {
        lowercase: true,
        match: [EMAIL, 'is not a valid email'],
        required: true,
        trim: true,
        type: String,
        unique: true,
      },
    });
    schema.add({ password: { required: true, select: false, type: String } });
    schema.add({ roles: { default: () => [...baseRoles], type: [String] } });

    const encrypt = (password) => thisHenri.user.encrypt(password);

    /**
     * Is a save allowed to change the roles?
     *
     * @param {object} doc The document
     * @param {object} [options] The save options
     * @returns {boolean} true when flagged unsafe
     */
    const isUnsafe = (doc, options) =>
      Boolean(
        (options && options.unsafe) || (doc.$locals && doc.$locals.unsafe)
      );

    schema.pre('save', async function preSave(options) {
      if (!isUnsafe(this, options) && this.isModified('roles')) {
        if (this.isNew) {
          this.roles = [...baseRoles];
        } else {
          this.$ignore('roles');
        }
      }

      if (this.isModified('password')) {
        this.password = await encrypt(this.password);
      }
    });

    schema.pre(UPDATE_HOOKS, async function preUpdate() {
      const update = this.getUpdate();

      if (!update || Array.isArray(update)) {
        return;
      }

      if (!this.getOptions().unsafe) {
        stripRoles(update);
      }

      for (const target of [update, update.$set, update.$setOnInsert]) {
        if (target && typeof target.password === 'string') {
          target.password = await encrypt(target.password);
        }
      }
    });

    /**
     * Does the user own every given role?
     *
     * @param {(string|Array<string>)} [roles=[]] A role or a list of roles
     * @returns {Promise<boolean>} true when every role is owned
     */
    schema.methods.hasRole = async function hasRole(roles = []) {
      const given = Array.isArray(roles) ? roles : [roles];
      const owned = this.roles || [];

      return given.every((role) => owned.includes(role));
    };

    /**
     * Replaces the roles of the user
     *
     * @param {(string|Array<string>)} roles The new roles
     * @returns {Promise<object>} The user
     */
    schema.methods.setRoles = async function setRoles(roles) {
      this.roles = Array.isArray(roles) ? roles.flat() : [roles];
      await this.save({ unsafe: true });

      return this;
    };

    /**
     * Replaces the roles of a user by id
     *
     * @param {*} id The user id
     * @param {(string|Array<string>)} roles The new roles
     * @returns {Promise<(object|null)>} The user, or null when not found
     */
    schema.statics.setRoles = function setRoles(id, roles) {
      const list = Array.isArray(roles) ? roles.flat() : [roles];

      return this.findByIdAndUpdate(
        id,
        { $set: { roles: list } },
        { returnDocument: 'after', unsafe: true }
      );
    };

    return schema;
  }

  /**
   * Returns the models of this store
   *
   * @returns {object} the models by global id
   * @memberof Mongoose
   */
  getModels() {
    return this.models || {};
  }

  /**
   * Returns the user model
   *
   * @returns {object} The Mongoose user model
   * @throws {Error} When no user model was registered
   * @memberof Mongoose
   */
  getUserModel() {
    const Model = this.userModelName && this.models[this.userModelName];

    if (!Model) {
      throw new Error(
        `${this.adapterName}: no user model in store ${this.name}`
      );
    }

    return Model;
  }

  /**
   * Finds a user by email, with its password (for authentication)
   *
   * @param {string} email An email, in any case
   * @returns {Promise<(object|null)>} The user or null
   * @memberof Mongoose
   */
  async findUserByEmail(email) {
    if (typeof email !== 'string' || email.trim() === '') {
      return null;
    }

    return this.getUserModel()
      .findOne({ email: normalizeEmail(email) })
      .select('+password');
  }

  /**
   * Finds a user by id, without its password
   *
   * @param {*} id A user id (a string from a session or a token)
   * @returns {Promise<(object|null)>} The user or null
   * @memberof Mongoose
   */
  async findUserById(id) {
    if (id === null || typeof id === 'undefined') {
      return null;
    }

    try {
      return await this.getUserModel().findById(id);
    } catch (error) {
      if (error.name === 'CastError') {
        return null;
      }

      throw error;
    }
  }

  /**
   * The id of a user, as a string
   *
   * @param {object} user A user
   * @returns {string} Its id
   * @memberof Mongoose
   */
  userId(user) {
    return String(user._id || user.id);
  }

  /**
   * A user as a plain object, without its password
   *
   * @param {object} user A user
   * @returns {object} A plain object
   * @memberof Mongoose
   */
  toPlain(user) {
    const plain =
      typeof user.toObject === 'function'
        ? user.toObject({ versionKey: false })
        : { ...user };

    delete plain.password;

    return plain;
  }

  /**
   * Calls the `associate(models)` export of each model file, once
   *
   * @returns {void}
   * @memberof Mongoose
   */
  associate() {
    for (const globalId of Object.keys(this.definitions)) {
      const { model } = this.definitions[globalId];

      if (
        typeof model.associate === 'function' &&
        !this.associated.has(globalId)
      ) {
        debug('associating %s', globalId);
        model.associate(this.models);
        this.associated.add(globalId);
      }
    }
  }

  /**
   * Returns the session connector (for connect styles session storage)
   *
   * The store shares the mongoose driver client, so it is only available
   * once the store is started.
   *
   * @param {function} session express-session module (unused, connect-mongo
   *   loads it itself)
   * @returns {Promise<object>} A ready store
   * @throws {Error} When called before start()
   * @memberof Mongoose
   */
  async getSessionConnector(session) {
    if (this.sessionStore) {
      return this.sessionStore;
    }

    if (this.mongoose.connection.readyState !== 1) {
      throw new Error(
        `${this.adapterName}: getSessionConnector() called before start()`
      );
    }

    const { MongoStore } = require('connect-mongo');

    this.sessionStore = MongoStore.create({
      client: this.mongoose.connection.getClient(),
      collectionName: 'henriSessions',
      ...(this.config.session || {}),
    });

    // The TTL index is created in the background; wait for it
    await this.sessionStore.collectionP;
    debug('session store ready in %s', this.name);

    return this.sessionStore;
  }

  /**
   * Checks the connection
   *
   * @returns {Promise<boolean>} true when the server answers
   * @memberof Mongoose
   */
  async ping() {
    const { db } = this.mongoose.connection;

    if (!db) {
      throw new Error(`${this.adapterName}: store ${this.name} is not started`);
    }

    await db.admin().ping();

    return true;
  }

  /**
   * Runs a function inside a transaction (needs a replica set)
   *
   * @param {function} fn Receives the session
   * @returns {Promise<*>} What fn returns
   * @memberof Mongoose
   */
  async transaction(fn) {
    return this.mongoose.connection.transaction(fn);
  }

  /**
   * The url to connect to
   *
   * @returns {string} A mongodb:// url
   * @memberof Mongoose
   */
  resolveUrl() {
    return this.url;
  }

  /**
   * The options handed to `mongoose.connect()`
   *
   * @returns {object} Defaults merged with `config.opts`
   * @memberof Mongoose
   */
  connectOptions() {
    return {
      connectTimeoutMS: 10 * 1000,
      serverSelectionTimeoutMS: 10 * 1000,
      ...(this.config.opts || {}),
    };
  }

  /**
   * Registers the models again after a stop()
   *
   * @returns {void}
   * @memberof Mongoose
   */
  restoreModels() {
    if (Object.keys(this.models).length > 0) {
      return;
    }

    const definitions = Object.values(this.definitions);

    this.definitions = {};
    definitions.forEach(({ model, user }) => this.addModel(model, user));
  }

  /**
   * Starts the store
   *
   * @returns {Promise<void>} Resolves when connected
   * @memberof Mongoose
   */
  async start() {
    const url = this.resolveUrl();
    const opts = this.connectOptions();

    debug('starting %s', this.name);
    debug('connecting to %s with %O', redact(url), redact(opts));
    this.restoreModels();

    try {
      await this.mongoose.connect(url, opts);
    } catch (error) {
      debug('failed to start connection to %s: %O', this.name, error);
      this.henri.pen.error(this.adapterName, 'failed to connect to server');

      throw error;
    }

    // The unique email index must exist before the first request
    if (this.userModelName) {
      await this.models[this.userModelName].init();
    }

    this.associate();
    debug('started %s', this.name);
  }

  /**
   * Stops the store
   *
   * @returns {Promise<void>} Resolves when disconnected
   * @memberof Mongoose
   */
  async stop() {
    debug('stopping %s', this.name);

    if (this.sessionStore) {
      // The store shares the mongoose client (closed by disconnect below);
      // let its index setup settle first
      await Promise.resolve(this.sessionStore.collectionP).catch(() => null);
      this.sessionStore = null;
    }

    await this.mongoose.disconnect();
    this.mongoose = new mongoose.Mongoose();
    this.models = {};
    this.associated = new Set();
    debug('stopped %s', this.name);
  }
}

module.exports = Mongoose;
