/**
 * The table the versions are written to, and the two backends that reach
 * it.
 *
 * Versioning owns a table of its own, the way the access trail and the
 * queue own theirs: raw SQL through the store adapter's `query()`, or a
 * MongoDB collection, never a henri model. A model would put the history
 * of every model behind the application's own conventions -- hooks (which
 * is how the rows get written in the first place, so a model would version
 * its own versions), a policy, a soft delete, an `updatedAt` -- and it
 * would put `henri_versions` in the reference table, where `res.render()`
 * would start replacing foreign keys inside it.
 *
 * Four statements are issued against it. `INSERT` and `SELECT` are the
 * feature. `UPDATE` and `DELETE` are the erasure and the retention sweep,
 * and they are the reason this file is not a copy of `base/trail-store.js`:
 * the trail is a hash chain that must not be edited, and a version table
 * holds old values, so something has to be able to reach in and take them
 * away.
 *
 * Moments are BIGINT milliseconds since the epoch, for the reason the queue
 * gives: sqlite has no date type and the other four dialects disagree about
 * the precision and the time zone of a bare `TIMESTAMP`.
 *
 * Ordering is by `id`, which is a uuid version 7: 48 bits of milliseconds
 * and then a counter, so it sorts by the moment it was made without a
 * sequence column and without the unique index the trail needs. Two
 * versions of one record written in the same millisecond by two processes
 * still order deterministically, which is all a fold needs; they do not
 * need to agree on a single chain, which is what the trail needs and pays
 * for.
 *
 * @module base/version-store
 */

const debug = require('debug')('henri:versions');

const { fail } = require('./errors');

/** A table name henri is willing to interpolate into a statement */
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The columns of the version table, in insert order */
const COLUMNS = [
  'id',
  'at',
  'model',
  'record',
  'event',
  'changes',
  'snapshot',
  'actor',
  'source',
  'request_id',
  'meta',
  'erased_at',
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
    quote: (identifier) => `[${identifier}]`,
    text: 'NVARCHAR(MAX)',
  },
  mysql: {
    ifNotExists: 'IF NOT EXISTS',
    // MySQL has no CREATE INDEX IF NOT EXISTS: the indexes go in the
    // CREATE TABLE, which is guarded
    inlineIndexes: true,
    quote: (identifier) => `\`${identifier}\``,
    text: 'MEDIUMTEXT',
  },
  postgres: {
    ifNotExists: 'IF NOT EXISTS',
    inlineIndexes: false,
    quote: (identifier) => `"${identifier}"`,
    text: 'TEXT',
  },
  sqlite: {
    ifNotExists: 'IF NOT EXISTS',
    inlineIndexes: false,
    quote: (identifier) => `"${identifier}"`,
    text: 'TEXT',
  },
};

/**
 * The columns of the version table, in order
 *
 * @param {object} dialect a dialect description
 * @returns {Array<string>} the column definitions
 */
const columnsFor = (dialect) => [
  'id VARCHAR(36) NOT NULL',
  'at BIGINT NOT NULL',
  'model VARCHAR(120) NOT NULL',
  // The record's public identifier, never its primary key: a version table
  // full of primary keys would undo `base/references.js`
  'record VARCHAR(64) NOT NULL',
  'event VARCHAR(16) NOT NULL',
  `changes ${dialect.text} NULL`,
  `snapshot ${dialect.text} NULL`,
  'actor VARCHAR(64) NULL',
  'source VARCHAR(16) NOT NULL',
  'request_id VARCHAR(64) NULL',
  `meta ${dialect.text} NULL`,
  'erased_at BIGINT NULL',
  'PRIMARY KEY (id)',
];

/**
 * The indexes of the version table.
 *
 * The first is the one every read uses: the history of one record, in
 * order. The rest answer the three questions a version table is asked
 * from the outside -- what happened lately, what did this person change,
 * and what did this request change.
 *
 * @param {string} table the table name
 * @returns {Array<object>} `{ name, columns, unique }` entries
 */
const indexesFor = (table) => [
  {
    columns: ['model', 'record', 'id'],
    name: `${table}_record`,
    unique: false,
  },
  { columns: ['at'], name: `${table}_at`, unique: false },
  { columns: ['actor'], name: `${table}_actor`, unique: false },
  { columns: ['request_id'], name: `${table}_request`, unique: false },
];

