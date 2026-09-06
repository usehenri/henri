const Sequelize = require('sequelize');
const debug = require('debug')('henri:sequelize');
const { Drift, describeDifference } = require('./drift');
const { decorateAttributes, decorateModel } = require('./encryption');
const { decorateModel: decorateVersions } = require('./versions');
const { lookup, paginate, publicId } = require('./plugins');
const { instrument: instrumentQueries } = require('./queries');
const { normalizeSchema } = require('./schema');
const {
  EXTERNAL_ID,
  EXTERNAL_ID_COLUMN,
  isUuid,
  uuidv7,
  wantsExternalId,
  withoutInternalIds,
} = require('./external-id');
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
 * @method references() The declared foreign keys, by model
 * @method async externalIdsOf(model, keys) The public identifiers of rows,
 *   by primary key
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
 * @method async drift() What the database and the models disagree about
 *   (SQL adapters only): the tables, columns and indexes that differ, and
 *   the DDL that would close each one. Reads, never writes. `henri
 *   db:status` prints it and a production boot warns about it.
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
    // `sync` is henri's, not Sequelize's (which reads `options.sync` as the
    // default options of every `Model.sync()`): it never reaches the driver
    const { adapter, session, sync, url, ...opts } = this.config;
    const options = { logging: (sql) => debug(sql), ...opts };

    if (this.dialect) {
      options.dialect = this.dialect;
    }

    if (typeof this.driver === 'string') {
      options.dialectModulePath = this.driver;
    } else if (this.driver) {
      options.dialectModule = this.driver;
    }

    // Without this mysql2 reads a BIGINT through a double, so
    // 9223372036854775807 comes back as 9223372036854776000; with it, a
    // value past what a JavaScript number carries exactly arrives as a
    // string and everything smaller is untouched (see ./exact.js)
    if (
      /^(mysql|mariadb)$/iu.test(options.dialect || '') ||
      /^(mysql|mariadb):/iu.test(url || '')
    ) {
      options.dialectOptions = {
        supportBigNumbers: true,
        ...(options.dialectOptions || {}),
      };
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
      `Missing url (or host and database) in store ${this.name}`,
      'HENRI_STORE_URL_MISSING'
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
    const { attributes, encrypted, indexes } = normalizeSchema(
      model.schema || {},
      {
        dialect: connector.getDialect(),
        isUser,
        model: model.globalId,
      }
    );
    // Rails has timestamps on every table: `timestamps: false` opts out
    const options = { timestamps: true, ...(model.options || {}) };
    const external = wantsExternalId(model);

    // `externalId`, `personal`, `retention` and `versioned` are henri
    // options, not Sequelize ones
    const keepsVersions = options.versioned;

    delete options.externalId;
    delete options.personal;
    delete options.retention;
    delete options.versioned;

    if (model.name && !options.tableName) {
      options.tableName = model.name;
    }

    if (indexes.length > 0) {
      options.indexes = [...(options.indexes || []), ...indexes];
    }

    debug('adding model %s', model.globalId);

    if (external) {
      this.addExternalId(attributes);
    }

    if (isUser) {
      this.overload(attributes, options, model);
    }

    // Before define(): Sequelize reads `get` and `set` off an attribute
    // when it builds the model and never looks again. `register()` is
    // what refuses the boot when a field says `encrypted` and the
    // application has no key
    if (Object.keys(encrypted).length > 0) {
      this.henri.encryption.register(model.globalId, encrypted);
      decorateAttributes(attributes, encrypted, {
        henri: this.henri,
        model: model.globalId,
      });
    }

    const instance = lookup(
      paginate(connector.define(model.globalId, attributes, options)),
      external,
      this.henri
    );

    if (Object.keys(encrypted).length > 0) {
      decorateModel(instance, encrypted, this.henri);
    }

    if (external) {
      publicId(instance);
    }

    if (isUser) {
      this.decorateUser(instance);
      this.henri._user = instance;
      this.userModelName = model.globalId;
    }

    // Only for a model that asked: an application with nothing versioned
    // registers no hook at all
    if (keepsVersions) {
      decorateVersions(instance, this.henri);
    }

    // Last, so that what is wrapped is the model as every other decorator
    // left it: an application that is not counting gets an untouched model
    instrumentQueries(instance, this);

    this.definitions[model.globalId] = { model, user };
    this.models[model.globalId] = instance;

    return instance;
  }

  /**
   * Adds the `externalId` attribute (the `external_id` column): the public
   * identifier of every record, a uuid v7 generated on insert, NOT NULL and
   * UNIQUE in the database. The primary key stays internal.
   *
   * `options: { externalId: false }` on the model file opts out.
   *
   * @param {object} attributes The Sequelize attributes
   * @returns {object} The attributes
   * @memberof Sql
   */
  addExternalId(attributes) {
    if (attributes[EXTERNAL_ID]) {
      return attributes;
    }

    attributes[EXTERNAL_ID] = {
      allowNull: false,
      // A function default is generated per row and never reaches the DDL
      // (sequelize's defaultValueSchemable), which is what we want: the
      // column has no server side default, every insert brings its own
      defaultValue: uuidv7,
      field: EXTERNAL_ID_COLUMN,
      type: DataTypes.UUID,
      unique: true,
    };

    return attributes;
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

    // The account flows (base/accounts.js): when the address was confirmed,
    // and when the password last changed. The second one is what retires the
    // sessions that were open when a password was reset.
    attributes.confirmedAt = { allowNull: true, type: DataTypes.DATE };
    attributes.passwordChangedAt = { allowNull: true, type: DataTypes.DATE };

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
    const encrypt = (password, identity) =>
      this.henri.user.encrypt(password, { identity });

    /**
     * Are new hashes bound to the row they belong to? Asked per call: the
     * configuration is read at boot but a suite may swap it underneath. An
     * older core (or a stand-in that only implements `encrypt`) answers no,
     * which is the behaviour it had.
     *
     * @returns {boolean} true when a password write must name its row
     */
    const binds = () =>
      typeof this.henri.user.bindsPasswords === 'function' &&
      this.henri.user.bindsPasswords();

    /**
     * The error to throw when a password write cannot name its row
     *
     * @param {string} detail What the caller was doing
     * @returns {Error} The error
     */
    const unresolved = (detail) =>
      typeof this.henri.user.unresolvedPassword === 'function'
        ? this.henri.user.unresolvedPassword(detail)
        : new Error(`cannot hash a password from ${detail}`);

    /**
     * The `externalId` of the single row a mass update targets.
     *
     * A bound hash belongs to one record, so a `Model.update()` writing a
     * password has to prove it is writing to exactly one. Two or more and
     * there is no honest answer, so it refuses. None and the update writes to
     * nothing, but a row could still appear in the race, so the hash is bound
     * to a uuid that belongs to nobody: it lands unusable rather than usable
     * by anyone.
     *
     * @param {object} options The beforeBulkUpdate options
     * @returns {Promise<string>} The uuid to bind to
     * @throws {Error} when more than one row matches
     */
    const identityOfUpdate = async (options) => {
      const rows = await Model.unscoped().findAll({
        attributes: [EXTERNAL_ID],
        limit: 2,
        // Whatever the update itself will see: on a paranoid model a soft
        // deleted row is not one of the rows being written, so counting it
        // would refuse an update that touches exactly one
        paranoid: options.paranoid,
        raw: true,
        transaction: options.transaction,
        where: options.where || {},
      });

      if (rows.length > 1) {
        throw unresolved(`${Model.name}.update() over more than one row`);
      }

      return rows.length === 1 ? rows[0][EXTERNAL_ID] : uuidv7();
    };

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
        // The uuid default is applied when the instance is built, so it is
        // already here, before the insert
        record.password = await encrypt(record.password, record[EXTERNAL_ID]);
      }
    });

    Model.addHook('beforeUpdate', 'henri', async (record, options = {}) => {
      if (!options.unsafe) {
        revertRoles(record);
      }
      if (!options.passwordsHashed && record.changed('password')) {
        record.password = await encrypt(record.password, record[EXTERNAL_ID]);
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
          // A bulk create still has every row in hand, so each hash is bound
          // to its own. `passwordsHashed` is honoured here too: without it,
          // bulkCreate(rows, { passwordsHashed: true }) hashed the hashes.
          if (!options.passwordsHashed && typeof record.password === 'string') {
            record.password = await encrypt(
              record.password,
              record[EXTERNAL_ID]
            );
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

      if (typeof values.password === 'string' && !options.passwordsHashed) {
        values.password = await encrypt(
          values.password,
          binds() ? await identityOfUpdate(options) : undefined
        );
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
      const user = isUuid(id)
        ? await Model.findByExternalId(id)
        : await Model.findByKey(id);

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
   * What this store can state about its foreign keys, for core's exit gate
   * (`base/references.js`).
   *
   * Two sources, both of them things a model file said out loud:
   * `Model.associations`, which is what `belongsTo()` in `associate(models)`
   * built, and `rawAttributes[field].references`, which is what a field
   * declaring `references: { model: 'Event' }` built. A column that points
   * at a row without declaring it is not here, and henri does not guess at
   * it from its name.
   *
   * @returns {object} `{ [globalId]: { externalId, references } }`
   * @memberof Sql
   */
  references() {
    const described = {};
    const tables = {};

    for (const globalId of Object.keys(this.models)) {
      tables[this.models[globalId].getTableName()] = globalId;
      tables[globalId] = globalId;
    }

    for (const globalId of Object.keys(this.models)) {
      const Model = this.models[globalId];
      const references = {};

      for (const association of Object.values(Model.associations || {})) {
        // Only the side holding the key: a hasMany puts nothing on this row
        if (
          association.associationType !== 'BelongsTo' ||
          !association.foreignKey ||
          !association.target
        ) {
          continue;
        }

        references[association.foreignKey] = {
          as: association.as || null,
          target: association.target.name,
        };
      }

      for (const field of Object.keys(Model.rawAttributes || {})) {
        const declared = (Model.rawAttributes[field] || {}).references;
        const named =
          declared &&
          (typeof declared.model === 'string'
            ? declared.model
            : (declared.model || {}).name);
        const target = named && tables[named];

        if (target && !references[field]) {
          references[field] = { as: null, target };
        }
      }

      described[globalId] = {
        externalId: Boolean(
          Model.rawAttributes && Model.rawAttributes[EXTERNAL_ID]
        ),
        references,
      };
    }

    return described;
  }

  /**
   * The public identifiers of rows named by their primary key: one
   * statement for the whole set, which is what keeps a page of records from
   * costing a query per foreign key.
   *
   * Deleted rows included (`paranoid: false`): a proposal pointing at a
   * withdrawn track still has to publish an identifier for it rather than
   * fall back to the number.
   *
   * @param {string} modelName The global id of the model
   * @param {Array} keys The primary keys
   * @returns {Promise<Map<string, string>>} externalId by primary key
   * @memberof Sql
   */
  async externalIdsOf(modelName, keys) {
    const Model = this.models[modelName];
    const found = new Map();

    if (!Model || !Model.rawAttributes[EXTERNAL_ID] || keys.length === 0) {
      return found;
    }

    const primary = Model.primaryKeyAttribute;
    const rows = await Model.findAll({
      attributes: [primary, EXTERNAL_ID],
      paranoid: false,
      raw: true,
      where: { [primary]: keys },
    });

    for (const row of rows) {
      found.set(String(row[primary]), row[EXTERNAL_ID]);
    }

    return found;
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

    if (isUuid(id)) {
      return Model.findByExternalId(id);
    }

    // A malformed primary key (a stale session, a token from another
    // deployment) is not a user
    if (type instanceof DataTypes.INTEGER && !/^\d+$/.test(String(id))) {
      return null;
    }

    // The subject of a session is a primary key henri wrote itself, so this
    // is a key lookup and never the strict `findById()` a url goes through
    return Model.findByKey(id);
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

    // The primary key never leaves the server when there is a public one
    return withoutInternalIds(plain);
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
    await this.sync();
    debug('started %s', this.name);
  }

  /**
   * Makes the schema and the database agree after a connection
   *
   * Development: `sequelize.sync()`, which creates the tables that are
   * missing and leaves the ones that exist alone, unless the store sets
   * `sync: false`. Production: **nothing**, unless the store asks for it
   * with `sync: true`. A production boot reports the drift instead
   * (`drift()`), because `sync()` there is unreviewed DDL that creates
   * whatever the models happen to name and stays silent about every table
   * that is already wrong. `HENRI_SKIP_SYNC` (set by `henri db`) skips it
   * all: those commands are the ones driving the schema.
   *
   * @returns {Promise<void>} Resolves when done
   * @memberof Sql
   */
  async sync() {
    const { config, henri } = this;

    if (process.env.HENRI_SKIP_SYNC) {
      return;
    }

    const production = Boolean(henri && henri.isProduction);

    if (production ? config.sync === true : config.sync !== false) {
      await this.ensureConnector().sync();

      return;
    }

    if (production) {
      await this.reportDrift();
    }
  }

  /**
   * Warns about what the database and the models disagree about
   *
   * Called on a production boot, where henri no longer runs DDL of its own.
   * A database that cannot be read back is not a reason to refuse to boot:
   * the application still works, it is the report that is missing.
   *
   * @returns {Promise<void>} Resolves when the report has been logged
   * @memberof Sql
   */
  async reportDrift() {
    const { pen } = this.henri;

    let report;

    try {
      report = await this.drift();
    } catch (error) {
      debug('cannot read the schema back: %s', error.message);
      pen.warn(
        this.adapterName,
        `cannot compare store ${this.name} with the models: ${error.message}`
      );

      return;
    }

    if (report.clean) {
      pen.info(this.adapterName, `store ${this.name} matches the models`);

      return;
    }

    pen.warn(
      this.adapterName,
      `store ${this.name} and the models differ in ${report.differences.length} place(s); run "henri db:status" to see them, "henri db:status --sql" for the DDL that would close them`
    );
    report.differences.forEach((difference) =>
      pen.warn(this.adapterName, describeDifference(difference))
    );
  }

  /**
   * What the database and the models disagree about
   *
   * Reads the database back (`describeTable()`, `showIndex()`) and compares
   * it with the models. Nothing is written.
   *
   * @returns {Promise<object>} The drift report
   * @memberof Sql
   */
  async drift() {
    return new Drift(this).report();
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
