const { eq } = require('drizzle-orm');
const { Relation } = require('./relation');
const { normalizeField } = require('./schema');
const { ValidationError, failure, validate } = require('./validation');
const {
  isPlainObject,
  lowerFirst,
  pluralize,
  tableNameOf,
} = require('./utils');

// Private instance state (persisted flag, original values)
const STATE = Symbol('henri.model.state');

// Hooks a model file may export (top level or under `hooks`)
const HOOKS = [
  'afterCreate',
  'afterDestroy',
  'afterLoad',
  'afterUpdate',
  'beforeCreate',
  'beforeDestroy',
  'beforeUpdate',
  'beforeValidate',
];

// Fields never taken from mass-assigned attributes
const PROTECTED = ['createdAt', 'deletedAt', 'updatedAt'];

// Keys that make a first argument an options object instead of a condition
const OPTION_KEYS = new Set([
  'include',
  'limit',
  'offset',
  'order',
  'select',
  'where',
  'withDeleted',
  'withHidden',
]);

/**
 * Deep equality for dirty tracking (dates, arrays and JSON values)
 *
 * @param {*} left A value
 * @param {*} right Another value
 * @returns {boolean} true when equal
 */
const same = (left, right) => {
  if (left === right) {
    return true;
  }

  if (left instanceof Date || right instanceof Date) {
    return (
      left instanceof Date &&
      right instanceof Date &&
      left.getTime() === right.getTime()
    );
  }

  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object'
  ) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return false;
};

/**
 * Splits `find(where, options)` and `find({ where, order, limit })`
 *
 * @param {function} Model The model
 * @param {*} where The first argument
 * @param {object} [options={}] The second argument
 * @returns {{ where: *, options: object }} The condition and the options
 */
const splitArguments = (Model, where, options = {}) => {
  if (
    isPlainObject(where) &&
    Object.keys(where).length > 0 &&
    Object.keys(where).every(
      (key) => OPTION_KEYS.has(key) && !Model.fields[key]
    )
  ) {
    const { where: condition, ...rest } = where;

    return { options: { ...rest, ...options }, where: condition };
  }

  return { options, where };
};

/**
 * Base of every model: a Rails-like, Mongoose-compatible API over one
 * Drizzle table. `createModel()` builds a subclass per model file.
 *
 * @class Model
 */
class Model {
  /**
   * Creates an unsaved instance
   *
   * @param {object} [attrs={}] Attributes
   * @memberof Model
   */
  constructor(attrs = {}) {
    Object.defineProperty(this, STATE, {
      enumerable: false,
      value: { original: {}, persisted: false },
      writable: true,
    });
    Object.assign(this, attrs);
  }

  // Query building

  /**
   * An empty relation (every row)
   *
   * @returns {Relation} A relation
   * @memberof Model
   */
  static query() {
    return new Relation(this);
  }

  /**
   * Rows matching a condition (lazy, chainable)
   *
   * @param {*} condition See compileWhere
   * @returns {Relation} A relation
   * @memberof Model
   */
  static where(condition) {
    return this.query().where(condition);
  }

  /**
   * Every row ordered
   *
   * @param {...*} order See compileOrder
   * @returns {Relation} A relation
   * @memberof Model
   */
  static order(...order) {
    return this.query().order(...order);
  }

  /**
   * At most `limit` rows
   *
   * @param {number} limit The limit
   * @returns {Relation} A relation
   * @memberof Model
   */
  static limit(limit) {
    return this.query().limit(limit);
  }

  /**
   * Every row with associations eager loaded
   *
   * @param {...string} includes Association names
   * @returns {Relation} A relation
   * @memberof Model
   */
  static include(...includes) {
    return this.query().include(...includes);
  }

  /**
   * Every row, hidden fields included
   *
   * @returns {Relation} A relation
   * @memberof Model
   */
  static withHidden() {
    return this.query().withHidden();
  }

  /**
   * Every row, the soft deleted ones included (`options.paranoid`)
   *
   * @returns {Relation} A relation
   * @memberof Model
   */
  static withDeleted() {
    return this.query().withDeleted();
  }

  /**
   * The soft deleted rows only (`options.paranoid`)
   *
   * @returns {Relation} A relation
   * @memberof Model
   */
  static onlyDeleted() {
    return this.query().onlyDeleted();
  }