/**
 * Every statement that creates the table and its indexes, in order
 *
 * @param {string} name the dialect (sqlite, postgres, mysql, mssql)
 * @param {string} table the table name
 * @returns {Array<string>} the statements, all of them idempotent
 * @throws HENRI_VERSION_UNSUPPORTED_STORE on a dialect henri cannot talk to
 * @throws HENRI_CONFIG_INVALID on a table name that is not an identifier
 */
const install = (name, table) => {
  const dialect = DIALECTS[name];

  if (!dialect) {
    throw fail(
      'HENRI_VERSION_UNSUPPORTED_STORE',
      `versions cannot be kept in a ${name} store`
    );
  }

  if (!SAFE_NAME.test(table)) {
    throw fail(
      'HENRI_CONFIG_INVALID',
      `versions.table: invalid table name "${table}": letters, digits and underscores only`
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
 * @class SqlVersions
 */
class SqlVersions {
  /**
   * Creates an instance of SqlVersions.
   *
   * @param {object} adapter a henri store adapter with `query()`
   * @param {object} options `dialect`, `dollars`, `table`
   * @memberof SqlVersions
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
   * @memberof SqlVersions
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
   * @memberof SqlVersions
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
   * @memberof SqlVersions
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
   * @memberof SqlVersions
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
   * @param {string} order the ordering
   * @param {number} limit how many rows
   * @param {number} [offset=0] how many to skip
   * @returns {string} the clause
   * @memberof SqlVersions
   */
  paging(order, limit, offset = 0) {
    if (this.dialect === 'mssql') {
      return ` ORDER BY ${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    }

    return ` ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
  }

  /**
   * Appends one row
   *
   * @param {object} row a row, in database shape
   * @returns {Promise<object>} the row
   * @memberof SqlVersions
   */
  async append(row) {
    const values = COLUMNS.map((column) =>
      typeof row[column] === 'undefined' ? null : row[column]
    );

    await this.run(
      `INSERT INTO ${this.table} (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(
        () => '?'
      ).join(', ')})`,
      values
    );

    return row;
  }

  /**
   * One row, by id
   *
   * @param {string} id the version id
   * @returns {Promise<?object>} the row, or null
   * @memberof SqlVersions
   */
  async get(id) {
    const [row] = await this.select(
      `SELECT * FROM ${this.table} WHERE id = ?`,
      [id]
    );

    return row || null;
  }

  /**
   * The rows matching a filter, newest first
   *
   * @param {object} [filter={}] `model`, `record`, `actor`, `event`,
   *   `requestId`, `since`, `until`, `limit`, `offset`
   * @returns {Promise<Array<object>>} the rows
   * @memberof SqlVersions
   */
  async list(filter = {}) {
    const { sql, params } = this.conditions(filter);
    const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 1000);
    const offset = Math.max(Number(filter.offset) || 0, 0);

    return this.select(
      `SELECT * FROM ${this.table}${sql}${this.paging('at DESC, id DESC', limit, offset)}`,
      params
    );
  }

  /**
   * How many rows match a filter
   *
   * @param {object} [filter={}] the filter
   * @returns {Promise<number>} the count
   * @memberof SqlVersions
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
   * Every version of one record newer than an id, newest first.
   *
   * This is what a fold walks: the id is a uuid version 7, so it orders by
   * the moment it was written and a string comparison is the ordering.
   *
   * @param {string} model the model name
   * @param {string} record the record's external id
   * @param {string} id the version to start after
   * @param {number} [limit=1000] how many at most
   * @returns {Promise<Array<object>>} the rows, newest first
   * @memberof SqlVersions
   */
  async newerThan(model, record, id, limit = 1000) {
    return this.select(
      `SELECT * FROM ${this.table} WHERE model = ? AND record = ? AND id >= ?${this.paging(
        'id DESC',
        limit
      )}`,
      [model, record, id]
    );
  }

  /**
   * The WHERE of a filter
   *
   * @param {object} filter the filter
   * @returns {{sql: string, params: Array}} the clause and its parameters
   * @memberof SqlVersions
   */
  conditions(filter) {
    const parts = [];
    const params = [];
    const equals = {
      actor: filter.actor,
      event: filter.event,
      model: filter.model,
      record: filter.record,
      request_id: filter.requestId,
      source: filter.source,
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
   * Takes the rows older than a moment away, one batch at a time
   *
   * @param {number} before a timestamp in milliseconds
   * @param {number} batch how many at most
   * @returns {Promise<number>} how many went
   * @memberof SqlVersions
   */
  async prune(before, batch) {
    const rows = await this.select(
      `SELECT id FROM ${this.table} WHERE at < ?${this.paging('at ASC, id ASC', batch)}`,
      [before]
    );

    if (rows.length === 0) {
      return 0;
    }

    await this.remove(rows.map((row) => row.id));

    return rows.length;
  }

  /**
   * Deletes rows by id
   *
   * @param {Array<string>} ids the version ids
   * @returns {Promise<number>} how many were named
   * @memberof SqlVersions
   */
  async remove(ids) {
    if (ids.length === 0) {
      return 0;
    }

    for (let index = 0; index < ids.length; index += 200) {
      const chunk = ids.slice(index, index + 200);

      await this.run(
        `DELETE FROM ${this.table} WHERE id IN (${chunk.map(() => '?').join(', ')})`,
        chunk
      );
    }

    return ids.length;
  }

  /**
   * Every version of the named records of one model
   *
   * @param {string} model the model name
   * @param {Array<string>} records the records' external ids
   * @returns {Promise<Array<object>>} the rows
   * @memberof SqlVersions
   */
  async forRecords(model, records) {
    const found = [];

    for (let index = 0; index < records.length; index += 200) {
      const chunk = records.slice(index, index + 200);

      found.push(
        ...(await this.select(
          `SELECT * FROM ${this.table} WHERE model = ? AND record IN (${chunk
            .map(() => '?')
            .join(', ')})`,
          [model, ...chunk]
        ))
      );
    }

    return found;
  }

  /**
   * Writes a row's values back, after an erasure emptied them
   *
   * @param {object} row `id`, `changes`, `snapshot`, `erased_at`
   * @returns {Promise<void>} resolves when written
   * @memberof SqlVersions
   */
  async rewrite(row) {
    await this.run(
      `UPDATE ${this.table} SET changes = ?, snapshot = ?, erased_at = ? WHERE id = ?`,
      [row.changes, row.snapshot, row.erased_at, row.id]
    );
  }

  /**
   * Forgets who an actor was, everywhere
   *
   * @param {string} actor the actor's external id
   * @returns {Promise<void>} resolves when written
   * @memberof SqlVersions
   */
  async forgetActor(actor) {
    await this.run(`UPDATE ${this.table} SET actor = NULL WHERE actor = ?`, [
      actor,
    ]);
  }
}

/**
 * The MongoDB backend. The documents carry the SQL column names, so both
 * backends hand the module the same rows.
 *
 * @class MongoVersions
 */
class MongoVersions {
  /**
   * Creates an instance of MongoVersions.
   *
   * @param {object} adapter a henri mongoose (or disk) adapter
   * @param {string} table the collection name
   * @memberof MongoVersions
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
   * @throws HENRI_VERSION_UNSUPPORTED_STORE when the store is not connected
   * @memberof MongoVersions
   */
  collection() {
    const connection =
      this.adapter.mongoose && this.adapter.mongoose.connection;

    if (!connection || connection.readyState !== 1 || !connection.db) {
      throw fail(
        'HENRI_VERSION_UNSUPPORTED_STORE',
        `a version cannot be written: the ${this.adapter.name} store is not connected`
      );
    }

    return connection.db.collection(this.table);
  }

  /**
   * Creates the indexes; idempotent
   *
   * @returns {Promise<Array<string>>} what was created
   * @memberof MongoVersions
   */
  async install() {
    const collection = this.collection();

    await collection.createIndex({ id: 1, model: 1, record: 1 });
    await collection.createIndex({ at: -1 });
    await collection.createIndex({ actor: 1 });
    await collection.createIndex({ request_id: 1 });

    return [`${this.table}.record`, `${this.table}.at`];
  }

  /**
   * Appends one row
   *
   * @param {object} row a row
   * @returns {Promise<object>} the row
   * @memberof MongoVersions
   */
  async append(row) {
    await this.collection().insertOne({ ...row, _id: row.id });

    return row;
  }

  /**
   * One row, by id
   *
   * @param {string} id the version id
   * @returns {Promise<?object>} the row, or null
   * @memberof MongoVersions
   */
  async get(id) {
    return (await this.collection().findOne({ _id: id })) || null;
  }

  /**
   * The filter of a listing
   *
   * @param {object} filter the filter
   * @returns {object} a MongoDB filter
   * @memberof MongoVersions
   */
  conditions(filter) {
    const query = {};
    const equals = {
      actor: filter.actor,
      event: filter.event,
      model: filter.model,
      record: filter.record,
      request_id: filter.requestId,
      source: filter.source,
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
   * @memberof MongoVersions
   */
  async list(filter = {}) {
    const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 1000);

    return this.collection()
      .find(this.conditions(filter), { sort: { at: -1, id: -1 } })
      .skip(Math.max(Number(filter.offset) || 0, 0))
      .limit(limit)
      .toArray();
  }

  /**
   * How many rows match a filter
   *
   * @param {object} [filter={}] the filter
   * @returns {Promise<number>} the count
   * @memberof MongoVersions
   */
  count(filter = {}) {
    return this.collection().countDocuments(this.conditions(filter));
  }

  /**
   * Every version of one record newer than an id, newest first
   *
   * @param {string} model the model name
   * @param {string} record the record's external id
   * @param {string} id the version to start at
   * @param {number} [limit=1000] how many at most
   * @returns {Promise<Array<object>>} the rows, newest first
   * @memberof MongoVersions
   */
  newerThan(model, record, id, limit = 1000) {
    return this.collection()
      .find({ id: { $gte: id }, model, record }, { sort: { id: -1 } })
      .limit(limit)
      .toArray();
  }

  /**
   * Takes the rows older than a moment away, one batch at a time
   *
   * @param {number} before a timestamp in milliseconds
   * @param {number} batch how many at most
   * @returns {Promise<number>} how many went
   * @memberof MongoVersions
   */
  async prune(before, batch) {
    const rows = await this.collection()
      .find({ at: { $lt: before } }, { sort: { at: 1, id: 1 } })
      .limit(batch)
      .toArray();

    if (rows.length === 0) {
      return 0;
    }

    await this.remove(rows.map((row) => row.id));

    return rows.length;
  }

  /**
   * Deletes rows by id
   *
   * @param {Array<string>} ids the version ids
   * @returns {Promise<number>} how many were named
   * @memberof MongoVersions
   */
  async remove(ids) {
    if (ids.length === 0) {
      return 0;
    }

    await this.collection().deleteMany({ _id: { $in: ids } });

    return ids.length;
  }

  /**
   * Every version of the named records of one model
   *
   * @param {string} model the model name
   * @param {Array<string>} records the records' external ids
   * @returns {Promise<Array<object>>} the rows
   * @memberof MongoVersions
   */
  forRecords(model, records) {
    return this.collection()
      .find({ model, record: { $in: records } })
      .toArray();
  }

  /**
   * Writes a row's values back, after an erasure emptied them
   *
   * @param {object} row `id`, `changes`, `snapshot`, `erased_at`
   * @returns {Promise<void>} resolves when written
   * @memberof MongoVersions
   */
  async rewrite(row) {
    await this.collection().updateOne(
      { _id: row.id },
      {
        $set: {
          changes: row.changes,
          erased_at: row.erased_at,
          snapshot: row.snapshot,
        },
      }
    );
  }

  /**
   * Forgets who an actor was, everywhere
   *
   * @param {string} actor the actor's external id
   * @returns {Promise<void>} resolves when written
   * @memberof MongoVersions
   */
  async forgetActor(actor) {
    await this.collection().updateMany({ actor }, { $set: { actor: null } });
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
 * @throws HENRI_VERSION_UNSUPPORTED_STORE when the adapter cannot hold them
 */
const storeFor = (adapter, table) => {
  if (!adapter) {
    throw fail(
      'HENRI_VERSION_UNSUPPORTED_STORE',
      'the versions have no store to be written to'
    );
  }

  if (adapter.mongoose) {
    return new MongoVersions(adapter, table);
  }

  const described = typeof adapter.query === 'function' && describe(adapter);

  if (!described || !DIALECTS[described.dialect]) {
    throw fail(
      'HENRI_VERSION_UNSUPPORTED_STORE',
      `versions cannot be kept in the ${adapter.adapterName || 'unknown'} store: it has neither query() nor a MongoDB connection henri can use`
    );
  }

  return new SqlVersions(adapter, { ...described, table });
};

module.exports = {
  COLUMNS,
  DIALECTS,
  MongoVersions,
  SqlVersions,
  describe,
  install,
  reasons,
  storeFor,
  toNumber,
};
