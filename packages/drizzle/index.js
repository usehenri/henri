const { AsyncLocalStorage } = require('node:async_hooks');
const { relations, sql } = require('drizzle-orm');
const debug = require('debug')('henri:drizzle');
const dialects = require('./dialects');
const { Migrations } = require('./migrations');
const { createModel } = require('./model');
const { compileTable, normalizeSchema } = require('./schema');
const { SESSION_FIELDS, createStore } = require('./session');
const { ValidationError } = require('./validation');
const { fatal, normalizeEmail, redact, toRoles } = require('./utils');

/**
 * Store adapter contract, shared with @usehenri/sequelize (mysql,
 * postgresql, mssql) and @usehenri/mongoose (disk).
 *
 * Core builds an adapter with `new Adapter(name, config, henri)`, registers
 * every model file with `addModel()`, then calls `start()`.
 *
 * @interface HenriAdapter
 * @property {string} adapterName drizzle
 * @property {string} name The store name from the configuration
 * @method addModel(model, userModelName) Registers a model file; returns the
 *   model class. The model matching `userModelName` is overloaded with
 *   `email` (unique, lowercased, trimmed, validated), `password` (hashed,
 *   never selected by default) and `roles` (only writable through
 *   `setRoles()` or with `{ unsafe: true }`).
 * @method getModels() All model classes by global id
 * @method async start() Connects, calls the `associate(models)` export of
 *   each model file, compiles the schema, then pushes it (development) or
 *   runs the migrations (production with `migrate: true`)
 * @method async stop() Disconnects; `start()` may be called again
 * @method async getSessionConnector(session) A ready express-session Store
 * @method async findUserByEmail(email) The user with its password, or null
 * @method async findUserById(id) The user without its password, or null
 * @method userId(user) The user id as a string
 * @method toPlain(user) The user as a plain object, without its password
 * @method async ping() Resolves true when the database answers
 * @method async transaction(fn) Runs fn inside a transaction
 * @method async query(sql, params) Raw query
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSIONS_KEY = 'HenriSession';

/**
 * Drizzle ORM adapter: sqlite (better-sqlite3), postgres (pg) and mysql
 * (mysql2) behind one Rails-like model API, with migrations in
 * `db/migrations`
 *
 * Store configuration: `dialect` (sqlite, postgres, mysql; guessed from the
 * url), `url` or `host`, `port`, `database`, `username`, `password`;
 * `pool` (driver options), `session` (store options), `sync` (false to
 * skip the development push), `migrate` (true to run the migrations in
 * production), `migrationsFolder` (default `db/migrations`).
 *
 * @class Drizzle
 * @implements {HenriAdapter}
 */
class Drizzle {
  /**
   * Creates an instance of Drizzle.
   *
   * @param {string} name Store name
   * @param {object} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @throws {Error} After `pen.fatal` when the configuration is unusable
   * @memberof Drizzle
   */
  constructor(name, config, thisHenri) {
    this.name = name;
    this.config = config || {};
    this.henri = thisHenri;
    this.adapterName = 'drizzle';
    this.dialect =
      dialects.get(this.config.dialect) || dialects.fromUrl(this.config.url);

    if (!this.dialect) {
      throw fatal(
        thisHenri,
        this.adapterName,
        `Unknown dialect '${this.config.dialect || ''}' in store ${name}; use sqlite, postgres or mysql`
      );
    }

    if (
      this.dialect.name !== 'sqlite' &&
      !this.config.url &&
      !(this.config.host || this.config.database)
    ) {
      throw fatal(
        thisHenri,
        this.adapterName,
        `Missing url (or host and database) in store ${name}`
      );
    }

    this.models = {};
    this.definitions = {};
    this.associated = new Set();
    this.userModelName = null;
    this.tables = {};
    this.schema = null;
    this.sessionTable = null;
    this.sessionStore = null;
    this.client = null;
    this.db = null;
    this.started = false;
    this.dirty = true;
    this.context = new AsyncLocalStorage();
    this.migrations = new Migrations(this);
    this.timings = {};

    debug(
      'store %s: %s on %s',
      name,
      this.dialect.name,
      redact(this.dialect.describe(this.config))
    );
  }