  /**
   * A relation from a condition and options (`order`, `limit`, `offset`,
   * `include`, `select`, `withHidden`, `withDeleted`)
   *
   * @param {*} where The condition
   * @param {object} [options={}] The options
   * @returns {Relation} A relation
   * @memberof Model
   */
  static relation(where, options = {}) {
    const split = splitArguments(this, where, options);
    let relation = this.query().where(split.where);

    if (split.options.order) {
      relation = relation.order(split.options.order);
    }
    if (typeof split.options.limit === 'number') {
      relation = relation.limit(split.options.limit);
    }
    if (typeof split.options.offset === 'number') {
      relation = relation.offset(split.options.offset);
    }
    if (split.options.include) {
      relation = relation.include(split.options.include);
    }
    if (split.options.select) {
      relation = relation.select(split.options.select);
    }
    if (split.options.withHidden) {
      relation = relation.withHidden();
    }
    if (split.options.withDeleted) {
      relation = relation.withDeleted();
    }

    return relation;
  }

  // Reads

  /**
   * Every row
   *
   * @returns {Promise<Array<Model>>} The instances
   * @memberof Model
   */
  static all() {
    return this.query().toArray();
  }

  /**
   * Rows matching a condition
   *
   * @param {*} [where] The condition
   * @param {object} [options] `order`, `limit`, `offset`, `include`, ...
   * @returns {Promise<Array<Model>>} The instances
   * @memberof Model
   */
  static find(where, options) {
    return this.relation(where, options).toArray();
  }

  /**
   * Alias of find() (Sequelize)
   *
   * @param {*} [where] The condition
   * @param {object} [options] Options
   * @returns {Promise<Array<Model>>} The instances
   * @memberof Model
   */
  static findAll(where, options) {
    return this.find(where, options);
  }

  /**
   * The first row matching a condition
   *
   * @param {*} [where] The condition
   * @param {object} [options] Options
   * @returns {Promise<?Model>} The instance or null
   * @memberof Model
   */
  static findOne(where, options) {
    return this.relation(where, options).first();
  }

  /**
   * A row by id (null for a malformed id, like a stale session)
   *
   * @param {*} id The id
   * @param {object} [options={}] Options (`include`, `withHidden`)
   * @returns {Promise<?Model>} The instance or null
   * @memberof Model
   */
  static async findById(id, options = {}) {
    if (!this.isValidId(id)) {
      return null;
    }

    return this.relation({ id: this.castId(id) }, options).first();
  }

  /**
   * Alias of findById() (Sequelize)
   *
   * @param {*} id The id
   * @param {object} [options] Options
   * @returns {Promise<?Model>} The instance or null
   * @memberof Model
   */
  static findByPk(id, options) {
    return this.findById(id, options);
  }

  /**
   * The first row by id
   *
   * @returns {Promise<?Model>} The instance or null
   * @memberof Model
   */
  static first() {
    return this.query().first();
  }

  /**
   * The last row by id
   *
   * @returns {Promise<?Model>} The instance or null
   * @memberof Model
   */
  static last() {
    return this.query().last();
  }

  /**
   * Counts rows
   *
   * @param {*} [where] The condition
   * @returns {Promise<number>} The count
   * @memberof Model
   */
  static count(where) {
    return this.relation(where).count();
  }

  /**
   * Alias of count() (Mongoose)
   *
   * @param {*} [where] The condition
   * @returns {Promise<number>} The count
   * @memberof Model
   */
  static countDocuments(where) {
    return this.count(where);
  }

  /**
   * One page of rows and the counters `res.collection()` wants
   *
   * @param {object} [options={}] `page` and `perPage` (as `req.pagination()`
   *   returns them, its `limit`, `offset` and `skip` are ignored), plus the
   *   usual query options (`where`, `order`, `include`, `select`,
   *   `withDeleted`, ...)
   * @returns {Promise<object>} `{ records, page, perPage, total, pages }`
   * @memberof Model
   */
  static paginate(options = {}) {
    // `limit`, `offset` and `skip` are dropped so `Model.paginate(
    // req.pagination())` can be handed the whole object
    const { limit, offset, page, perPage, skip, ...query } = options;

    return this.relation(query.where, query).paginate({ page, perPage });
  }

  /**
   * Is there a row matching the condition?
   *
   * @param {*} [where] The condition
   * @returns {Promise<boolean>} true when a row matches
   * @memberof Model
   */
  static exists(where) {
    return this.relation(where).exists();
  }

