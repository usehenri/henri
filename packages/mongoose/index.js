const mongoose = require('mongoose');
const debug = require('debug')('henri:mongoose');
const {
  externalId,
  lookups,
  owned,
  paginate,
  paranoid,
  slugged,
  updating,
  validations,
} = require('./plugins');
const { validationsOf } = require('./validations');
const {
  instrument: instrumentQueries,
  instrumentStatics,
} = require('./queries');
const { normalizeModel } = require('./schema');
const { exactPaths, exactness } = require('./exact-paths');
const { encryption } = require('./encryption');
const { versioned } = require('./versions');
const { tenant } = require('./tenant');
const {
  EXTERNAL_ID,
  isUuid,
  uuidv7,
  wantsExternalId,
} = require('./external-id');
const { slugOf } = require('./slug');
const { buildUrl, coded, fatal, normalizeEmail, redact } = require('./utils');

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
 * @method references() The declared foreign keys, by model
 * @method async externalIdsOf(model, keys) The public identifiers of
 *   documents, by document id
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
 *
 * There is deliberately **no `sandbox()`** here, so `henri console
 * --sandbox` refuses on a mongoose or disk store instead of pretending. Two
 * reasons, either of them enough: a Mongoose write only joins a transaction
 * when the call is handed the `session`, and there is no async-context path
 * to hand it one from a REPL prompt; and a MongoDB transaction needs a
 * replica set, which `mongodb-memory-server` is not started as.
 * @method async query(sql, params) Raw query (SQL adapters only)
 * @method async describe() What the database holds, in its own words:
 *   `{ store, adapter, kind, dialect, read, enforced, tables, unclaimed }`.
 *   A table carries its real name, the `model` that claims it, whether it
 *   `exists`, its `columns` (`name`, `type`, `nullable`, `default`,
 *   `primaryKey`, the `values` of an enum, and the model `attribute` a
 *   `field` renamed) and its `indexes`; `unclaimed` names the tables no
 *   model declares. `read` says where the columns came from -- `database`
 *   on SQL, where `enforced` is true, and `models` here, because MongoDB
 *   enforces no shape of its own: the collection is real, the indexes are
 *   real, and the fields are henri's declaration applied by Mongoose in
 *   this process. Optional and read only: `GET /_henri/runtime/schema`,
 *   the `schema` tool of `henri mcp` and `henri db:schema` ask for it.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The fields a model declares, in the shape `describe()` answers a column
 * in.
 *
 * Two sources, because henri owns half of this: the Mongoose schema says
 * the path and its type, and `validates` says whether it is required and
 * what values it takes -- those two are lifted out of the path definition
 * on the way in (see `validations.js`) so that henri owns the message, so
 * reading only the path would answer that nothing is required.
 *
 * A default that is a function is answered as null rather than as its
 * source: it is computed per document, so there is no value to state.
 *
 * @param {object} schema A Mongoose schema
 * @param {?object} rules What `validationsOf()` compiled, by field
 * @returns {Array<object>} The fields
 */
const pathsOf = (schema, rules) => {
  const fields = [];

  schema.eachPath((name, path) => {
    const options = path.options || {};
    const rule = (rules && rules[name]) || {};
    const values = Array.isArray(rule.enum)
      ? rule.enum.map(String)
      : (Array.isArray(path.enumValues) && path.enumValues.map(String)) || null;

    fields.push({
      attribute: name,
      default:
        typeof options.default === 'undefined' ||
        typeof options.default === 'function'
          ? null
          : options.default,
      name,
      nullable: rule.required !== true && path.isRequired !== true,
      primaryKey: name === '_id',
      type: path.instance || 'Mixed',
      values: values && values.length > 0 ? values : null,
    });
  });

  return fields;
};

/**
 * The indexes a collection really carries, asked of the server
 *
 * @param {object} Model A Mongoose model
 * @returns {Promise<Array<object>>} The indexes
 */