  /**
   * Add a model to the store
   *
   * @param {object} model The model file (`schema`, `options`, `name`,
   *   `associate`, hooks) with the `globalId` and `identity` set by core
   * @param {string} user The user model name
   * @returns {function} The model class
   * @throws {Error} On unknown schema keys or types
   * @memberof Drizzle
   */
  addModel(model, user) {
    const isUser = model.identity === user;
    const definition = {
      ...model,
      options: { ...(model.options || {}) },
      schema: { ...(model.schema || {}) },
    };

    debug('adding model %s', model.globalId);

    if (isUser) {
      this.overload(definition);
    }

    const fields = normalizeSchema(definition.schema);
    const Model = createModel(this, definition, fields);

    if (isUser) {
      this.decorateUser(Model);
      this.henri._user = Model;
      this.userModelName = Model.modelName;
    }

    this.definitions[Model.modelName] = { model, user };
    this.models[Model.modelName] = Model;
    this.dirty = true;

    return Model;
  }

  /**
   * Reads the base role from the configuration
   *
   * @returns {Array<string>} The default roles of a new user
   * @memberof Drizzle
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
   * Overload the user entity: `email`, `password` and `roles`
   *
   * @param {object} definition The model file (copied)
   * @returns {object} The definition
   * @memberof Drizzle
   */
  overload(definition) {
    const { pen } = this.henri;
    const baseRoles = this.baseRoles();

    pen.info(
      this.adapterName,
      `Found a user model (${definition.globalId}), overloading it.`
    );

    definition.baseRoles = baseRoles;
    definition.schema.email = {
      lowercase: true,
      match: [EMAIL, 'is not a valid email'],
      required: true,
      trim: true,
      type: 'string',
      unique: true,
    };
    definition.schema.password = {
      required: true,
      select: false,
      type: 'string',
    };
    definition.schema.roles = {
      default: () => [...baseRoles],
      type: 'json',
    };

    return definition;
  }

  /**
   * Adds the password hashing, the roles protection and the role helpers
   * to the user model
   *
   * Roles are dropped from mass-assigned creates and updates unless the
   * operation passes `{ unsafe: true }`; `user.setRoles()` and
   * `User.setRoles(id, roles)` change them.
   *
   * @param {function} Model The user model
   * @returns {void}
   * @memberof Drizzle
   */
  decorateUser(Model) {
    const { baseRoles } = Model.definition;
    const encrypt = (password) => this.henri.user.encrypt(password);

    Model.internalHooks.beforeCreate.push(async (values, options = {}) => {
      values.roles = options.unsafe ? toRoles(values.roles) : [...baseRoles];

      if (typeof values.password === 'string' && !options.passwordsHashed) {
        values.password = await encrypt(values.password);
      }

      return values;
    });

    Model.internalHooks.beforeUpdate.push(async (values, options = {}) => {
      if (!options.unsafe) {
        delete values.roles;
      } else if ('roles' in values) {
        values.roles = toRoles(values.roles);
      }

      if (typeof values.password === 'string' && !options.passwordsHashed) {
        values.password = await encrypt(values.password);
      }

      return values;
    });

    Model.internalHooks.afterLoad.push((row) => {
      row.roles = toRoles(row.roles);
    });

    /**
     * Does the user own every given role?
     *
     * @param {(string|Array<string>)} [roles=[]] A role or a list of roles
     * @returns {Promise<boolean>} true when every role is owned
     */
    Model.prototype.hasRole = async function hasRole(roles = []) {
      const given = Array.isArray(roles) ? roles : [roles];
      const owned = toRoles(this.roles);

      return given.every((role) => owned.includes(role));
    };

    /**
     * Replaces the roles of the user
     *
     * @param {(string|Array<string>)} roles The new roles
     * @returns {Promise<object>} The user
     */
    Model.prototype.setRoles = async function setRoles(roles) {
      return this.update({ roles: toRoles(roles) }, { unsafe: true });
    };

    /**
     * Replaces the roles of a user by id
     *
     * @param {*} id The user id
     * @param {(string|Array<string>)} roles The new roles
     * @returns {Promise<(object|null)>} The user, or null when not found
     */
    Model.setRoles = (id, roles) =>
      Model.findByIdAndUpdate(id, { roles: toRoles(roles) }, { unsafe: true });
  }

  /**
   * Returns the models of this store
   *
   * @returns {object} The model classes by global id
   * @memberof Drizzle
   */
  getModels() {
    return this.models || {};
  }