  /**
   * The values of one field
   *
   * @param {string} field The field
   * @param {*} [where] The condition
   * @returns {Promise<Array>} The values
   * @memberof Model
   */
  static pluck(field, where) {
    return this.relation(where).pluck(field);
  }

  // Writes

  /**
   * An unsaved instance
   *
   * @param {object} [attrs={}] Attributes
   * @returns {Model} The instance
   * @memberof Model
   */
  static build(attrs = {}) {
    return new this(attrs);
  }

  /**
   * Validates, runs the hooks and inserts one row (or one per element of
   * an array)
   *
   * @param {(object|Array<object>)} attrs Attributes
   * @param {object} [options={}] Options (`unsafe` for the user roles)
   * @returns {Promise<(Model|Array<Model>)>} The instance(s)
   * @throws {ValidationError} When the attributes are invalid
   * @memberof Model
   */
  static async create(attrs, options = {}) {
    if (Array.isArray(attrs)) {
      const created = [];

      for (const entry of attrs) {
        created.push(await this.create(entry, options));
      }

      return created;
    }

    const values = await this.prepare('create', attrs, options, null);
    const row = await this.run(() => this.insert(values));
    const instance = this.hydrate(row);

    await this.runHooks('afterCreate', instance, options);

    return instance;
  }

  /**
   * Updates every row matching a condition (mass update: validation and
   * hooks run once, without an instance)
   *
   * @param {*} where The condition
   * @param {object} attrs The attributes
   * @param {object} [options={}] Options (`unsafe` for the user roles)
   * @returns {Promise<number>} The number of rows updated
   * @throws {ValidationError} When the attributes are invalid
   * @memberof Model
   */
  static update(where, attrs, options = {}) {
    const split = splitArguments(this, where);

    return this.query().where(split.where).update(attrs, options);
  }

  /**
   * Alias of update() (Mongoose)
   *
   * @param {*} where The condition
   * @param {object} attrs The attributes
   * @param {object} [options] Options
   * @returns {Promise<number>} The number of rows updated
   * @memberof Model
   */
  static updateMany(where, attrs, options) {
    return this.update(where, attrs, options);
  }

  /**
   * Deletes every row matching a condition (no instance hooks). On a
   * paranoid model this stamps `deletedAt`; `{ force: true }` deletes.
   *
   * @param {*} [where] The condition (every row without one)
   * @param {object} [options={}] `force: true` for a real delete
   * @returns {Promise<number>} The number of rows deleted
   * @memberof Model
   */
  static destroy(where, options = {}) {
    const split = splitArguments(this, where);

    return this.query().where(split.where).destroy(options);
  }

  /**
   * Alias of destroy() (Mongoose)
   *
   * @param {*} [where] The condition
   * @param {object} [options] Options
   * @returns {Promise<number>} The number of rows deleted
   * @memberof Model
   */
  static deleteMany(where, options) {
    return this.destroy(where, options);
  }

  /**
   * Clears the `deletedAt` stamp of every matching row (paranoid models)
   *
   * @param {*} [where] The condition
   * @returns {Promise<number>} The number of rows restored
   * @memberof Model
   */
  static restore(where) {
    const split = splitArguments(this, where);

    return this.onlyDeleted().where(split.where).restore();
  }

  /**
   * Updates a row by id and returns it (null when missing or malformed)
   *
   * @param {*} id The id
   * @param {object} attrs The attributes
   * @param {object} [options={}] Options (`unsafe`; Mongoose's `new` and
   *   `runValidators` are accepted and always on)
   * @returns {Promise<?Model>} The updated instance or null
   * @throws {ValidationError} When the attributes are invalid
   * @memberof Model
   */
  static async findByIdAndUpdate(id, attrs, options = {}) {
    if (!this.isValidId(id)) {
      return null;
    }

    const values = await this.prepare('update', attrs, options, null);
    const row = await this.run(() => this.updateById(this.castId(id), values));

    if (!row) {
      return null;
    }

    const instance = this.hydrate(row);

    await this.runHooks('afterUpdate', instance, options);

    return instance;
  }

  /**
   * Deletes a row by id and returns it (null when missing or malformed)
   *
   * @param {*} id The id
   * @returns {Promise<?Model>} The deleted instance or null
   * @memberof Model
   */
  static async findByIdAndDelete(id) {
    const instance = await this.findById(id);

    if (!instance) {
      return null;
    }

    await instance.destroy();

    return instance;
  }

