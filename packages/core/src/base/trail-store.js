/**
 * The table the access trail is written to, and the two backends that reach
 * it.
 *
 * The trail owns a table of its own, the way `@usehenri/jobs` owns
 * `henri_jobs`: raw SQL through the store adapter's `query()`, or a MongoDB
 * collection, never a henri model. A model would put the trail behind the
 * application's own conventions -- hooks, scopes, a policy, a soft delete,
 * an `updatedAt` that says a row changed -- and every one of those is
 * something an append-only record must not have.
 *
 * Only two statements are ever issued against it: `INSERT` and `SELECT`.
 * There is no `UPDATE` anywhere in this file, and the single `DELETE` is
 * `prune()`, which takes the oldest rows away once they are past
 * `config.trail.keep` and leaves a checkpoint behind so the chain still
 * verifies (see `base/trail.js`).
 *
 * Moments are BIGINT milliseconds since the epoch, for the reason the queue
 * gives: sqlite has no date type and the other four dialects disagree about
 * the precision and the time zone of a bare `TIMESTAMP`.
 *
 * @module base/trail-store
 */

const debug = require('debug')('henri:trail');

const { fail } = require('./errors');

/** A table name henri is willing to interpolate into a statement */
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The columns of the trail table, in insert order */
const COLUMNS = [
  'id',
  'seq',
  'at',
  'action',
  'outcome',
  'source',
  'model',
  'records',
  'fields',
  'ids',
  'actor',
  'actor_digest',
  'subject',
  'subject_digest',
  'request_id',
  'route',
  'meta',
  'prev',
  'hash',
];

/** What each dialect calls the things this table needs */
const DIALECTS = {
  mssql: {
    /**
     * Wraps a statement so it only runs when the index is missing
     *
     * @param {string} table the table name
     * @param {string} index the index name
     * @param {string} statement the CREATE INDEX statement
     * @returns {string} the guarded statement
     */
    guardIndex: (table, index, statement) =>
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${index}' AND object_id = OBJECT_ID('${table}')) ${statement}`,

    /**
     * Wraps a CREATE TABLE so it only runs when the table is missing
     *
     * @param {string} table the table name
     * @param {string} statement the CREATE TABLE statement
     * @returns {string} the guarded statement
     */
    guardTable: (table, statement) =>
      `IF OBJECT_ID('${table}', 'U') IS NULL ${statement}`,

    ifNotExists: '',
    inlineIndexes: false,
    int: 'INT',
    quote: (identifier) => `[${identifier}]`,
    text: 'NVARCHAR(MAX)',
  },
  mysql: {
    ifNotExists: 'IF NOT EXISTS',
    // MySQL has no CREATE INDEX IF NOT EXISTS: the indexes go in the
    // CREATE TABLE, which is guarded
    inlineIndexes: true,
    int: 'INT',
    quote: (identifier) => `\`${identifier}\``,
    text: 'MEDIUMTEXT',
  },
  postgres: {
    ifNotExists: 'IF NOT EXISTS',
    inlineIndexes: false,
    int: 'INTEGER',
    quote: (identifier) => `"${identifier}"`,
    text: 'TEXT',
  },
  sqlite: {
    ifNotExists: 'IF NOT EXISTS',
    inlineIndexes: false,
    int: 'INTEGER',
    quote: (identifier) => `"${identifier}"`,
    text: 'TEXT',
  },
};

/**
 * The columns of the trail table, in order
 *
 * @param {object} dialect a dialect description
 * @returns {Array<string>} the column definitions
 */
const columnsFor = (dialect) => [
  'id VARCHAR(36) NOT NULL',
  'seq BIGINT NOT NULL',
  'at BIGINT NOT NULL',
  'action VARCHAR(64) NOT NULL',
  'outcome VARCHAR(16) NOT NULL',
  'source VARCHAR(16) NOT NULL',
  'model VARCHAR(120) NULL',
  `records ${dialect.int} NOT NULL`,
  `fields ${dialect.text} NULL`,
  `ids ${dialect.text} NULL`,
  'actor VARCHAR(64) NULL',
  'actor_digest VARCHAR(64) NULL',
  'subject VARCHAR(64) NULL',
  'subject_digest VARCHAR(64) NULL',
  'request_id VARCHAR(64) NULL',
  'route VARCHAR(190) NULL',
  `meta ${dialect.text} NULL`,
  'prev VARCHAR(64) NULL',
  'hash VARCHAR(64) NOT NULL',
  'PRIMARY KEY (id)',
];