  /**
   * Returns the user model
   *
   * @returns {function} The user model class
   * @throws {Error} When no user model was registered
   * @memberof Drizzle
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
   * @memberof Drizzle
   */
  async findUserByEmail(email) {
    if (typeof email !== 'string' || email.trim() === '') {
      return null;
    }

    return this.getUserModel()
      .withHidden()
      .where({ email: normalizeEmail(email) })
      .first();
  }

  /**
   * Finds a user by id, without its password
   *
   * @param {*} id A user id (a string from a session or a token)
   * @returns {Promise<(object|null)>} The user or null
   * @memberof Drizzle
   */
  async findUserById(id) {
    return this.getUserModel().findById(id);
  }

  /**
   * The id of a user, as a string
   *
   * @param {object} user A user
   * @returns {string} Its id
   * @memberof Drizzle
   */
  userId(user) {
    return String(user.id);
  }

  /**
   * A user as a plain object, without its password
   *
   * @param {object} user A user
   * @returns {object} A plain object
   * @memberof Drizzle
   */
  toPlain(user) {
    const plain =
      typeof user.toObject === 'function' ? user.toObject() : { ...user };

    delete plain.password;

    return plain;
  }

  /**
   * Calls the `associate(models)` export of each model file, once
   *
   * @returns {void}
   * @memberof Drizzle
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
   * Compiles the models into Drizzle tables and relations (and the sessions
   * table when a user model exists)
   *
   * @returns {object} The schema handed to Drizzle
   * @memberof Drizzle
   */
  compile() {
    const { dialect } = this;
    const tables = {};
    const enums = {};

    /**
     * A column of another model, for foreign keys (resolved lazily)
     *
     * @param {string} modelName The model
     * @param {string} field The field
     * @returns {object} The column
     * @throws {Error} When the model is unknown
     */
    const resolveColumn = (modelName, field) => {
      const entry = tables[modelName];

      if (!entry || !entry.table[field]) {
        throw new Error(
          `${this.adapterName}: unknown reference ${modelName}.${field}`
        );
      }

      return entry.table[field];
    };

    for (const Model of Object.values(this.models)) {
      const { options } = Model.definition;

      tables[Model.key] = compileTable(
        {
          fields: Model.fields,
          id: options.id !== false,
          key: Model.key,
          tableName: Model.tableName,
        },
        dialect,
        { resolveColumn }
      );
      Object.assign(enums, tables[Model.key].enums);
    }

    if (this.userModelName || this.config.sessions === true) {
      tables[SESSIONS_KEY] = compileTable(
        {
          fields: normalizeSchema(SESSION_FIELDS),
          id: false,
          key: SESSIONS_KEY,
          tableName: (this.config.session || {}).table || 'henri_sessions',
        },
        dialect
      );
    }

    const schema = {};

    for (const key of Object.keys(tables)) {
      schema[key] = tables[key].table;
    }

    for (const Model of Object.values(this.models)) {
      if (Model.associations.length > 0) {
        schema[`${Model.key}Relations`] = this.compileRelations(Model, tables);
      }
    }

    Object.assign(schema, enums);

    this.tables = tables;
    this.enums = enums;
    this.schema = schema;
    this.sessionTable = tables[SESSIONS_KEY]
      ? tables[SESSIONS_KEY].table
      : null;
    this.dirty = false;

    return schema;
  }

  /**
   * The Drizzle relations of a model (from its belongsTo/hasMany/hasOne)
   *
   * @param {function} Model The model
   * @param {object} tables The compiled tables
   * @returns {object} A Drizzle relations object
   * @memberof Drizzle
   */
  compileRelations(Model, tables) {
    return relations(tables[Model.key].table, ({ many, one }) => {
      const result = {};

      for (const association of Model.associations) {
        const Target = this.models[association.target];
        const target = tables[association.target].table;

        if (association.kind === 'belongsTo') {
          result[association.as] = one(target, {
            fields: [tables[Model.key].table[association.foreignKey]],
            references: [target.id],
            relationName: `${Model.key}.${association.as}`,
          });
        } else {
          const reverse = Target.associations.find(
            (entry) =>
              entry.kind === 'belongsTo' &&
              entry.target === Model.key &&
              entry.foreignKey === association.foreignKey
          );
          const relationName = `${Target.key}.${reverse.as}`;

          // A hasOne is described from the owner: its id is what the
          // target's foreign key references (drizzle needs both columns)
          result[association.as] =
            association.kind === 'hasMany'
              ? many(target, { relationName })
              : one(target, {
                  fields: [tables[Model.key].table.id],
                  references: [target[association.foreignKey]],
                  relationName,
                });
        }
      }

      return result;
    });
  }