  /**
   * Alias of findByIdAndDelete() (Mongoose)
   *
   * @param {*} id The id
   * @returns {Promise<?Model>} The deleted instance or null
   * @memberof Model
   */
  static findByIdAndRemove(id) {
    return this.findByIdAndDelete(id);
  }

  /**
   * Updates the first row matching a condition and returns it
   *
   * @param {*} where The condition
   * @param {object} attrs The attributes
   * @param {object} [options={}] Options
   * @returns {Promise<?Model>} The updated instance or null
   * @memberof Model
   */
  static async findOneAndUpdate(where, attrs, options = {}) {
    const instance = await this.findOne(where);

    return instance ? instance.update(attrs, options) : null;
  }

  /**
   * Deletes the first row matching a condition and returns it
   *
   * @param {*} where The condition
   * @returns {Promise<?Model>} The deleted instance or null
   * @memberof Model
   */
  static async findOneAndDelete(where) {
    const instance = await this.findOne(where);

    if (instance) {
      await instance.destroy();
    }

    return instance;
  }

  // Associations (declared in the model file's `associate(models)`)

  /**
   * This model holds the foreign key of another (`Post.belongsTo(User)`)
   *
   * @param {(function|string)} Target The other model (or its name)
   * @param {object} [options={}] `as` (default: the model name in
   *   camelCase), `foreignKey` (default: `<as>Id`), `onDelete`
   * @returns {object} The association
   * @memberof Model
   */
  static belongsTo(Target, options = {}) {
    const target = typeof Target === 'string' ? Target : Target.modelName;
    const as = options.as || lowerFirst(target);
    const foreignKey = options.foreignKey || `${as}Id`;
    const association = { as, foreignKey, kind: 'belongsTo', target };

    if (this.associations.some((entry) => entry.as === as)) {
      return association;
    }

    this.associations.push(association);
    this.addField(foreignKey, {
      index: true,
      references: { model: target, onDelete: options.onDelete },
      type: 'integer',
    });

    return association;
  }

  /**
   * Another model holds this model's key, many times
   * (`User.hasMany(Post)`)
   *
   * @param {(function|string)} Target The other model (or its name)
   * @param {object} [options={}] `as` (default: the plural model name in
   *   camelCase), `foreignKey` (default: `<thisModel>Id`), `onDelete`
   * @returns {object} The association
   * @memberof Model
   */
  static hasMany(Target, options = {}) {
    return this.hasAssociation('hasMany', Target, options);
  }

  /**
   * Another model holds this model's key, once (`User.hasOne(Profile)`)
   *
   * @param {(function|string)} Target The other model (or its name)
   * @param {object} [options={}] `as`, `foreignKey`, `onDelete`
   * @returns {object} The association
   * @memberof Model
   */
  static hasOne(Target, options = {}) {
    return this.hasAssociation('hasOne', Target, options);
  }

  /**
   * Shared by hasMany and hasOne: the foreign key lives on the target
   *
   * @param {string} kind hasMany or hasOne
   * @param {(function|string)} Target The other model (or its name)
   * @param {object} options `as`, `foreignKey`, `onDelete`
   * @returns {object} The association
   * @memberof Model
   */
  static hasAssociation(kind, Target, options) {
    const target = typeof Target === 'string' ? Target : Target.modelName;
    const Other = this.adapter.models[target];
    const as =
      options.as ||
      (kind === 'hasMany' ? pluralize(lowerFirst(target)) : lowerFirst(target));
    const foreignKey = options.foreignKey || `${lowerFirst(this.modelName)}Id`;
    const association = { as, foreignKey, kind, target };

    if (!Other) {
      throw new Error(
        `${this.modelName}.${kind}(${target}): unknown model ${target}`
      );
    }

    if (this.associations.some((entry) => entry.as === as)) {
      return association;
    }

    this.associations.push(association);

    // The reverse side (the one holding the key) is what Drizzle needs
    const reverse = Other.associations.find(
      (entry) =>
        entry.kind === 'belongsTo' &&
        entry.target === this.modelName &&
        entry.foreignKey === foreignKey
    );

    if (!reverse) {
      Other.belongsTo(this, {
        as: Other.associations.some(
          (entry) => entry.as === lowerFirst(this.modelName)
        )
          ? `${lowerFirst(this.modelName)}Of${as}`
          : lowerFirst(this.modelName),
        foreignKey,
        onDelete: options.onDelete,
      });
    }

    return association;
  }

