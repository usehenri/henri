const {
  SQL,
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  is,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  notInArray,
  notLike,
  or,
  sql,
} = require('drizzle-orm');
const { coded, isPlainObject } = require('./utils');
const { canonical, canonicalInteger, isExact, settingsOf } = require('./exact');
const { checkOrder, comparison, markOf } = require('./encryption');
const { checkMassWrite } = require('./versions');

/**
 * The operators whose answer depends on the order of the values, and which
 * a dialect keeping an exact number as text therefore cannot give without
 * a cast (see the `cast` of ./dialects.js)
 */
const ORDERED = new Set(['between', 'gt', 'gte', 'lt', 'lte']);

/**
 * Operators accepted inside a where value: `{ age: { gt: 18 } }` (the `$`
 * prefix of the Mongoose style is accepted too: `{ age: { $gt: 18 } }`)
 */
const OPERATORS = {
  between: (column, value) => and(gte(column, value[0]), lte(column, value[1])),
  eq: (column, value) => (value === null ? isNull(column) : eq(column, value)),
  gt,
  gte,
  ilike: (column, value, dialect) =>
    dialect === 'postgres' ? ilike(column, value) : like(column, value),
  in: (column, value) =>
    value.length === 0 ? sql`1 = 0` : inArray(column, value),
  like,
  lt,
  lte,
  ne: (column, value) =>
    value === null ? isNotNull(column) : ne(column, value),
  nin: (column, value) =>
    value.length === 0 ? sql`1 = 1` : notInArray(column, value),
  not: (column, value) =>
    value === null ? isNotNull(column) : ne(column, value),
  notIn: (column, value) =>
    value.length === 0 ? sql`1 = 1` : notInArray(column, value),
  notLike,
};

const LOGICAL = {
  and: (parts) => and(...parts),
  not: (parts) => not(parts.length === 1 ? parts[0] : and(...parts)),
  or: (parts) => or(...parts),
};

/**
 * The field definition of an exact column, when that is what the key names
 *
 * @param {function} Model The model
 * @param {string} key The field name
 * @returns {?object} The normalized field, or null
 */
const exactOf = (Model, key) => {
  const field = Model.fields && Model.fields[key];

  return field && isExact(field.type) ? field : null;
};

/**
 * One value compared against an exact column, as the column holds it.
 *
 * A condition is written in whatever the application had -- `10`,
 * `'10.00'`, `19.99` -- and the column holds one canonical spelling, so the
 * value is canonicalized before it is bound: on sqlite the comparison is
 * against text and `'10'` would never equal `'10.0000'` otherwise. A value
 * that is not a number at all is refused here rather than compared as text
 * and quietly matching nothing.
 *
 * @param {function} Model The model
 * @param {string} key The field name
 * @param {object} field The normalized field
 * @param {*} value The value from the condition
 * @returns {string} The canonical value
 * @throws {Error} When the value is not a number
 */
const exactValue = (Model, key, field, value) => {
  const answer =
    field.type === 'bigint'
      ? canonicalInteger(value)
      : canonical(value, settingsOf(field));

  if (answer.error) {
    throw coded(
      'HENRI_MODEL_INVALID_QUERY',
      `The condition on ${Model.modelName}.${key} is ${JSON.stringify(
        String(value)
      )}, which ${answer.error}: a ${field.type} is compared against a number`
    );
  }

  return answer.value;
};

/**
 * The column and the values of a comparison against an exact field
 *
 * @param {function} Model The model
 * @param {string} key The field name
 * @param {object} field The normalized field
 * @param {string} shorthand The operator, without its `$`
 * @param {*} value The value from the condition
 * @returns {{column: object, value: *}} What to compare, and with what
 */
const exactComparison = (Model, key, field, shorthand, value) => {
  const { dialect } = Model.adapter;
  const canonicalize = (entry) => exactValue(Model, key, field, entry);
  const values = Array.isArray(value)
    ? value.map(canonicalize)
    : canonicalize(value);

  if (!dialect.cast || !ORDERED.has(shorthand)) {
    return { column: Model.column(key), value: values };
  }

  return {
    column: dialect.cast(Model.column(key), field),
    value: Array.isArray(values)
      ? values.map((entry) => dialect.compared(entry, field))
      : dialect.compared(values, field),
  };
};