  /**
   * The tables and enums drizzle-kit snapshots (no relations)
   *
   * @returns {object} Tables and enums by key
   * @memberof Drizzle
   */
  schemaExports() {
    const exports = {};

    for (const key of Object.keys(this.tables)) {
      exports[key] = this.tables[key].table;
    }

    return Object.assign(exports, this.enums || {});
  }

  /**
   * The table names of the compiled schema
   *
   * @returns {Array<string>} Table names
   * @memberof Drizzle
   */
  tableNames() {
    return Object.keys(this.tables).map((key) => this.tableNameOfKey(key));
  }

  /**
   * The table name of a schema key
   *
   * @param {string} key A schema key (model global id)
   * @returns {string} The table name
   * @memberof Drizzle
   */
  tableNameOfKey(key) {
    const { getTableName } = require('drizzle-orm');

    return getTableName(this.tables[key].table);
  }

  /**
   * The database name (mysql push needs it)
   *
   * @returns {string} The database name
   * @memberof Drizzle
   */
  databaseName() {
    if (this.config.database) {
      return this.config.database;
    }

    try {
      return new URL(this.config.url).pathname.replace(/^\//, '');
    } catch (error) {
      return '';
    }
  }

  /**
   * The Drizzle database, or the transaction active in this async context
   *
   * @returns {object} A Drizzle database
   * @throws {Error} Before start()
   * @memberof Drizzle
   */
  database() {
    const active = this.context.getStore();

    if (active && active.db) {
      return active.db;
    }

    return this.rawDatabase();
  }

  /**
   * The Drizzle database (never a transaction)
   *
   * @returns {object} A Drizzle database
   * @throws {Error} Before start()
   * @memberof Drizzle
   */
  rawDatabase() {
    if (!this.db) {
      throw new Error(`${this.adapterName}: store ${this.name} is not started`);
    }

    return this.db;
  }

  /**
   * The tables of the database
   *
   * @returns {Promise<Array<string>>} Table names
   * @memberof Drizzle
   */
  async listTables() {
    this.rawDatabase();

    return this.dialect.listTables(this.client);
  }

  /**
   * Returns the session connector (for connect styles session storage)
   *
   * The sessions table is created when it is missing (production without
   * migrations) before the store is handed out.
   *
   * @param {function} session express-session module (or its Store class)
   * @returns {Promise<object>} A ready store
   * @throws {Error} When called before start()
   * @memberof Drizzle
   */
  async getSessionConnector(session) {
    if (this.sessionStore) {
      return this.sessionStore;
    }

    this.rawDatabase();

    if (!this.sessionTable) {
      this.config.sessions = true;
      this.compile();
      this.db = this.dialect.drizzle(this.client, this.schema);
    }

    await this.migrations.ensure({ [SESSIONS_KEY]: this.sessionTable });

    const Store = createStore(session);

    this.sessionStore = new Store(this, this.config.session || {});
    debug('session store ready in %s', this.name);

    return this.sessionStore;
  }

  /**
   * Checks the connection
   *
   * @returns {Promise<boolean>} true when the database answers
   * @memberof Drizzle
   */
  async ping() {
    if (!this.client) {
      throw new Error(`${this.adapterName}: store ${this.name} is not started`);
    }

    return this.dialect.ping(this.client);
  }

  /**
   * Runs a raw query
   *
   * @param {string} text The query, with the driver's placeholders (`?` on
   *   sqlite and mysql, `$1` on postgres)
   * @param {Array} [params=[]] The parameters
   * @returns {Promise<*>} The rows (or the run result of a write on sqlite)
   * @memberof Drizzle
   */
  async query(text, params = []) {
    if (!this.client) {
      throw new Error(`${this.adapterName}: store ${this.name} is not started`);
    }

    return this.dialect.query(this.client, text, params);
  }

  /**
   * Runs a function inside a transaction; every model call made inside it
   * (in the same async context) joins the transaction
   *
   * @param {function} fn Receives the transaction (a Drizzle database)
   * @returns {Promise<*>} What fn returns
   * @memberof Drizzle
   */
  async transaction(fn) {
    const active = this.context.getStore();

    if (active && active.db) {
      return fn(active.db);
    }

    const db = this.rawDatabase();

    if (this.dialect.synchronous) {
      db.run(sql`BEGIN`);

      try {
        const result = await this.context.run({ db }, () => fn(db));

        db.run(sql`COMMIT`);

        return result;
      } catch (error) {
        db.run(sql`ROLLBACK`);
        throw error;
      }
    }

    return db.transaction((tx) => this.context.run({ db: tx }, () => fn(tx)));
  }

  /**
   * Starts the store: associates and compiles the models, connects, then
   * syncs the schema (development) or checks the migrations (production)
   *
   * @returns {Promise<void>} Resolves when ready
   * @memberof Drizzle
   */
  async start() {
    const started = Date.now();

    debug('starting %s', this.name);
    this.associate();

    if (this.dirty || !this.schema) {
      this.compile();
    }

    this.client = await this.dialect.connect(this.config);
    this.db = this.dialect.drizzle(this.client, this.schema);

    try {
      await this.ping();
    } catch (error) {
      this.henri.pen.error(this.adapterName, 'failed to connect to server');
      await this.stop();
      throw error;
    }

    this.started = true;

    try {
      await this.sync();
    } catch (error) {
      await this.stop();
      throw error;
    }

    this.timings.start = Date.now() - started;
    debug('started %s in %dms', this.name, this.timings.start);
  }

  /**
   * Makes the schema and the database agree after a connection
   *
   * Development: pushes the schema unless `config.sync === false` (the
   * Sequelize `sync()` of before). Production: runs the migrations when
   * `config.migrate === true`, otherwise logs how many are pending.
   * `HENRI_SKIP_SYNC` (set by `henri db`) skips everything.
   *
   * @returns {Promise<void>} Resolves when done
   * @memberof Drizzle
   */
  async sync() {
    const { config, henri } = this;
    const { pen } = henri;

    if (process.env.HENRI_SKIP_SYNC) {
      return;
    }

    if (!henri.isProduction) {
      if (config.sync === false) {
        return;
      }

      const started = Date.now();
      const result = await this.migrations.push({ interactive: false });

      this.timings.push = Date.now() - started;

      if (result.hasDataLoss && !result.applied) {
        pen.warn(
          this.adapterName,
          `schema changes would lose data, nothing was applied; run "henri db:push" (or "henri db:generate" then "henri db:migrate")`
        );
        result.warnings.forEach((warning) =>
          pen.warn(this.adapterName, warning)
        );

        return;
      }

      if (result.statements.length > 0) {
        pen.info(
          this.adapterName,
          `schema pushed: ${result.statements.length} statement(s) in ${this.timings.push}ms`
        );
      } else {
        debug('schema up to date (%dms)', this.timings.push);
      }

      // A mysql push cannot alter a table (see Migrations#plan)
      if (result.drifted.length > 0) {
        result.warnings.forEach((warning) =>
          pen.warn(this.adapterName, warning)
        );
      }

      return;
    }

    if (config.migrate === true) {
      const started = Date.now();
      const { applied } = await this.migrations.migrate();

      this.timings.migrate = Date.now() - started;
      pen.info(
        this.adapterName,
        applied.length > 0
          ? `applied ${applied.length} migration(s): ${applied.join(', ')}`
          : 'migrations up to date'
      );

      return;
    }

    const { pending } = await this.migrations.status();

    if (pending.length > 0) {
      pen.warn(
        this.adapterName,
        `${pending.length} pending migration(s) in store ${this.name}; run "henri db:migrate" or set "migrate": true`
      );
    }
  }

  /**
   * Stops the store
   *
   * @returns {Promise<void>} Resolves when closed
   * @memberof Drizzle
   */
  async stop() {
    debug('stopping %s', this.name);

    if (this.sessionStore) {
      this.sessionStore.stopExpiringSessions();
      this.sessionStore = null;
    }

    if (this.client) {
      const { client } = this;

      this.client = null;
      this.db = null;
      await this.dialect.close(client);
    }

    this.started = false;
    debug('stopped %s', this.name);
  }
}

Drizzle.ValidationError = ValidationError;
Drizzle.dialects = dialects;
Drizzle.normalizeSchema = normalizeSchema;
Drizzle.compileTable = compileTable;

module.exports = Drizzle;
