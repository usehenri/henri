const Sequelize = require('sequelize');
const debug = require('debug')('henri:sequelize');
const { paginate } = require('./plugins');
const { normalizeSchema } = require('./schema');
const { fatal, normalizeEmail, redact } = require('./utils');

const { DataTypes } = Sequelize;

/**
 * Store adapter contract, shared by @usehenri/sequelize (and the mysql,
 * postgresql and mssql packages built on it) and @usehenri/mongoose (disk).
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
 * @method async start() Connects (and, on SQL, syncs the schema); calls the
 *   `associate(models)` export of each model file once every model exists
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

/**
 * Coerces any stored roles value to a list of roles
 *
 * @param {*} value A list, a JSON string, a single role or null
 * @returns {Array<string>} The roles
 */
const toRoles = (value) => {
  if (Array.isArray(value)) {
    return value.flat();
  }

  if (value === null || typeof value === 'undefined') {
    return [];
  }

  if (typeof value === 'string') {
    try {
      return toRoles(JSON.parse(value));
    } catch (error) {
      return [value];
    }
  }

  return [value];
};

/**
 * Sequelize database adapter
 *
 * The dialect packages extend it with a dialect and a driver; used directly
 * it takes the dialect from the store configuration (ex: sqlite).
 *
 * @class Sql
 * @implements {HenriAdapter}
 */
class Sql {
  /**
   * Creates an instance of Sql.
   *
   * @param {string} name Store name
   * @param {object} config Store configuration: `url` or `host`, `port`,
   *   `database`, `username`, `password`; `session` (store options); every
   *   other key is forwarded to Sequelize (`logging`, `pool`, `dialectOptions`)
   * @param {Henri} thisHenri Current henri instance
   * @param {object} [options={}] Dialect package options
   * @param {string} [options.adapterName] The henri adapter name
   * @param {string} [options.dialect] The Sequelize dialect
   * @param {(string|object)} [options.driver] The driver module path or module
   * @param {boolean} [options.mariadbRewrite=false] Serve mariadb:// urls with
   *   the mysql dialect
   * @memberof Sql
   */
  constructor(name, config, thisHenri, options = {}) {
    this.name = name;
    this.config = config || {};
    this.henri = thisHenri;
    this.dialect = options.dialect || this.config.dialect || null;
    this.driver = options.driver || null;
    this.mariadbRewrite = Boolean(options.mariadbRewrite);
    this.adapterName = options.adapterName || this.dialect || 'sequelize';
    this.models = {};
    this.definitions = {};
    this.associated = new Set();
    this.userModelName = null;
    this.sessionStore = null;
    this.Sequelize = Sequelize;
    this.connector = this.createConnector();
  }

  /**
   * Builds the Sequelize instance from the store configuration
   *
   * Called by the constructor and again by `start()` after a `stop()`.
   *
   * @returns {Sequelize} A Sequelize instance
   * @throws {Error} When the configuration has no url, host or database
   * @memberof Sql
   */
  createConnector() {
    const { adapter, session, url, ...opts } = this.config;
    const options = { logging: (sql) => debug(sql), ...opts };

    if (this.dialect) {
      options.dialect = this.dialect;
    }

    if (typeof this.driver === 'string') {
      options.dialectModulePath = this.driver;
    } else if (this.driver) {
      options.dialectModule = this.driver;
    }

    debug('store %s configuration %O', this.name, redact({ ...options, url }));

    if (url) {
      // MariaDB is served by the mysql2 driver; Sequelize picks the dialect
      // from the url protocol, so normalize it
      const target = this.mariadbRewrite
        ? url.replace(/^mariadb:/i, 'mysql:')
        : url;

      return new Sequelize(target, options);
    }

    if (options.dialect === 'sqlite' || options.host || options.database) {
      return new Sequelize(options);
    }

    throw fatal(
      this.henri,
      this.adapterName,
      `Missing url (or host and database) in store ${this.name}`
    );
  }

  /**
   * Returns the connector, rebuilding it (and the models) after a stop()
   *
   * @returns {Sequelize} The Sequelize instance
   * @memberof Sql
   */
  ensureConnector() {
    if (!this.connector) {
      this.connector = this.createConnector();

      const definitions = Object.values(this.definitions);

      this.definitions = {};
      this.models = {};
      definitions.forEach(({ model, user }) => this.addModel(model, user));
    }

    return this.connector;
  }