/**
 * The expression an order reads a column through: the column itself, or the
 * cast a dialect keeping an exact number as text needs to sort it
 *
 * @param {function} Model The model
 * @param {string} key The field name
 * @returns {object} A column or an SQL expression
 */
const ordered = (Model, key) => {
  const field = exactOf(Model, key);
  const { dialect } = Model.adapter;

  return field && dialect.cast
    ? dialect.cast(Model.column(key), field)
    : Model.column(key);
};

/**
 * Compiles a where condition into a Drizzle SQL expression
 *
 * Accepts `{ field: value }`, `{ field: [values] }`, `{ field: null }`,
 * `{ field: { gt: 1 } }`, `{ or: [...] }`, `{ and: [...] }`, `{ not: {...} }`,
 * a Drizzle SQL expression, a function `(table, operators) => SQL` or an
 * id. Unknown fields throw so a typo never matches everything.
 *
 * @param {function} Model The model
 * @param {*} condition The condition
 * @returns {?object} The SQL expression, or undefined for no condition
 * @throws {Error} On unknown fields or operators
 */
const compileWhere = (Model, condition) => {
  if (condition === null || typeof condition === 'undefined') {
    return undefined;
  }

  if (is(condition, SQL)) {
    return condition;
  }

  if (typeof condition === 'function') {
    return condition(Model.table, { ...OPERATORS, and, not, or, sql });
  }

  if (Array.isArray(condition)) {
    return and(...condition.map((entry) => compileWhere(Model, entry)));
  }

  if (typeof condition !== 'object') {
    return eq(Model.column('id'), condition);
  }

  const parts = [];

  for (const key of Object.keys(condition)) {
    const value = condition[key];
    const logical = key.replace(/^\$/, '');

    if (LOGICAL[logical] && !Model.fields[key]) {
      const entries = Array.isArray(value) ? value : [value];

      parts.push(
        LOGICAL[logical](entries.map((entry) => compileWhere(Model, entry)))
      );
      continue;
    }

    const column = Model.column(key);
    // An encrypted column holds an envelope, so a comparison has to be
    // against every envelope the value could be stored as -- one per
    // configured key. Anything but an equality is refused there rather
    // than matching nothing here (see ./encryption.js)
    const encrypted = markOf(Model, key);
    // A `decimal` or a `bigint` is a string on both sides of the boundary,
    // so a condition is canonicalized before it is bound and an ordered
    // comparison goes through the dialect's cast (see ./exact.js)
    const exact = exactOf(Model, key);

    if (value === null) {
      parts.push(isNull(column));
    } else if (exact && Array.isArray(value)) {
      parts.push(
        OPERATORS.in(
          column,
          value.map((entry) => exactValue(Model, key, exact, entry))
        )
      );
    } else if (Array.isArray(value)) {
      parts.push(OPERATORS.in(column, comparison(Model, key, value).value));
    } else if (is(value, SQL)) {
      parts.push(eq(column, value));
    } else if (isPlainObject(value)) {
      // An object with nothing this can read narrows nothing, so the row
      // would drop out of the condition and the query would answer more
      // than it was asked for. Sequelize's `Op` keys are symbols, which is
      // exactly how a condition arrives empty without a typo in sight.
      if (Object.keys(value).length === 0) {
        const symbols = Object.getOwnPropertySymbols(value);

        throw coded(
          'HENRI_MODEL_INVALID_QUERY',
          symbols.length > 0
            ? `The condition on ${Model.modelName}.${key} is keyed by ${symbols
                .map((symbol) => String(symbol))
                .join(
                  ', '
                )}, which this adapter does not read: Sequelize's Op has no equivalent here. Write { ${key}: { like: '%x%' } } with the operators ${Object.keys(
                OPERATORS
              ).join(', ')}`
            : `The condition on ${Model.modelName}.${key} is an empty object, which would match every row. Give it an operator (${Object.keys(
                OPERATORS
              ).join(', ')}) or a value`
        );
      }

      for (const name of Object.keys(value)) {
        const shorthand = name.replace(/^[$]/u, '');
        const operator = OPERATORS[shorthand];

        if (!operator) {
          throw coded(
            'HENRI_MODEL_INVALID_QUERY',
            `Unknown operator '${name}' on ${Model.modelName}.${key}; use ${Object.keys(
              OPERATORS
            ).join(', ')}`
          );
        }

        if (exact) {
          const settled = exactComparison(
            Model,
            key,
            exact,
            shorthand,
            value[name]
          );

          parts.push(
            operator(settled.column, settled.value, Model.adapter.dialect.name)
          );
          continue;
        }

        const { list, value: compared } = comparison(
          Model,
          key,
          value[name],
          shorthand
        );

        if (list && (shorthand === 'eq' || shorthand === 'in')) {
          parts.push(OPERATORS.in(column, list));
        } else if (list) {
          parts.push(OPERATORS.nin(column, list));
        } else {
          parts.push(operator(column, compared, Model.adapter.dialect.name));
        }
      }
    } else if (exact) {
      parts.push(eq(column, exactValue(Model, key, exact, value)));
    } else if (encrypted) {
      const { list, value: compared } = comparison(Model, key, value);

      parts.push(list ? OPERATORS.in(column, list) : eq(column, compared));
    } else {
      parts.push(eq(column, value));
    }
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.length === 1 ? parts[0] : and(...parts);
};

/**
 * Compiles an order into Drizzle order expressions
 *
 * Accepts `'name'`, `'-name'`, `'name desc'`, `{ name: 'desc' }`,
 * `['name', 'desc']`, a Drizzle expression, or a list of those.
 *
 * @param {function} Model The model
 * @param {*} order The order
 * @returns {Array<object>} Order expressions
 */
const compileOrder = (Model, order) => {
  if (order === null || typeof order === 'undefined') {
    return [];
  }

  if (is(order, SQL)) {
    return [order];
  }

  if (typeof order === 'string') {
    const [field, direction = 'asc'] = order.trim().split(/\s+/);

    if (field.startsWith('-')) {
      checkOrder(Model, field.slice(1));

      return [desc(ordered(Model, field.slice(1)))];
    }

    checkOrder(Model, field);

    return [
      direction.toLowerCase() === 'desc'
        ? desc(ordered(Model, field))
        : asc(ordered(Model, field)),
    ];
  }

  if (Array.isArray(order)) {
    if (
      order.length === 2 &&
      typeof order[0] === 'string' &&
      /^(asc|desc)$/i.test(String(order[1]))
    ) {
      return compileOrder(Model, `${order[0]} ${order[1]}`);
    }

    return order.flatMap((entry) => compileOrder(Model, entry));
  }

  if (isPlainObject(order)) {
    return Object.keys(order).map((field) => {
      checkOrder(Model, field);

      return String(order[field]).toLowerCase() === 'desc' ||
        Number(order[field]) === -1
        ? desc(ordered(Model, field))
        : asc(ordered(Model, field));
    });
  }

  throw new Error(
    `Invalid order ${JSON.stringify(order)} on ${Model.modelName}`
  );
};

/**
 * Turns include names (`'author'`, `'author.posts'`, `{ author: true }`)
 * into the `with` configuration of the relational query API, hiding the
 * hidden fields of the included models
 *
 * @param {function} Model The model
 * @param {Array} includes The includes
 * @returns {object} The `with` configuration
 */
const compileWith = (Model, includes) => {
  const result = {};

  /**
   * Adds one path
   *
   * @param {function} Owner The model owning the association
   * @param {object} target The `with` object being filled
   * @param {Array<string>} segments The path segments
   * @returns {void}
   */
  const add = (Owner, target, segments) => {
    const [name, ...rest] = segments;
    const association = Owner.associations.find((entry) => entry.as === name);

    if (!association) {
      throw new Error(
        `Unknown association '${name}' on ${Owner.modelName}; declare it with belongsTo(), hasMany() or hasOne()`
      );
    }

    const Target = Owner.adapter.models[association.target];
    const columns = Object.fromEntries(
      Target.hidden.map((field) => [field, false])
    );
    const entry =
      target[name] && typeof target[name] === 'object' ? target[name] : {};

    if (Object.keys(columns).length > 0) {
      entry.columns = columns;
    }

    if (rest.length > 0) {
      entry.with = entry.with || {};
      add(Target, entry.with, rest);
    }

    target[name] = Object.keys(entry).length > 0 ? entry : true;
  };

  for (const include of includes) {
    if (typeof include === 'string') {
      add(Model, result, include.split('.'));
    } else if (isPlainObject(include)) {
      for (const name of Object.keys(include)) {
        if (include[name]) {
          add(Model, result, [name]);
        }
      }
    }
  }

  return result;
};

/**
 * A positive integer, or a fallback
 *
 * @param {*} value Anything (a query string value, usually)
 * @param {number} fallback Used when the value is not a positive integer
 * @returns {number} The integer
 */
const toInt = (value, fallback) => {
  const number = parseInt(value, 10);

  return Number.isFinite(number) && number > 0 ? number : fallback;
};

/**
 * A lazy, chainable query on a model (Rails' relation): nothing runs until
 * it is awaited or a terminal method (`toArray`, `first`, `count`, ...) is
 * called
 *
 * @class Relation
 */
class Relation {
  /**
   * Creates an instance of Relation.
   *
   * @param {function} Model The model
   * @param {object} [state={}] The query state
   * @memberof Relation
   */
  constructor(Model, state = {}) {
    this.Model = Model;
    this.state = {
      conditions: [],
      deleted: 'without',
      hidden: false,
      includes: [],
      limit: null,
      offset: null,
      order: [],
      select: null,
      ...state,
    };
  }

  /**
   * A copy with some state changed
   *
   * @param {object} patch The changes
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  clone(patch) {
    return new Relation(this.Model, { ...this.state, ...patch });
  }

  /**
   * Adds a condition (see compileWhere)
   *
   * @param {*} condition The condition
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  where(condition) {
    if (condition === null || typeof condition === 'undefined') {
      return this;
    }

    return this.clone({ conditions: [...this.state.conditions, condition] });
  }

  /**
   * Adds an order (see compileOrder)
   *
   * @param {...*} order The order
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  order(...order) {
    return this.clone({ order: [...this.state.order, ...order] });
  }

  /**
   * Limits the rows
   *
   * @param {number} limit The maximum number of rows
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  limit(limit) {
    return this.clone({ limit });
  }

  /**
   * Skips rows
   *
   * @param {number} offset The number of rows to skip
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  offset(offset) {
    return this.clone({ offset });
  }

  /**
   * Eager loads associations (`include('author', 'comments.author')`)
   *
   * @param {...(string|object)} includes The associations
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  include(...includes) {
    return this.clone({
      includes: [...this.state.includes, ...includes.flat()],
    });
  }

  /**
   * Selects the hidden fields too (`select: false`, the user password)
   *
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  withHidden() {
    return this.clone({ hidden: true });
  }

  /**
   * Selects only some fields
   *
   * @param {...string} fields The fields
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  select(...fields) {
    return this.clone({ select: fields.flat() });
  }

  /**
   * Soft deleted rows too (`options: { paranoid: true }`)
   *
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  withDeleted() {
    return this.clone({ deleted: 'with' });
  }

  /**
   * Soft deleted rows only (`options: { paranoid: true }`)
   *
   * @returns {Relation} A new relation
   * @memberof Relation
   */
  onlyDeleted() {
    return this.clone({ deleted: 'only' });
  }

  /**
   * The compiled where expression
   *
   * @returns {?object} The SQL expression or undefined
   * @memberof Relation
   */
  whereSQL() {
    const parts = this.state.conditions
      .map((condition) => compileWhere(this.Model, condition))
      .filter((part) => typeof part !== 'undefined');
    const scope = this.deletedSQL();

    if (scope) {
      parts.push(scope);
    }

    if (parts.length === 0) {
      return undefined;
    }

    return parts.length === 1 ? parts[0] : and(...parts);
  }

  /**
   * The condition hiding (or keeping) the soft deleted rows
   *
   * @returns {?object} The SQL expression, or undefined
   * @memberof Relation
   */
  deletedSQL() {
    const { deleted } = this.state;

    if (!this.Model.paranoid || deleted === 'with') {
      return undefined;
    }

    const column = this.Model.column('deletedAt');

    return deleted === 'only' ? isNotNull(column) : isNull(column);
  }

  /**
   * The compiled order expressions
   *
   * @returns {Array<object>} Order expressions
   * @memberof Relation
   */
  orderSQL() {
    return this.state.order.flatMap((order) => compileOrder(this.Model, order));
  }

  /**
   * Runs the query
   *
   * @returns {Promise<Array<object>>} Model instances
   * @memberof Relation
   */
  async toArray() {
    const { Model } = this;
    const { hidden, includes, limit, offset, select } = this.state;
    const where = this.whereSQL();
    const orderBy = this.orderSQL();

    if (includes.length > 0) {
      const columns = {};

      if (select) {
        select.forEach((field) => (columns[field] = true));
      } else if (!hidden) {
        Model.hidden.forEach((field) => (columns[field] = false));
      }

      const config = { with: compileWith(Model, includes) };

      if (Object.keys(columns).length > 0) {
        config.columns = columns;
      }
      if (where) {
        config.where = where;
      }
      if (orderBy.length > 0) {
        config.orderBy = orderBy;
      }
      if (limit !== null) {
        config.limit = limit;
      }
      if (offset !== null) {
        config.offset = offset;
      }

      const rows = await Model.run(() =>
        Model.db().query[Model.key].findMany(config)
      );

      return rows.map((row) => Model.hydrate(row, { withHidden: hidden }));
    }

    const rows = await Model.run(() => {
      let query = Model.db()
        .select(Model.selection({ hidden, select }))
        .from(Model.table);

      if (where) {
        query = query.where(where);
      }
      if (orderBy.length > 0) {
        query = query.orderBy(...orderBy);
      }
      if (limit !== null) {
        query = query.limit(limit);
      }
      if (offset !== null) {
        query = query.offset(offset);
      }

      return query;
    });

    return rows.map((row) => Model.hydrate(row, { withHidden: hidden }));
  }

  /**
   * The first row (by id unless ordered)
   *
   * @returns {Promise<?object>} An instance or null
   * @memberof Relation
   */
  async first() {
    const relation = this.state.order.length > 0 ? this : this.order('id');
    const rows = await relation.limit(1).toArray();

    return rows[0] || null;
  }

  /**
   * The last row (by id unless ordered)
   *
   * @returns {Promise<?object>} An instance or null
   * @memberof Relation
   */
  async last() {
    const relation =
      this.state.order.length > 0
        ? this.clone({ order: this.state.order.map(reverseOrder) })
        : this.order('-id');
    const rows = await relation.limit(1).toArray();

    return rows[0] || null;
  }

  /**
   * Counts the rows
   *
   * @returns {Promise<number>} The count
   * @memberof Relation
   */
  async count() {
    const { Model } = this;
    const where = this.whereSQL();
    const rows = await Model.run(() => {
      let query = Model.db().select({ total: count() }).from(Model.table);

      if (where) {
        query = query.where(where);
      }

      return query;
    });

    return Number(rows[0] ? rows[0].total : 0);
  }

  /**
   * Is there at least one row?
   *
   * @returns {Promise<boolean>} true when a row matches
   * @memberof Relation
   */
  async exists() {
    const rows = await this.select('id').limit(1).toArray();

    return rows.length > 0;
  }

  /**
   * The values of one field
   *
   * @param {string} field The field
   * @returns {Promise<Array>} The values
   * @memberof Relation
   */
  async pluck(field) {
    const rows = await this.select(field).withHidden().toArray();

    return rows.map((row) => row[field]);
  }

  /**
   * Updates every matching row (validation and hooks run once, without an
   * instance)
   *
   * @param {object} attrs The attributes
   * @param {object} [options={}] Options (`unsafe` for the user roles)
   * @returns {Promise<number>} The number of rows updated
   * @memberof Relation
   */
  async update(attrs, options = {}) {
    return this.Model.updateWhere(this.whereSQL(), attrs, options);
  }

  /**
   * Deletes every matching row (no instance hooks). On a paranoid model
   * this stamps `deletedAt`; `{ force: true }` deletes the rows, soft
   * deleted ones included.
   *
   * @param {object} [options={}] `force: true` for a real delete
   * @returns {Promise<number>} The number of rows deleted
   * @memberof Relation
   */
  async destroy(options = {}) {
    const relation =
      options.force && this.state.deleted === 'without'
        ? this.withDeleted()
        : this;

    return this.Model.destroyWhere(relation.whereSQL(), options);
  }

  /**
   * Clears the `deletedAt` stamp of every matching row (paranoid models)
   *
   * @param {object} [options={}] `versions: false` to restore without a
   *   version on a model that keeps them
   * @returns {Promise<number>} The number of rows restored
   * @throws {Error} On a model without `options: { paranoid: true }`
   * @throws HENRI_VERSION_MASS_WRITE on a versioned model
   * @memberof Relation
   */
  async restore(options = {}) {
    if (!this.Model.paranoid) {
      throw new Error(
        `${this.Model.modelName}.restore() needs options: { paranoid: true }`
      );
    }

    // `setWhere` runs no hook, so a mass restore on a versioned model
    // would bring rows back with nothing said about it
    checkMassWrite(this.Model, 'restore', options);

    const relation =
      this.state.deleted === 'without' ? this.withDeleted() : this;

    return this.Model.setWhere(relation.whereSQL(), { deletedAt: null });
  }

  /**
   * One page of rows and the counters `res.collection()` wants
   *
   * @param {object} [options={}] `page` and `perPage`, as `req.pagination()`
   *   returns them
   * @returns {Promise<object>} `{ records, page, perPage, total, pages }`
   * @memberof Relation
   */
  async paginate({ page: wanted, perPage: size } = {}) {
    const page = toInt(wanted, 1);
    const perPage = toInt(size, 25);
    const [records, total] = await Promise.all([
      this.limit(perPage)
        .offset((page - 1) * perPage)
        .toArray(),
      this.count(),
    ]);

    return {
      page,
      pages: Math.max(1, Math.ceil(total / perPage)),
      perPage,
      records,
      total,
    };
  }

  /**
   * Awaiting a relation runs it
   *
   * @param {function} resolve Called with the rows
   * @param {function} reject Called with the error
   * @returns {Promise<*>} The chained promise
   * @memberof Relation
   */
  then(resolve, reject) {
    return this.toArray().then(resolve, reject);
  }

  /**
   * Promise compatibility
   *
   * @param {function} reject Called with the error
   * @returns {Promise<*>} The chained promise
   * @memberof Relation
   */
  catch(reject) {
    return this.toArray().catch(reject);
  }

  /**
   * Promise compatibility
   *
   * @param {function} done Called when settled
   * @returns {Promise<*>} The chained promise
   * @memberof Relation
   */
  finally(done) {
    return this.toArray().finally(done);
  }
}

/**
 * Reverses one order entry (for `last()`)
 *
 * @param {*} order An order entry (string, object or tuple)
 * @returns {*} The reversed entry
 * @throws {Error} For raw SQL orders, which cannot be reversed
 */
const reverseOrder = (order) => {
  if (typeof order === 'string') {
    const [field, direction = 'asc'] = order.trim().split(/\s+/);

    if (field.startsWith('-')) {
      return field.slice(1);
    }

    return direction.toLowerCase() === 'desc' ? field : `-${field}`;
  }

  if (Array.isArray(order)) {
    if (order.length === 2 && /^(asc|desc)$/i.test(String(order[1]))) {
      return [order[0], /^desc$/i.test(order[1]) ? 'asc' : 'desc'];
    }

    return order.map(reverseOrder);
  }

  if (isPlainObject(order)) {
    return Object.fromEntries(
      Object.keys(order).map((field) => [
        field,
        String(order[field]).toLowerCase() === 'desc' ||
        Number(order[field]) === -1
          ? 'asc'
          : 'desc',
      ])
    );
  }

  throw new Error('last() cannot reverse a raw SQL order; use first()');
};

module.exports = {
  OPERATORS,
  Relation,
  compileOrder,
  compileWhere,
  compileWith,
};