  /**
   * Adds a field after the model file was read (foreign keys)
   *
   * @param {string} name The field
   * @param {object} definition The definition (henri format)
   * @returns {void}
   * @memberof Model
   */
  static addField(name, definition) {
    if (this.fields[name]) {
      return;
    }

    this.fields[name] = normalizeField(name, definition);
    this.adapter.dirty = true;
  }

  /**
   * The Drizzle table (compiled by the adapter)
   *
   * @readonly
   * @static
   * @returns {object} The table
   * @throws {Error} Before the adapter compiled the schema
   * @memberof Model
   */
  static get table() {
    const entry = this.adapter.tables[this.key];

    if (!entry) {
      throw new Error(
        `${this.modelName}: the store '${this.adapter.name}' is not started`
      );
    }

    return entry.table;
  }

  /**
   * The Drizzle database (or the active transaction)
   *
   * @returns {object} The database
   * @memberof Model
   */
  static db() {
    return this.adapter.database();
  }

  /**
   * A column by field name
   *
   * @param {string} field The field
   * @returns {object} The column
   * @throws {Error} On unknown fields
   * @memberof Model
   */
  static column(field) {
    const column = this.table[field];

    if (!column || (!this.fields[field] && field !== 'id')) {
      throw new Error(
        `Unknown field '${field}' on ${this.modelName}; fields are ${Object.keys(
          this.fields
        ).join(', ')}`
      );
    }

    return column;
  }

  /**
   * The columns to select
   *
   * @param {object} [options={}] `hidden` to include hidden fields,
   *   `select` to pick fields
   * @returns {object} Columns by field
   * @memberof Model
   */
  static selection({ hidden = false, select = null } = {}) {
    const { table } = this;
    const fields = select
      ? ['id', ...select].filter((field) => table[field])
      : Object.keys(table).filter(
          (field) => table[field] && (hidden || !this.hidden.includes(field))
        );

    return Object.fromEntries(
      [...new Set(fields)].map((field) => [field, table[field]])
    );
  }

  /**
   * Is the value a possible id for this model?
   *
   * @param {*} id The id
   * @returns {boolean} false for a malformed id
   * @memberof Model
   */
  static isValidId(id) {
    if (id === null || typeof id === 'undefined' || id === '') {
      return false;
    }

    const field = this.fields.id;

    if (!field || field.type === 'integer') {
      return /^\d+$/.test(String(id));
    }

    return typeof id === 'string' || typeof id === 'number';
  }

  /**
   * Casts an id to its column type
   *
   * @param {*} id The id
   * @returns {*} The id
   * @memberof Model
   */
  static castId(id) {
    const field = this.fields.id;

    return !field || field.type === 'integer' ? Number(id) : id;
  }

  /**
   * Runs a database call, translating driver errors
   *
   * @param {function} fn The call
   * @returns {Promise<*>} What fn returns
   * @throws {ValidationError} On unique constraint violations
   * @memberof Model
   */
  static async run(fn) {
    try {
      return await fn();
    } catch (error) {
      throw this.translateError(error);
    }
  }

  /**
   * Turns a unique constraint violation into a ValidationError
   *
   * @param {Error} error A driver error
   * @returns {Error} The error to throw
   * @memberof Model
   */
  static translateError(error) {
    const translated = this.adapter.dialect.translate(error);
    const details = translated && translated.henri;
    const entry = this.adapter.tables[this.key];

    if (!details || details.kind !== 'unique' || !entry) {
      return translated;
    }

    const { columns } = entry;
    const fields = Object.keys(columns).filter(
      (field) =>
        details.columns.includes(columns[field]) ||
        details.columns.includes(field) ||
        (details.key &&
          details.key === `${this.tableName}_${columns[field]}_unique`)
    );

    if (fields.length === 0) {
      return translated;
    }

    return new ValidationError(
      this.modelName,
      Object.fromEntries(
        fields.map((field) => [
          field,
          failure('unique', 'must be unique', field, undefined),
        ])
      )
    );
  }