const indexesOf = async (Model) => {
  let indexes;

  try {
    indexes = await Model.collection.indexes();
  } catch (error) {
    // A collection MongoDB has never been asked to write has no namespace
    debug(
      'cannot read the indexes of %s: %s',
      Model.collection.name,
      error.message
    );

    return [];
  }

  return indexes.map((index) => ({
    columns: Object.keys(index.key || {}),
    name: index.name,
    primary: index.name === '_id_',
    unique: index.unique === true,
  }));
};

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
    this.mongoose = this.newConnection();
    this.sessionStore = null;
    this.url = buildUrl(this.config);

    if (!this.url && !this.constructor.managed) {
      throw fatal(
        thisHenri,
        'mongoose',
        `Missing url or host in store ${name}`,
        'HENRI_STORE_URL_MISSING'
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
    const {
      externalId: external,
      paranoid: soft = false,
      // Marks for henri (base/privacy.js, base/retention.js), not
      // Mongoose schema options
      personal,
      retention,
      slug: named,
      // `tenant` is core's mark and not a Mongoose schema option: the
      // adapter reads it through `henri.tenancy` a line below (./tenant.js)
      tenant: belongsToTenant,
      versioned: keepsVersions,
      ...options
    } = model.options || {};
    const { definition, encrypted } = normalizeModel(model.schema || {}, {
      isUser,
      model: model.globalId,
    });
    // Rails has timestamps on every table: `timestamps: false` opts out
    const schema = new this.mongoose.Schema(definition, {
      timestamps: true,
      ...options,
    });

    debug('adding model %s', model.globalId);

    owned(schema, this.henri);
    paginate(schema);
    lookups(schema);
    // `doc.update(attrs)`, which Mongoose itself dropped in 7, and the
    // rollback of a write the store refused (./plugins.js)
    updating(schema);

    // Before every other hook, so what a rule measures is the value the
    // application wrote rather than an envelope. A declaration henri
    // cannot carry out failed the boot in `normalizeModel` above
    const rules = validationsOf(model);

    if (rules) {
      validations(schema, rules, model.globalId);
    }

    // Before everything else that reads a document back: a `decimal` and a
    // `bigint` are strings in JavaScript, and every other hook here has to
    // see the same value the application wrote (./exact-paths.js)
    const exact = exactPaths(model.schema || {});

    if (Object.keys(exact).length > 0) {
      exactness(schema, exact);
    }

    // Before the model is compiled: `register()` is what refuses the boot
    // when a field says `encrypted` and the application has no key
    if (Object.keys(encrypted).length > 0) {
      this.henri.encryption.register(model.globalId, encrypted);
      encryption(schema, encrypted, this.henri, model.globalId);
    }

    // Every model carries a public identifier; the document id is internal
    if (wantsExternalId({ options: { externalId: external } })) {
      externalId(schema);
    }

    // The third identifier, and the only one a person reads. After the
    // public one, because the discriminator of a generated slug is taken
    // from it (./slug.js)
    const declaredSlug = slugOf(model);

    if (declaredSlug) {
      slugged(schema, declaredSlug, model.globalId);
    }

    // Before the soft delete, so a tenanted model that also soft deletes
    // carries both conditions -- and after the identifier, because the
    // column is added here. The mark is null unless `config.tenancy` asked,
    // so a single-tenant application registers no hook at all (./tenant.js)
    const mark =
      belongsToTenant && this.henri.tenancy
        ? this.henri.tenancy.markFor(model)
        : null;

    if (mark) {
      tenant(schema, this.henri, model.globalId, mark);
    }

    if (soft) {
      paranoid(schema);
    }

    if (isUser) {
      this.overload(schema, model);
    }

    // Last, and only for a model that asked: its post('save') has to run
    // after the one the encryption plugin registered, which is what puts
    // the plaintext back into the document
    if (keepsVersions) {
      versioned(schema, this.henri, model.globalId);
    }

    // Last on the schema, so what it measures is every other plugin's work
    // as well: an application that is not counting gets no hook at all
    instrumentQueries(schema, this, model.globalId);

    const instance = instrumentStatics(
      this.mongoose.model(model.globalId, schema, model.name || undefined),
      this
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

    // The account flows (base/accounts.js): when the address was confirmed,
    // and when the password last changed. The second one is what retires the
    // sessions that were open when a password was reset.
    schema.add({ confirmedAt: { default: null, type: Date } });
    schema.add({ passwordChangedAt: { default: null, type: Date } });

    const encrypt = (password, identity) =>
      thisHenri.user.encrypt(password, { identity });

    /**
     * Are new hashes bound to the document they belong to? An older core (or
     * a stand-in that only implements `encrypt`) answers no, which is the
     * behaviour it had.
     *
     * @returns {boolean} true when a password write must name its document
     */
    const binds = () =>
      typeof thisHenri.user.bindsPasswords === 'function' &&
      thisHenri.user.bindsPasswords();

    /**
     * The error to throw when a password write cannot name its document
     *
     * @param {string} detail What the caller was doing
     * @returns {Error} The error
     */
    const unresolved = (detail) =>
      typeof thisHenri.user.unresolvedPassword === 'function'
        ? thisHenri.user.unresolvedPassword(detail)
        : new Error(`cannot hash a password from ${detail}`);

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

    /**
     * Is the password already a hash?
     *
     * @param {object} doc The document
     * @param {object} [options] The save options
     * @returns {boolean} true when flagged passwordsHashed
     */
    const isHashed = (doc, options) =>
      Boolean(
        (options && options.passwordsHashed) ||
        (doc.$locals && doc.$locals.passwordsHashed)
      );

    schema.pre('save', async function preSave(options) {
      if (!isUnsafe(this, options) && this.isModified('roles')) {
        if (this.isNew) {
          this.roles = [...baseRoles];
        } else {
          this.$ignore('roles');
        }
      }

      // `save({ passwordsHashed: true })` writes a hash straight through,
      // the way the sequelize and drizzle adapters already do; core uses it
      // to upgrade a stored hash after a successful sign-in
      if (this.isModified('password') && !isHashed(this, options)) {
        // The uuid default is applied when the document is constructed, so it
        // is here before the insert
        this.password = await encrypt(this.password, this[EXTERNAL_ID]);
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

      const targets = [update, update.$set, update.$setOnInsert].filter(
        (target) => target && typeof target.password === 'string'
      );

      if (targets.length === 0) {
        return;
      }

      let identity;

      if (binds()) {
        if (this.getOptions().upsert) {
          // An upsert that inserts invents the document, and its externalId
          // with it, after this hook has run: there is no identity to bind to
          // and no way to check one later
          throw unresolved(`an upserting ${this.op}()`);
        }

        const rows = await this.model
          .find(this.getFilter())
          .select(EXTERNAL_ID)
          .limit(2)
          .lean();

        if (rows.length > 1) {
          throw unresolved(`${this.op}() over more than one document`);
        }

        // No match writes to nothing, but a document could still appear in
        // the race: a uuid nobody has makes that hash unusable rather than
        // usable by whoever landed there
        identity = rows.length === 1 ? rows[0][EXTERNAL_ID] : uuidv7();
      }

      for (const target of targets) {
        target.password = await encrypt(target.password, identity);
      }
    });

    // `insertMany` runs no document middleware, so until now it wrote the
    // password it was given straight to the collection -- in the clear -- and
    // kept whatever roles came with it. It is a bulk *create*, so every
    // document is in hand and each hash is bound to its own; the externalId
    // is stamped here rather than left to the schema default, because the
    // default is applied after this hook and the hash has to name it.
    schema.pre('insertMany', async function preInsertMany(docs, options = {}) {
      const list = Array.isArray(docs) ? docs : [docs];

      for (const doc of list) {
        if (!doc || typeof doc !== 'object') {
          continue;
        }

        if (!options.unsafe) {
          doc.roles = [...baseRoles];
        }

        if (typeof doc.password === 'string' && !options.passwordsHashed) {
          if (!doc[EXTERNAL_ID]) {
            doc[EXTERNAL_ID] = uuidv7();
          }

          doc.password = await encrypt(doc.password, doc[EXTERNAL_ID]);
        }
      }
    });

    // `bulkWrite` runs no middleware either, and its operations are a whole
    // little language of their own. Rather than reimplement the hooks inside
    // it, a password written this way is refused: it would otherwise be
    // stored in the clear, which no application can be relying on.
    schema.pre('bulkWrite', function preBulkWrite(ops = []) {
      const writes = Array.isArray(ops) ? ops : [];

      for (const operation of writes) {
        const [name] = Object.keys(operation || {});
        const body = (operation || {})[name] || {};
        const candidates = [
          body.document,
          body.replacement,
          body.update,
          (body.update || {}).$set,
          (body.update || {}).$setOnInsert,
        ];

        if (
          candidates.some(
            (target) => target && typeof target.password === 'string'
          )
        ) {
          throw unresolved(`${name}() inside bulkWrite()`);
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

      // Either identifier: this is henri's own call, not a url naming a row
      return this.findOneAndUpdate(
        isUuid(id) ? { [EXTERNAL_ID]: id } : { _id: id },
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
   * What this store can state about its foreign keys, for core's exit gate
   * (core's `base/references.js`).
   *
   * The source is the schema, and only what it declared: `ref` on a path
   * (`{ type: ObjectId, ref: 'User' }`) and `ref` on the caster of an array
   * of them. Two things a Mongoose schema can also say are deliberately not
   * read, because neither can be answered without the document in hand and
   * a wrong answer publishes the identifier of a row in another collection:
   * `refPath`, where the target is named by a sibling field, and a `ref`
   * given as a function.
   *
   * A path holding an id without saying so -- `ownerId: { type: 'string' }`
   * -- is not a reference here, and henri does not read its name to decide
   * otherwise.
   *
   * @returns {object} `{ [globalId]: { externalId, references } }`
   * @memberof Mongoose
   */
  references() {
    const described = {};
    const known = new Set(Object.keys(this.models));

    for (const globalId of Object.keys(this.models)) {
      const Model = this.models[globalId];
      const references = {};

      Model.schema.eachPath((name, path) => {
        if (name === '_id' || name === EXTERNAL_ID) {
          return;
        }

        const options = path.options || {};
        // An array of refs keeps the element's options on its embedded
        // schema type (`caster` on the mongoose versions that used it)
        const element =
          (path.embeddedSchemaType && path.embeddedSchemaType.options) ||
          (path.caster && path.caster.options) ||
          {};
        const target =
          typeof options.ref === 'string' ? options.ref : element.ref;

        // `refPath` and a function `ref` name a collection per document:
        // henri leaves those alone rather than resolve the wrong one
        if (typeof target !== 'string' || !known.has(target)) {
          return;
        }

        references[name] = { as: null, target };
      });

      described[globalId] = {
        externalId: Boolean(Model.schema.path(EXTERNAL_ID)),
        references,
        slug: Boolean(slugOf(this.definitions[globalId].model)),
      };
    }

    return described;
  }

  /**
   * The public identifiers of documents named by their document id: one
   * query for the whole set, which is what keeps a page of records from
   * costing a query per reference.
   *
   * Soft deleted documents included: a record pointing at a withdrawn row
   * still publishes an identifier for it rather than fall back to the
   * document id.
   *
   * @param {string} modelName The global id of the model
   * @param {Array} keys The document ids
   * @returns {Promise<Map<string, string>>} externalId by document id
   * @memberof Mongoose
   */
  async externalIdsOf(modelName, keys) {
    const Model = this.models[modelName];
    const found = new Map();

    if (!Model || !Model.schema.path(EXTERNAL_ID) || keys.length === 0) {
      return found;
    }

    const valid = keys.filter((key) =>
      this.mongoose.Types.ObjectId.isValid(String(key))
    );

    if (valid.length === 0) {
      return found;
    }

    const rows = await Model.collection
      .find(
        {
          _id: {
            $in: valid.map(
              (key) => new this.mongoose.Types.ObjectId(String(key))
            ),
          },
        },
        { projection: { [EXTERNAL_ID]: 1 } }
      )
      .toArray();

    for (const row of rows) {
      if (typeof row[EXTERNAL_ID] === 'string') {
        found.set(String(row._id), row[EXTERNAL_ID]);
      }
    }

    return found;
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

    const Model = this.getUserModel();

    try {
      // The subject of a session is a document id henri wrote itself, so
      // this is a key lookup and never the strict `findById()` a url goes
      // through; a token minted with the public identifier still works
      return await (isUuid(id)
        ? Model.findByExternalId(id)
        : Model.findByKey(id));
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

    // The document id never leaves the server when there is a public one
    if (plain[EXTERNAL_ID]) {
      delete plain._id;
      delete plain.id;
    }

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
      throw coded(
        'HENRI_STORE_NOT_STARTED',
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
      throw coded(
        'HENRI_STORE_NOT_STARTED',
        `${this.adapterName}: store ${this.name} is not started`
      );
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
   * What the database holds, in its own words -- and MongoDB has fewer
   * words than a SQL server does.
   *
   * Three of the four things asked here are real, server-side facts: which
   * collections exist, which indexes each one carries, and which
   * collections no model claims. The fourth, the fields, is not: MongoDB
   * validates nothing henri gave it, so the columns come from the Mongoose
   * schema -- henri's own declaration, applied by this process on its way
   * in and out. A document written by anything else can hold any shape at
   * all, and one written before a field was added or removed still holds
   * the old one.
   *
   * So the answer says `read: 'models'` and `enforced: false` rather than
   * pretending it read a schema back, and it carries a `note` saying the
   * same thing in a sentence, because the reader is usually an agent that
   * will act on it.
   *
   * @returns {Promise<object>} The schema
   * @memberof Mongoose
   */
  async describe() {
    const { db } = this.mongoose.connection;

    if (!db) {
      throw coded(
        'HENRI_STORE_NOT_STARTED',
        `${this.adapterName}: store ${this.name} is not started`
      );
    }

    const present = await db
      .listCollections({}, { nameOnly: true })
      .toArray()
      .then((entries) => entries.map((entry) => entry.name))
      .catch((error) => {
        debug('cannot list the collections: %s', error.message);

        return null;
      });
    const claimed = new Set();
    const tables = [];

    for (const globalId of Object.keys(this.models)) {
      const Model = this.models[globalId];
      const table = Model.collection.name;

      const declared = (this.definitions[globalId] || {}).model || {};

      claimed.add(table);
      tables.push({
        columns: pathsOf(Model.schema, validationsOf(declared)),
        exists: present ? present.includes(table) : true,
        indexes: await indexesOf(Model),
        model: globalId,
        table,
      });
    }

    return {
      adapter: this.adapterName,
      dialect: null,
      enforced: false,
      kind: 'document',
      note: 'MongoDB enforces no schema: the fields below are what the models declare and what Mongoose applies in this process, not what the documents hold. The collections and the indexes are read from the server.',
      read: 'models',
      store: this.name,
      tables: tables.sort((left, right) =>
        left.table.localeCompare(right.table)
      ),
      unclaimed: (present || [])
        .filter((table) => !claimed.has(table))
        .sort((left, right) => left.localeCompare(right)),
    };
  }

  /**
   * The Mongoose instance this store's models are built on, and the one
   * place that says what one is built with.
   *
   * There are two constructions, not one: the constructor builds it, and
   * `stop()` builds another so that a store which is started again does
   * not reuse the connection it disconnected. Nothing configures the
   * instance today -- the plugins are registered per schema in
   * `addModel()`, and the connect options are `connectOptions()` -- so the
   * two were identical and nothing was being lost. They are named once
   * here so a `set()` or an instance-wide plugin added later cannot reach
   * the first construction and miss the second, which would leave a
   * restarted store configured differently from a fresh one and nothing
   * would say so. `__tests__/mongoose.spec.js` compares what the two
   * instances hold across a restart.
   *
   * @returns {mongoose.Mongoose} A fresh Mongoose instance
   * @memberof Mongoose
   */
  newConnection() {
    return new mongoose.Mongoose();
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

    // The unique indexes (the email of the user model, the external id of
    // every model) must exist before the first request: mongoose builds them
    // when the model is initialized, and `unique` is nothing but an index
    await Promise.all(Object.values(this.models).map((Model) => Model.init()));

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
    this.mongoose = this.newConnection();
    this.models = {};
    this.associated = new Set();
    debug('stopped %s', this.name);
  }
}

module.exports = Mongoose;