/**
 * The indexes of the trail table.
 *
 * `seq` is unique, and that is not decoration: it is what makes two
 * processes appending at the same moment resolve into one order instead of
 * two forks of the chain (see `base/trail.js`).
 *
 * @param {string} table the table name
 * @returns {Array<object>} `{ name, columns, unique }` entries
 */
const indexesFor = (table) => [
  { columns: ['seq'], name: `${table}_seq`, unique: true },
  { columns: ['at'], name: `${table}_at`, unique: false },
  { columns: ['subject_digest'], name: `${table}_subject`, unique: false },
  { columns: ['action', 'model'], name: `${table}_action`, unique: false },
];

/**
 * Every statement that creates the table and its indexes, in order
 *
 * @param {string} name the dialect (sqlite, postgres, mysql, mssql)
 * @param {string} table the table name
 * @returns {Array<string>} the statements, all of them idempotent
 * @throws HENRI_TRAIL_UNSUPPORTED_STORE on a dialect henri cannot talk to
 * @throws HENRI_CONFIG_INVALID on a table name that is not an identifier
 */
const install = (name, table) => {
  const dialect = DIALECTS[name];

  if (!dialect) {
    throw fail(
      'HENRI_TRAIL_UNSUPPORTED_STORE',
      `the access trail cannot be kept in a ${name} store`
    );
  }

  if (!SAFE_NAME.test(table)) {
    throw fail(
      'HENRI_CONFIG_INVALID',
      `trail.table: invalid table name "${table}": letters, digits and underscores only`
    );
  }

  const quoted = dialect.quote(table);
  const definitions = [...columnsFor(dialect)];
  const indexes = indexesFor(table);
  const statements = [];

  if (dialect.inlineIndexes) {
    for (const index of indexes) {
      definitions.push(
        `${index.unique ? 'UNIQUE KEY' : 'KEY'} ${dialect.quote(index.name)} (${index.columns.join(', ')})`
      );
    }
  }

  const create = [
    'CREATE TABLE',
    dialect.ifNotExists,
    `${quoted} (\n  ${definitions.join(',\n  ')}\n)`,
  ]
    .filter(Boolean)
    .join(' ');

  statements.push(
    dialect.guardTable ? dialect.guardTable(table, create) : create
  );

  if (dialect.inlineIndexes) {
    return statements;
  }

  for (const index of indexes) {
    const statement = [
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX`,
      dialect.guardIndex ? '' : dialect.ifNotExists,
      `${dialect.quote(index.name)} ON ${quoted} (${index.columns.join(', ')})`,
    ]
      .filter(Boolean)
      .join(' ');

    statements.push(
      dialect.guardIndex
        ? dialect.guardIndex(table, index.name, statement)
        : statement
    );
  }

  return statements;
};

/** Errors that mean the object was created by another process first */
const ALREADY_THERE =
  /already exists|duplicate key|duplicate table|there is already an object named/iu;

/** Errors that mean a unique index refused the row */
const DUPLICATE =
  /unique|duplicate|Validation error|SQLITE_CONSTRAINT|ER_DUP_ENTRY|23505|E11000/iu;

/**
 * Everything an error says about itself, wrappers included
 *
 * @param {*} error an error
 * @param {number} [depth=4] how far to unwrap
 * @returns {string} the messages, joined
 */
const reasons = (error, depth = 4) => {
  const said = [];
  let current = error;

  for (let step = 0; step < depth && current; step += 1) {
    said.push(String(current.message || ''), String(current.code || ''));
    current = current.parent || current.original || current.cause;
  }

  return said.join(' ');
};

/**
 * A number read back from any driver (pg hands BIGINT over as a string)
 *
 * @param {*} value the stored value
 * @returns {?number} the number, or null
 */
const toNumber = (value) => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isNaN(number) ? null : number;
};

/**
 * The SQL backend
 *
 * @class SqlTrail
 */
class SqlTrail {
  /**
   * Creates an instance of SqlTrail.
   *
   * @param {object} adapter a henri store adapter with `query()`
   * @param {object} options `dialect`, `dollars`, `table`
   * @memberof SqlTrail
   */
  constructor(adapter, { dialect, dollars = false, table }) {
    this.adapter = adapter;
    this.dialect = dialect;
    this.dollars = dollars;
    this.table = table;
    this.kind = 'sql';
  }

  /**
   * The statement with the placeholders this driver expects
   *
   * @param {string} sql a statement written with `?`
   * @returns {string} the statement
   * @memberof SqlTrail
   */
  prepare(sql) {
    if (!this.dollars) {
      return sql;
    }

    let index = 0;

    return sql.replace(/\?/gu, () => {
      index += 1;

      return `$${index}`;
    });
  }

  /**
   * Runs a statement that returns no rows
   *
   * @param {string} sql the statement
   * @param {Array} [params=[]] the parameters
   * @returns {Promise<void>} resolves when done
   * @memberof SqlTrail
   */
  async run(sql, params = []) {
    debug('run %s', sql);

    await this.adapter.query(this.prepare(sql), params);
  }

  /**
   * Runs a query and answers with its rows
   *
   * @param {string} sql the query
   * @param {Array} [params=[]] the parameters
   * @returns {Promise<Array<object>>} the rows
   * @memberof SqlTrail
   */
  async select(sql, params = []) {
    const rows = await this.adapter.query(this.prepare(sql), params, {
      type: 'SELECT',
    });

    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Creates the table and its indexes; idempotent
   *
   * @returns {Promise<Array<string>>} the statements that ran
   * @memberof SqlTrail
   */
  async install() {
    const statements = install(this.dialect, this.table);

    for (const statement of statements) {
      try {
        await this.run(statement);
      } catch (error) {
        if (!ALREADY_THERE.test(reasons(error))) {
          throw error;
        }

        debug('another process created it first: %s', error.message);
      }
    }

    return statements;
  }

  /**
   * The tail of a query: an order, then a window.
   *
   * MSSQL has no `LIMIT`; `OFFSET ... FETCH NEXT` is the one spelling
   * every dialect here understands, and it needs the `ORDER BY` that is
   * already there.
   *
   * @param {string} order the ordering (`seq DESC`)
   * @param {number} limit how many rows
   * @param {number} [offset=0] how many to skip
   * @returns {string} the clause
   * @memberof SqlTrail
   */
  paging(order, limit, offset = 0) {
    if (this.dialect === 'mssql') {
      return ` ORDER BY ${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    }

    return ` ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
  }

  /**
   * The last row written, which the next one chains onto
   *
   * @returns {Promise<?object>} the row, or null on an empty trail
   * @memberof SqlTrail
   */
  async last() {
    const [row] = await this.select(
      `SELECT * FROM ${this.table}${this.paging('seq DESC', 1)}`
    );

    return row || null;
  }

  /**
   * Appends one row
   *
   * @param {object} row a row, in database shape
   * @returns {Promise<boolean>} false when `seq` was taken, so the caller
   *   reads the head again and chains onto whatever won
   * @memberof SqlTrail
   */
  async append(row) {
    const values = COLUMNS.map((column) =>
      typeof row[column] === 'undefined' ? null : row[column]
    );

    try {
      await this.run(
        `INSERT INTO ${this.table} (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(
          () => '?'
        ).join(', ')})`,
        values
      );
    } catch (error) {
      if (DUPLICATE.test(reasons(error))) {
        return false;
      }

      throw error;
    }

    return true;
  }

  /**
   * The rows matching a filter, newest first
   *
   * @param {object} [filter={}] `action`, `model`, `subject`, `actor`,
   *   `since`, `until`, `limit`, `offset`
   * @returns {Promise<Array<object>>} the rows
   * @memberof SqlTrail
   */
  async list(filter = {}) {
    const { sql, params } = this.conditions(filter);
    const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 1000);
    const offset = Math.max(Number(filter.offset) || 0, 0);

    return this.select(
      `SELECT * FROM ${this.table}${sql}${this.paging('seq DESC', limit, offset)}`,
      params
    );
  }

  /**
   * How many rows match a filter
   *
   * @param {object} [filter={}] the filter
   * @returns {Promise<number>} the count
   * @memberof SqlTrail
   */
  async count(filter = {}) {
    const { sql, params } = this.conditions(filter);
    const [row] = await this.select(
      `SELECT COUNT(*) AS total FROM ${this.table}${sql}`,
      params
    );

    return toNumber(row && (row.total || row.TOTAL)) || 0;
  }

  /**
   * Every row in the order it was written, for the verification
   *
   * @param {number} after the sequence number to start after
   * @param {number} limit how many
   * @returns {Promise<Array<object>>} the rows
   * @memberof SqlTrail
   */
  async since(after, limit) {
    return this.select(
      `SELECT * FROM ${this.table} WHERE seq > ?${this.paging('seq ASC', limit)}`,
      [after]
    );
  }

  /**
   * The WHERE of a filter
   *
   * @param {object} filter the filter
   * @returns {{sql: string, params: Array}} the clause and its parameters
   * @memberof SqlTrail
   */
  conditions(filter) {
    const parts = [];
    const params = [];
    const equals = {
      action: filter.action,
      actor: filter.actor,
      model: filter.model,
      outcome: filter.outcome,
      subject: filter.subject,
      subject_digest: filter.digest,
    };

    for (const column of Object.keys(equals).sort()) {
      if (typeof equals[column] === 'string' && equals[column] !== '') {
        parts.push(`${column} = ?`);
        params.push(equals[column]);
      }
    }

    if (Number.isFinite(filter.since)) {
      parts.push('at >= ?');
      params.push(filter.since);
    }

    if (Number.isFinite(filter.until)) {
      parts.push('at <= ?');
      params.push(filter.until);
    }

    return {
      params,
      sql: parts.length > 0 ? ` WHERE ${parts.join(' AND ')}` : '',
    };
  }

  /**
   * Takes the oldest rows away.
   *
   * A prefix of the chain, never a set of rows matching an age: the entries
   * up to and including the newest one past `before` go, so what remains is
   * still contiguous. Deleting by age alone would leave a hole in the
   * middle of the sequence the moment two entries were written out of
   * order, and a hole is a break nothing can explain away.
   *
   * @param {number} before a timestamp in milliseconds
   * @returns {Promise<{removed: number, last: ?object}>} how many went, and
   *   the last of them, which the checkpoint carries
   * @memberof SqlTrail
   */
  async prune(before) {
    const [last] = await this.select(
      `SELECT * FROM ${this.table} WHERE at < ?${this.paging('seq DESC', 1)}`,
      [before]
    );

    if (!last) {
      return { last: null, removed: 0 };
    }

    const seq = Number(last.seq);
    const [counted] = await this.select(
      `SELECT COUNT(*) AS total FROM ${this.table} WHERE seq <= ?`,
      [seq]
    );

    await this.run(`DELETE FROM ${this.table} WHERE seq <= ?`, [seq]);

    return {
      last,
      removed: toNumber(counted && (counted.total || counted.TOTAL)) || 0,
    };
  }
}

/**
 * The MongoDB backend. The documents carry the SQL column names, so both
 * backends hand the trail the same rows.
 *
 * @class MongoTrail
 */
class MongoTrail {
  /**
   * Creates an instance of MongoTrail.
   *
   * @param {object} adapter a henri mongoose (or disk) adapter
   * @param {string} table the collection name
   * @memberof MongoTrail
   */
  constructor(adapter, table) {
    this.adapter = adapter;
    this.dialect = 'mongodb';
    this.table = table;
    this.kind = 'mongo';
  }

  /**
   * The collection
   *
   * @returns {object} a MongoDB collection
   * @throws HENRI_TRAIL_UNSUPPORTED_STORE when the store is not connected
   * @memberof MongoTrail
   */
  collection() {
    const connection =
      this.adapter.mongoose && this.adapter.mongoose.connection;

    if (!connection || connection.readyState !== 1 || !connection.db) {
      throw fail(
        'HENRI_TRAIL_UNSUPPORTED_STORE',
        `the access trail cannot be written: the ${this.adapter.name} store is not connected`
      );
    }

    return connection.db.collection(this.table);
  }

  /**
   * Creates the indexes; idempotent
   *
   * @returns {Promise<Array<string>>} what was created
   * @memberof MongoTrail
   */
  async install() {
    const collection = this.collection();

    await collection.createIndex({ seq: 1 }, { unique: true });
    await collection.createIndex({ at: -1 });
    await collection.createIndex({ subject_digest: 1 });

    return [`${this.table}.seq`, `${this.table}.at`];
  }

  /**
   * The last row written
   *
   * @returns {Promise<?object>} the row, or null
   * @memberof MongoTrail
   */
  async last() {
    const [row] = await this.collection()
      .find({}, { sort: { seq: -1 } })
      .limit(1)
      .toArray();

    return row || null;
  }

  /**
   * Appends one row
   *
   * @param {object} row a row
   * @returns {Promise<boolean>} false when `seq` was taken
   * @memberof MongoTrail
   */
  async append(row) {
    try {
      await this.collection().insertOne({ ...row, _id: row.id });
    } catch (error) {
      if (DUPLICATE.test(reasons(error))) {
        return false;
      }

      throw error;
    }

    return true;
  }

  /**
   * The filter of a listing
   *
   * @param {object} filter the filter
   * @returns {object} a MongoDB filter
   * @memberof MongoTrail
   */
  conditions(filter) {
    const query = {};
    const equals = {
      action: filter.action,
      actor: filter.actor,
      model: filter.model,
      outcome: filter.outcome,
      subject: filter.subject,
      subject_digest: filter.digest,
    };

    for (const key of Object.keys(equals).sort()) {
      if (typeof equals[key] === 'string' && equals[key] !== '') {
        query[key] = equals[key];
      }
    }

    if (Number.isFinite(filter.since) || Number.isFinite(filter.until)) {
      query.at = {};

      if (Number.isFinite(filter.since)) {
        query.at.$gte = filter.since;
      }

      if (Number.isFinite(filter.until)) {
        query.at.$lte = filter.until;
      }
    }

    return query;
  }

  /**
   * The rows matching a filter, newest first
   *
   * @param {object} [filter={}] the filter
   * @returns {Promise<Array<object>>} the rows
   * @memberof MongoTrail
   */
  async list(filter = {}) {
    const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 1000);

    return this.collection()
      .find(this.conditions(filter), { sort: { seq: -1 } })
      .skip(Math.max(Number(filter.offset) || 0, 0))
      .limit(limit)
      .toArray();
  }

  /**
   * How many rows match a filter
   *
   * @param {object} [filter={}] the filter
   * @returns {Promise<number>} the count
   * @memberof MongoTrail
   */
  count(filter = {}) {
    return this.collection().countDocuments(this.conditions(filter));
  }

  /**
   * Every row in the order it was written, for the verification
   *
   * @param {number} after the sequence number to start after
   * @param {number} limit how many
   * @returns {Promise<Array<object>>} the rows
   * @memberof MongoTrail
   */
  since(after, limit) {
    return this.collection()
      .find({ seq: { $gt: after } }, { sort: { seq: 1 } })
      .limit(limit)
      .toArray();
  }

  /**
   * Takes the oldest rows away: a prefix of the chain, for the reason
   * `SqlTrail#prune` gives
   *
   * @param {number} before a timestamp in milliseconds
   * @returns {Promise<{removed: number, last: ?object}>} what went
   * @memberof MongoTrail
   */
  async prune(before) {
    const [last] = await this.collection()
      .find({ at: { $lt: before } }, { sort: { seq: -1 } })
      .limit(1)
      .toArray();

    if (!last) {
      return { last: null, removed: 0 };
    }

    const result = await this.collection().deleteMany({
      seq: { $lte: Number(last.seq) },
    });

    return { last, removed: (result && result.deletedCount) || 0 };
  }
}

/**
 * The dialect of a store adapter, or nothing when it is not SQL
 *
 * @param {object} adapter a henri store adapter
 * @returns {?{dialect: string, dollars: boolean}} how to talk to it
 */
const describe = (adapter) => {
  if (adapter.dialect && typeof adapter.dialect === 'object') {
    return {
      dialect: adapter.dialect.name,
      dollars: adapter.dialect.placeholder(1) === '$1',
    };
  }

  if (typeof adapter.ensureConnector === 'function') {
    return { dialect: adapter.ensureConnector().getDialect(), dollars: false };
  }

  return null;
};

/**
 * The backend of a store adapter
 *
 * @param {object} adapter a henri store adapter
 * @param {string} table the table (or collection) name
 * @returns {object} the backend
 * @throws HENRI_TRAIL_UNSUPPORTED_STORE when the adapter cannot hold a trail
 */
const storeFor = (adapter, table) => {
  if (!adapter) {
    throw fail(
      'HENRI_TRAIL_UNSUPPORTED_STORE',
      'the access trail has no store to be written to'
    );
  }

  if (adapter.mongoose) {
    return new MongoTrail(adapter, table);
  }

  const described = typeof adapter.query === 'function' && describe(adapter);

  if (!described || !DIALECTS[described.dialect]) {
    throw fail(
      'HENRI_TRAIL_UNSUPPORTED_STORE',
      `the access trail cannot be kept in the ${adapter.adapterName || 'unknown'} store: it has neither query() nor a MongoDB connection henri can use`
    );
  }

  return new SqlTrail(adapter, { ...described, table });
};

module.exports = {
  COLUMNS,
  DIALECTS,
  MongoTrail,
  SqlTrail,
  describe,
  install,
  reasons,
  storeFor,
  toNumber,
};