  /**
   * Validates attributes and runs the before hooks
   *
   * @param {string} kind create or update
   * @param {object} attrs The attributes
   * @param {object} options The options
   * @param {?Model} instance The instance being saved (updates)
   * @returns {Promise<object>} The values to write
   * @throws {ValidationError} When the attributes are invalid
   * @memberof Model
   */
  static async prepare(kind, attrs, options, instance) {
    let data = { ...(isPlainObject(attrs) ? attrs : {}) };

    data =
      (await this.runHooks('beforeValidate', data, options, instance)) || data;

    let values = validate(this.modelName, this.fields, data, {
      partial: kind === 'update',
      skip: PROTECTED,
    });

    if (kind === 'create' && data.id !== undefined && this.isValidId(data.id)) {
      values.id = this.castId(data.id);
    }

    const hook = kind === 'create' ? 'beforeCreate' : 'beforeUpdate';

    values = (await this.runHooks(hook, values, options, instance)) || values;

    if (this.timestamps) {
      if (kind === 'create') {
        values.createdAt = values.createdAt || new Date();
        values.updatedAt = values.updatedAt || values.createdAt;
      } else {
        values.updatedAt = new Date();
      }
    }

    return values;
  }

  /**
   * Runs the hooks of the model file, then the adapter's (user model). A
   * before hook may mutate the values it receives or return new ones.
   *
   * @param {string} name The hook
   * @param {...*} args The hook arguments
   * @returns {Promise<*>} The last plain object a hook returned, if any
   * @memberof Model
   */
  static async runHooks(name, ...args) {
    let result;

    for (const hook of [...this.hooks[name], ...this.internalHooks[name]]) {
      const returned = await hook.call(this, ...args);

      if (isPlainObject(returned)) {
        result = returned;
        args[0] = returned;
      }
    }

    return result;
  }

  /**
   * Inserts a row and returns it
   *
   * @param {object} values The values
   * @returns {Promise<object>} The row
   * @memberof Model
   */
  static async insert(values) {
    const db = this.db();
    const { table } = this;

    if (this.adapter.dialect.returning) {
      const rows = await db.insert(table).values(values).returning();

      return rows[0];
    }

    const [{ id }] = await db.insert(table).values(values).$returningId();
    const rows = await db.select().from(table).where(eq(table.id, id));

    return rows[0];
  }

  /**
   * Updates a row by id and returns it
   *
   * @param {*} id The id
   * @param {object} values The values
   * @returns {Promise<?object>} The row or null
   * @memberof Model
   */
  static async updateById(id, values) {
    const db = this.db();
    const { table } = this;

    if (Object.keys(values).length === 0) {
      const rows = await db.select().from(table).where(eq(table.id, id));

      return rows[0] || null;
    }

    if (this.adapter.dialect.returning) {
      const rows = await db
        .update(table)
        .set(values)
        .where(eq(table.id, id))
        .returning();

      return rows[0] || null;
    }

    await db.update(table).set(values).where(eq(table.id, id));

    const rows = await db.select().from(table).where(eq(table.id, id));

    return rows[0] || null;
  }

  /**
   * Mass update on a compiled condition
   *
   * @param {?object} where The SQL condition
   * @param {object} attrs The attributes
   * @param {object} [options={}] Options
   * @returns {Promise<number>} The number of rows updated
   * @memberof Model
   */
  static async updateWhere(where, attrs, options = {}) {
    const values = await this.prepare('update', attrs, options, null);

    if (Object.keys(values).length === 0) {
      return 0;
    }

    const result = await this.run(() => {
      let query = this.db().update(this.table).set(values);

      if (where) {
        query = query.where(where);
      }

      return query;
    });

    return this.adapter.dialect.affected(result);
  }

  /**
   * Mass delete on a compiled condition. On a paranoid model this stamps
   * `deletedAt` instead, unless `force` is set.
   *
   * @param {?object} where The SQL condition
   * @param {object} [options={}] `force: true` for a real delete
   * @returns {Promise<number>} The number of rows deleted
   * @memberof Model
   */
  static async destroyWhere(where, options = {}) {
    if (this.paranoid && !options.force) {
      return this.setWhere(where, { deletedAt: new Date() });
    }

    const result = await this.run(() => {
      let query = this.db().delete(this.table);

      if (where) {
        query = query.where(where);
      }

      return query;
    });

    return this.adapter.dialect.affected(result);
  }

  /**
   * Writes values on every matching row, without validation or hooks (the
   * `deletedAt` stamp of the soft deletes)
   *
   * @param {?object} where The SQL condition
   * @param {object} values The values
   * @returns {Promise<number>} The number of rows written
   * @memberof Model
   */
  static async setWhere(where, values) {
    const result = await this.run(() => {
      let query = this.db().update(this.table).set(values);

      if (where) {
        query = query.where(where);
      }

      return query;
    });

    return this.adapter.dialect.affected(result);
  }