  /**
   * Add a model to the store
   *
   * @param {object} model The model file (`schema`, `options`, `name`,
   *   `associate`) with the `globalId` and `identity` set by core
   * @param {string} user The user model name
   * @returns {object} The Sequelize model
   * @memberof Sql
   */
  addModel(model, user) {
    const connector = this.ensureConnector();
    const isUser = model.identity === user;
    const { attributes, indexes } = normalizeSchema(model.schema || {}, {
      dialect: connector.getDialect(),
    });
    // Rails has timestamps on every table: `timestamps: false` opts out
    const options = { timestamps: true, ...(model.options || {}) };

    if (model.name && !options.tableName) {
      options.tableName = model.name;
    }

    if (indexes.length > 0) {
      options.indexes = [...(options.indexes || []), ...indexes];
    }

    debug('adding model %s', model.globalId);

    if (isUser) {
      this.overload(attributes, options, model);
    }

    const instance = paginate(
      connector.define(model.globalId, attributes, options)
    );

    if (isUser) {
      this.decorateUser(instance);
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
   * @memberof Sql
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
   * @param {object} attributes The Sequelize attributes
   * @param {object} options The Sequelize model options
   * @param {object} model The model file
   * @returns {object} The attributes
   * @memberof Sql
   */
  overload(attributes, options, model) {
    const { pen } = this.henri;

    pen.info(
      this.adapterName,
      `Found a user model (${model.globalId}), overloading it.`
    );

    attributes.email = {
      allowNull: false,
      /**
       * Stores emails trimmed and lowercased
       *
       * @param {string} value An email
       * @returns {void}
       */
      set(value) {
        this.setDataValue('email', normalizeEmail(value));
      },
      type: DataTypes.STRING,
      unique: true,
      validate: { isEmail: true },
    };
    attributes.password = { allowNull: false, type: DataTypes.STRING };
    attributes.roles = this.rolesAttribute(this.baseRoles());

    // The password is only selected through the withPassword scope
    const defaultScope = options.defaultScope || {};
    const scoped = defaultScope.attributes;
    const exclude = Array.isArray(scoped) ? [] : (scoped || {}).exclude || [];

    options.defaultScope = {
      ...defaultScope,
      attributes: { ...(Array.isArray(scoped) ? {} : scoped || {}), exclude },
    };
    options.defaultScope.attributes.exclude = [...exclude, 'password'];
    options.scopes = { withPassword: {}, ...(options.scopes || {}) };

    return attributes;
  }

  /**
   * Builds the roles attribute: JSON where the dialect supports it, TEXT with
   * a JSON getter/setter otherwise (mssql)
   *
   * @param {Array<string>} baseRoles The default roles
   * @returns {object} The Sequelize attribute
   * @memberof Sql
   */
  rolesAttribute(baseRoles) {
    const supportsJson = Boolean(this.connector.dialect.supports.JSON);

    return {
      defaultValue: supportsJson ? baseRoles : JSON.stringify(baseRoles),
      /**
       * Getter for the roles
       *
       * @returns {Array<string>} The roles
       */
      get() {
        return toRoles(this.getDataValue('roles'));
      },
      /**
       * Roles setter
       *
       * @param {(string|Array<string>)} value A role or a list of roles
       * @returns {void}
       */
      set(value) {
        const list = toRoles(value);

        this.setDataValue('roles', supportsJson ? list : JSON.stringify(list));
      },
      type: supportsJson ? DataTypes.JSON : DataTypes.TEXT,
    };
  }

  /**
   * Adds the password hashing hooks, the roles protection and the role
   * helpers to the user model
   *
   * @param {object} Model The Sequelize user model
   * @returns {void}
   * @memberof Sql
   */
  decorateUser(Model) {
    const supportsJson = Boolean(this.connector.dialect.supports.JSON);
    const baseRoles = toRoles(Model.rawAttributes.roles.defaultValue);
    const encrypt = (password) => this.henri.user.encrypt(password);

    /**
     * Drops the roles given on a create
     *
     * @param {object} record A new user
     * @returns {void}
     */
    const resetRoles = (record) => record.set('roles', baseRoles);

    /**
     * Drops a roles change on an update
     *
     * @param {object} record An existing user
     * @returns {void}
     */
    const revertRoles = (record) => {
      if (record.changed('roles')) {
        record.set('roles', record.previous('roles'));
        record.changed('roles', false);
      }
    };

    Model.addHook('beforeCreate', 'henri', async (record, options = {}) => {
      if (!options.unsafe) {
        resetRoles(record);
      }
      if (!options.passwordsHashed && typeof record.password === 'string') {
        record.password = await encrypt(record.password);
      }
    });

    Model.addHook('beforeUpdate', 'henri', async (record, options = {}) => {
      if (!options.unsafe) {
        revertRoles(record);
      }
      if (!options.passwordsHashed && record.changed('password')) {
        record.password = await encrypt(record.password);
      }
    });

    Model.addHook(
      'beforeBulkCreate',
      'henri',
      async (records, options = {}) => {
        for (const record of records) {
          if (!options.unsafe) {
            resetRoles(record);
          }
          if (typeof record.password === 'string') {
            record.password = await encrypt(record.password);
          }
        }
        options.passwordsHashed = true;
      }
    );

    Model.addHook('beforeBulkUpdate', 'henri', async (options = {}) => {
      const values = options.attributes || {};

      if (!options.unsafe && 'roles' in values) {
        delete values.roles;
        options.fields = (options.fields || []).filter(
          (field) => field !== 'roles'
        );
      } else if (!supportsJson && Array.isArray(values.roles)) {
        values.roles = JSON.stringify(values.roles);
      }

      if (typeof values.password === 'string') {
        values.password = await encrypt(values.password);
        options.passwordsHashed = true;
      }
    });

    /**
     * Does the user own every given role?
     *
     * @param {(string|Array<string>)} [roles=[]] A role or a list of roles
     * @returns {Promise<boolean>} true when every role is owned
     */
    Model.prototype.hasRole = async function hasRole(roles = []) {
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
    Model.prototype.setRoles = async function setRoles(roles) {
      this.set('roles', roles);
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
    Model.setRoles = async (id, roles) => {
      const user = await Model.findByPk(id);

      return user ? user.setRoles(roles) : null;
    };
  }

  /**
   * Returns the models of this store
   *
   * @returns {object} the models by global id
   * @memberof Sql
   */
  getModels() {
    return this.models || {};
  }

  /**
   * Returns the user model
   *
   * @returns {object} The Sequelize user model
   * @throws {Error} When no user model was registered
   * @memberof Sql
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
   * @memberof Sql
   */
  async findUserByEmail(email) {
    if (typeof email !== 'string' || email.trim() === '') {
      return null;
    }

    return this.getUserModel()
      .scope('withPassword')
      .findOne({ where: { email: normalizeEmail(email) } });
  }

  /**
   * Finds a user by id, without its password
   *
   * @param {*} id A user id (a string from a session or a token)
   * @returns {Promise<(object|null)>} The user or null
   * @memberof Sql
   */
  async findUserById(id) {
    const Model = this.getUserModel();
    const { type } = Model.rawAttributes[Model.primaryKeyAttribute];

    if (id === null || typeof id === 'undefined') {
      return null;
    }

    if (type instanceof DataTypes.INTEGER && !/^\d+$/.test(String(id))) {
      return null;
    }

    return Model.findByPk(id);
  }

  /**
   * The id of a user, as a string
   *
   * @param {object} user A user
   * @returns {string} Its id
   * @memberof Sql
   */
  userId(user) {
    const key = this.getUserModel().primaryKeyAttribute;

    return String(typeof user.get === 'function' ? user.get(key) : user[key]);
  }

  /**
   * A user as a plain object, without its password
   *
   * @param {object} user A user
   * @returns {object} A plain object
   * @memberof Sql
   */
  toPlain(user) {
    const plain =
      typeof user.get === 'function' ? user.get({ plain: true }) : { ...user };

    delete plain.password;

    return plain;
  }

  /**
   * Calls the `associate(models)` export of each model file, once
   *
   * @returns {void}
   * @memberof Sql
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
   * The session table is created before the store is handed out.
   *
   * @param {function} session express-session module (or its Store class)
   * @returns {Promise<object>} A ready store
   * @memberof Sql
   */
  async getSessionConnector(session) {
    if (this.sessionStore) {
      return this.sessionStore;
    }

    const Store = session.Store || session;
    const SequelizeStore = require('connect-session-sequelize')(Store);

    this.sessionStore = new SequelizeStore({
      db: this.ensureConnector(),
      ...(this.config.session || {}),
    });

    await this.sessionStore.sync();
    debug('session store ready in %s', this.name);

    return this.sessionStore;
  }

  /**
   * Checks the connection
   *
   * @returns {Promise<boolean>} true when the database answers
   * @memberof Sql
   */
  async ping() {
    await this.ensureConnector().authenticate();

    return true;
  }

  /**
   * Runs a raw query
   *
   * @param {string} sql The query, with `?` or `:name` placeholders
   * @param {(Array|object)} [params=[]] The replacements
   * @param {object} [options={}] Sequelize query options (`type`, ...)
   * @returns {Promise<*>} The Sequelize result
   * @memberof Sql
   */
  async query(sql, params = [], options = {}) {
    return this.ensureConnector().query(sql, {
      replacements: params,
      ...options,
    });
  }

  /**
   * Runs a function inside a transaction
   *
   * @param {function} fn Receives the transaction
   * @returns {Promise<*>} What fn returns
   * @memberof Sql
   */
  async transaction(fn) {
    return this.ensureConnector().transaction(fn);
  }

  /**
   * Starts the store: connects, associates the models and syncs the schema
   *
   * @returns {Promise<void>} Resolves when ready
   * @memberof Sql
   */
  async start() {
    const connector = this.ensureConnector();

    debug('starting %s', this.name);
    await connector.authenticate();
    this.associate();
    await connector.sync();
    debug('started %s', this.name);
  }

  /**
   * Stops the store
   *
   * @returns {Promise<void>} Resolves when closed
   * @memberof Sql
   */
  async stop() {
    debug('stopping %s', this.name);

    if (this.sessionStore) {
      this.sessionStore.stopExpiringSessions();
      this.sessionStore = null;
    }

    if (this.connector) {
      await this.connector.close();
      this.connector = null;
    }

    this.models = {};
    this.associated = new Set();
    debug('stopped %s', this.name);
  }
}

Sql.Sequelize = Sequelize;
Sql.DataTypes = DataTypes;
Sql.normalizeSchema = normalizeSchema;

module.exports = Sql;