  /**
   * Builds a persisted instance from a row (eager loaded associations
   * become instances of their model)
   *
   * @param {object} row The row
   * @param {object} [options={}] `withHidden` keeps the hidden fields
   * @returns {Model} The instance
   * @memberof Model
   */
  static hydrate(row, { withHidden = false } = {}) {
    const data = { ...row };

    for (const association of this.associations) {
      const value = data[association.as];

      if (typeof value === 'undefined') {
        continue;
      }

      const Target = this.adapter.models[association.target];

      if (Array.isArray(value)) {
        data[association.as] = value.map((entry) => Target.hydrate(entry));
      } else if (value && typeof value === 'object') {
        data[association.as] = Target.hydrate(value);
      }
    }

    if (!withHidden) {
      this.hidden.forEach((field) => delete data[field]);
    }

    for (const hook of [
      ...this.hooks.afterLoad,
      ...this.internalHooks.afterLoad,
    ]) {
      hook.call(this, data);
    }

    const instance = new this(data);

    instance[STATE].persisted = true;
    instance[STATE].original = { ...data };

    return instance;
  }

  // Instances

  /**
   * Has the instance been saved?
   *
   * @readonly
   * @returns {boolean} true before the first save
   * @memberof Model
   */
  get isNew() {
    return !this[STATE].persisted;
  }

  /**
   * The model of the instance
   *
   * @readonly
   * @returns {function} The model
   * @memberof Model
   */
  get Model() {
    return this.constructor;
  }

  /**
   * Sets attributes without saving
   *
   * @param {object} attrs The attributes
   * @returns {Model} The instance
   * @memberof Model
   */
  set(attrs) {
    Object.assign(this, attrs);

    return this;
  }

  /**
   * Reads an attribute
   *
   * @param {string} field The field
   * @returns {*} The value
   * @memberof Model
   */
  get(field) {
    return this[field];
  }

  /**
   * The fields changed since the instance was loaded
   *
   * @returns {Array<string>} The dirty fields
   * @memberof Model
   */
  changed() {
    const { original } = this[STATE];

    return Object.keys(this).filter(
      (field) => this.Model.fields[field] && !same(this[field], original[field])
    );
  }

  /**
   * The attributes to write on save: every field for a new instance, the
   * dirty ones otherwise
   *
   * @returns {object} The attributes
   * @memberof Model
   */
  dirtyAttributes() {
    const fields = this.isNew
      ? Object.keys(this).filter((field) => this.Model.fields[field])
      : this.changed();

    return Object.fromEntries(fields.map((field) => [field, this[field]]));
  }

  /**
   * Inserts a new instance, or writes the changed fields of an existing one
   *
   * @param {object} [options={}] Options (`unsafe` for the user roles)
   * @returns {Promise<Model>} The instance
   * @throws {ValidationError} When the attributes are invalid
   * @memberof Model
   */
  async save(options = {}) {
    const { Model: Klass } = this;

    if (this.isNew) {
      const attrs = this.dirtyAttributes();

      if (this.id !== undefined) {
        attrs.id = this.id;
      }

      const values = await Klass.prepare('create', attrs, options, this);
      const row = await Klass.run(() => Klass.insert(values));

      this.merge(row);
      await Klass.runHooks('afterCreate', this, options);

      return this;
    }

    const values = await Klass.prepare(
      'update',
      this.dirtyAttributes(),
      options,
      this
    );
    const row = await Klass.run(() => Klass.updateById(this.id, values));

    if (!row) {
      throw new Error(`${Klass.modelName} ${this.id} no longer exists`);
    }

    this.merge(row);
    await Klass.runHooks('afterUpdate', this, options);

    return this;
  }

  /**
   * Sets attributes and saves
   *
   * @param {object} attrs The attributes
   * @param {object} [options={}] Options
   * @returns {Promise<Model>} The instance
   * @memberof Model
   */
  async update(attrs, options = {}) {
    this.set(attrs);

    return this.save(options);
  }

  /**
   * Deletes the row. On a paranoid model this stamps `deletedAt` and the
   * instance stays usable; `{ force: true }` deletes the row.
   *
   * @param {object} [options={}] `force: true` for a real delete
   * @returns {Promise<Model>} The instance
   * @memberof Model
   */
  async destroy(options = {}) {
    const { Model: Klass } = this;
    const where = eq(Klass.column('id'), this.id);

    await Klass.runHooks('beforeDestroy', this, options);

    if (Klass.paranoid && !options.force) {
      const deletedAt = new Date();

      await Klass.setWhere(where, { deletedAt });
      this.deletedAt = deletedAt;
      this[STATE].original.deletedAt = deletedAt;
    } else {
      await Klass.destroyWhere(where, { force: true });
      this[STATE].persisted = false;
    }

    await Klass.runHooks('afterDestroy', this, options);

    return this;
  }

  /**
   * Clears the `deletedAt` stamp of the row (paranoid models)
   *
   * @returns {Promise<Model>} The instance
   * @memberof Model
   */
  async restore() {
    const { Model: Klass } = this;

    await Klass.setWhere(eq(Klass.column('id'), this.id), { deletedAt: null });
    this.deletedAt = null;
    this[STATE].original.deletedAt = null;
    this[STATE].persisted = true;

    return this;
  }

  /**
   * Reads the row again
   *
   * @returns {Promise<Model>} The instance
   * @memberof Model
   */
  async reload() {
    const fresh = await this.Model.findById(this.id);

    if (!fresh) {
      throw new Error(`${this.Model.modelName} ${this.id} no longer exists`);
    }

    Object.keys(this).forEach((field) => delete this[field]);
    this.merge(fresh.toObject({ hidden: true }));

    return this;
  }

  /**
   * Merges a row into the instance and resets the dirty tracking
   *
   * @param {object} row The row
   * @returns {void}
   * @memberof Model
   */
  merge(row) {
    const data = this.Model.hydrate(row, { withHidden: true });
    const hidden = this.Model.hidden;

    Object.keys(data).forEach((field) => {
      if (!hidden.includes(field) || this[field] !== undefined) {
        this[field] = data[field];
      }
    });
    this[STATE].persisted = true;
    this[STATE].original = { ...this };
  }

  /**
   * A plain object without the hidden fields
   *
   * @param {object} [options={}] `hidden: true` keeps the hidden fields
   * @returns {object} The plain object
   * @memberof Model
   */
  toObject({ hidden = false } = {}) {
    const plain = {};

    for (const field of Object.keys(this)) {
      if (hidden || !this.Model.hidden.includes(field)) {
        const value = this[field];

        if (Array.isArray(value)) {
          plain[field] = value.map((entry) =>
            entry instanceof Model ? entry.toObject() : entry
          );
        } else {
          plain[field] = value instanceof Model ? value.toObject() : value;
        }
      }
    }

    return plain;
  }

  /**
   * JSON representation (hidden fields removed)
   *
   * @returns {object} The plain object
   * @memberof Model
   */
  toJSON() {
    return this.toObject();
  }
}

/**
 * Builds the model class of a model file
 *
 * @param {object} adapter The Drizzle adapter
 * @param {object} definition The model file (`schema`, `options`, `name`,
 *   hooks) with `globalId` set by core
 * @param {object} fields The normalized schema
 * @returns {function} The model class
 */
const createModel = (adapter, definition, fields) => {
  const modelName = definition.globalId || definition.identity;
  const source = definition.hooks || {};
  const hooks = Object.fromEntries(
    HOOKS.map((name) => [
      name,
      [source[name], definition[name]].filter(
        (hook) => typeof hook === 'function'
      ),
    ])
  );
  const internalHooks = Object.fromEntries(HOOKS.map((name) => [name, []]));
  const options = definition.options || {};
  // Rails has timestamps on every table: `timestamps: false` opts out
  const timestamps = options.timestamps !== false;
  const paranoid = options.paranoid === true;

  if (timestamps) {
    fields.createdAt = fields.createdAt || {
      default: Date.now,
      required: true,
      type: 'date',
    };
    fields.updatedAt = fields.updatedAt || {
      default: Date.now,
      required: true,
      type: 'date',
    };
  }

  if (paranoid) {
    fields.deletedAt = fields.deletedAt || { index: true, type: 'date' };
  }

  class Klass extends Model {}

  Object.defineProperty(Klass, 'name', { value: modelName });
  Object.defineProperty(Klass, 'hidden', {
    /**
     * The fields declared with `select: false`
     *
     * @returns {Array<string>} The hidden fields
     */
    get() {
      return Object.keys(this.fields).filter(
        (field) => this.fields[field].hidden
      );
    },
  });
  Object.assign(Klass, {
    adapter,
    associations: [],
    definition,
    fields,
    hooks,
    internalHooks,
    key: modelName,
    modelName,
    paranoid,
    tableName: tableNameOf(definition),
    timestamps,
  });

  return Klass;
};

module.exports = { HOOKS, Model, STATE, createModel };
