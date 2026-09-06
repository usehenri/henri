/**
 * The table the call log is written to, and the two backends that reach it.
 *
 * A table henri owns, the way the trail and the queue own theirs: raw SQL
 * through the store adapter's `query()`, or a MongoDB collection, never a
 * henri model. `base/trail-store.js` gives the reasons and they all hold
 * here, plus one of this table's own -- a model would be swept by the
 * retention rules an application wrote for its *own* records, and this one
 * has a retention of its own that has to work at a volume no model reaches.
 *
 * Both directions of a call live in one table, discriminated by
 * `direction`. `base/calls.js` argues that; the consequence here is that
 * the join a call log exists for is one `SELECT` on one index.
 *
 * ## Partitions, where the dialect has them
 *
 * A sweep that deletes rows is fine at a thousand rows a day and hopeless
 * at ten million: the deletes are logged, the indexes are rewritten, the
 * table bloats and the sweep runs longer than the interval between sweeps.
 * PostgreSQL and MySQL both range-partition, and dropping a partition is a
 * metadata operation whatever it held. So `calls.partition` (`'day'` or
 * `'month'`) creates the table partitioned by `at`, keeps
 * `calls.partitionsAhead` periods ready in front of the clock, and the
 * sweep drops whole periods.
 *
 * Two details that are decisions rather than mechanics:
 *
 * - **there is always a catch-all** -- a `DEFAULT` partition on PostgreSQL,
 *   a `VALUES LESS THAN MAXVALUE` partition on MySQL. Without one, a row
 *   whose `at` fell outside every declared range is *refused*, which turns
 *   a partition henri forgot to create into failed inserts. The cost is
 *   that a `CREATE TABLE ... PARTITION OF` has to check the default for
 *   conflicting rows, which is fast while the default is empty and is the
 *   normal case;
 * - **the bounds are UTC and they are in the name.** A partition is called
 *   `<table>_p20260906` (PostgreSQL) or `p20260906` (MySQL), so the sweep
 *   works out what a partition covers from its name instead of parsing a
 *   bound expression in two dialects' spellings.
 *
 * sqlite, SQL Server and MongoDB have no range partitioning, so they get
 * the delete path: a bounded loop, `calls.sweep` rows at a time, selecting
 * the doomed rows and then deleting them by id. `calls.partition` on one of
 * those fails the boot (`HENRI_CALLS_PARTITION_UNSUPPORTED`) rather than
 * being quietly ignored.
 *
 * Moments are BIGINT milliseconds since the epoch, for the reason the queue
 * and the trail both give.
 *
 * @module base/call-store
 */

const debug = require('debug')('henri:calls');

const { fail } = require('./errors');
const { DIALECTS, reasons, toNumber } = require('./trail-store');

/** A table name henri is willing to interpolate into a statement */
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The columns of the call table, in insert order */
const COLUMNS = [
  'id',
  'at',
  'direction',
  'request_id',
  'service',
  'method',
  'url',
  'route',
  'status',
  'duration',
  'actor',
  'outcome',
  'error',
  'request_headers',
  'request_body',
  'response_headers',
  'response_body',
  'truncated',
  'meta',
];

/** A day, in milliseconds */
const DAY = 86400000;

/**
 * The column definitions of the table.
 *
 * The primary key is `(at, id)` in every dialect, partitioned or not: both
 * PostgreSQL and MySQL require the partitioning column in every unique key,
 * and clustering a log by time is what you would have chosen anyway.
 *
 * @param {object} dialect a dialect description from `trail-store.js`
 * @returns {Array<string>} the column definitions
 */
const columnsFor = (dialect) => [
  'id VARCHAR(36) NOT NULL',
  'at BIGINT NOT NULL',
  'direction VARCHAR(3) NOT NULL',
  'request_id VARCHAR(64) NULL',
  'service VARCHAR(120) NULL',
  'method VARCHAR(12) NOT NULL',
  `url ${dialect.text} NULL`,
  'route VARCHAR(190) NULL',
  `status ${dialect.int} NULL`,
  `duration ${dialect.int} NULL`,
  'actor VARCHAR(64) NULL',
  'outcome VARCHAR(16) NOT NULL',
  'error VARCHAR(190) NULL',
  `request_headers ${dialect.text} NULL`,
  `request_body ${dialect.text} NULL`,
  `response_headers ${dialect.text} NULL`,
  `response_body ${dialect.text} NULL`,
  'truncated VARCHAR(32) NULL',
  `meta ${dialect.text} NULL`,
  'PRIMARY KEY (at, id)',
];

/**
 * The indexes of the call table.
 *
 * `request_id` is the one that matters: it is the join the whole feature
 * exists for. The other two are the listings a person actually asks for --
 * the recent calls, and the recent calls of one service.
 *
 * @param {string} table the table name
 * @returns {Array<object>} `{ name, columns }` entries
 */
const indexesFor = (table) => [
  { columns: ['request_id'], name: `${table}_request` },
  { columns: ['at'], name: `${table}_at` },
  { columns: ['direction', 'service', 'at'], name: `${table}_service` },
];

/**
 * The start of the period a moment falls in, in UTC
 *
 * @param {number} moment epoch milliseconds
 * @param {string} every `day` or `month`
 * @returns {number} the start of the period
 */
const startOf = (moment, every) => {
  const when = new Date(moment);

  if (every === 'month') {
    return Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1);
  }

  return Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
};

/**
 * The start of the period after this one
 *
 * @param {number} start the start of a period
 * @param {string} every `day` or `month`
 * @returns {number} the next start
 */
const nextOf = (start, every) => {
  if (every === 'month') {
    const when = new Date(start);

    return Date.UTC(when.getUTCFullYear(), when.getUTCMonth() + 1, 1);
  }

  return start + DAY;
};

/**
 * The `yyyymmdd` a partition is named after
 *
 * @param {number} start the start of the period
 * @returns {string} the stamp
 */
const stampOf = (start) =>
  new Date(start).toISOString().slice(0, 10).replace(/-/gu, '');

/**
 * The name of one partition
 *
 * @param {string} dialect the dialect
 * @param {string} table the table
 * @param {number} start the start of the period
 * @returns {string} the partition name
 */
const partitionName = (dialect, table, start) =>
  dialect === 'mysql' ? `p${stampOf(start)}` : `${table}_p${stampOf(start)}`;

/** The catch-all partition: nothing henri writes is ever refused */
const catchAll = (dialect, table) =>
  dialect === 'mysql' ? 'pmax' : `${table}_pdefault`;

/**
 * The period a partition covers, read back from its name
 *
 * @param {string} name the partition name
 * @param {string} every `day` or `month`
 * @returns {?{from: number, to: number}} the bounds, or null for the
 *   catch-all and anything else that is not one of ours
 */
const boundsOf = (name, every) => {
  const found = /p(\d{4})(\d{2})(\d{2})$/u.exec(String(name));

  if (!found) {
    return null;
  }

  const from = Date.UTC(
    Number(found[1]),
    Number(found[2]) - 1,
    Number(found[3])
  );

  return { from, to: nextOf(from, every) };
};

/**
 * The periods a table should have partitions for
 *
 * @param {number} now the moment
 * @param {object} options `every` and `ahead`
 * @returns {Array<number>} the starts, oldest first
 */
const planOf = (now, { ahead, every }) => {
  const starts = [];
  let start = startOf(now, every);

  for (let step = 0; step <= ahead; step += 1) {
    starts.push(start);
    start = nextOf(start, every);
  }

  return starts;
};

/**
 * Every statement that creates the table and its indexes, in order
 *
 * @param {string} name the dialect (sqlite, postgres, mysql, mssql)
 * @param {string} table the table name
 * @param {object} [options={}] `partition`, `ahead`, `now`
 * @returns {Array<string>} the statements, all of them idempotent
 * @throws HENRI_CALLS_UNSUPPORTED_STORE on a dialect henri cannot talk to
 * @throws HENRI_CONFIG_INVALID on a table name that is not an identifier
 */
const install = (name, table, options = {}) => {
  const dialect = DIALECTS[name];

  if (!dialect) {
    throw fail(
      'HENRI_CALLS_UNSUPPORTED_STORE',
      `the call log cannot be kept in a ${name} store`
    );
  }

  if (!SAFE_NAME.test(table)) {
    throw fail(
      'HENRI_CONFIG_INVALID',
      `calls.table: invalid table name "${table}": letters, digits and underscores only`
    );
  }

  const { ahead = 7, now = Date.now(), partition = false } = options;
  const quoted = dialect.quote(table);
  const definitions = [...columnsFor(dialect)];
  const indexes = indexesFor(table);
  const statements = [];

  if (dialect.inlineIndexes) {
    for (const index of indexes) {
      definitions.push(
        `KEY ${dialect.quote(index.name)} (${index.columns.join(', ')})`
      );
    }
  }

  const create = [
    'CREATE TABLE',
    dialect.ifNotExists,
    `${quoted} (\n  ${definitions.join(',\n  ')}\n)`,
    partition
      ? partitionClause(name, table, { ahead, every: partition, now })
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  statements.push(
    dialect.guardTable ? dialect.guardTable(table, create) : create
  );

  if (!dialect.inlineIndexes) {
    for (const index of indexes) {
      const statement = [
        'CREATE INDEX',
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
  }

  if (partition && name === 'postgres') {
    statements.push(
      ...planOf(now, { ahead, every: partition }).map((start) =>
        createPartition(name, table, start, partition)
      ),
      `CREATE TABLE IF NOT EXISTS "${catchAll(name, table)}" PARTITION OF ${quoted} DEFAULT`
    );
  }

  return statements;
};

/**
 * The `PARTITION BY` tail of a `CREATE TABLE`
 *
 * PostgreSQL declares the scheme and the partitions separately; MySQL puts
 * the whole list inside the `CREATE TABLE`, which is why the two do not
 * share a code path here.
 *
 * @param {string} name the dialect
 * @param {string} table the table
 * @param {object} options `every`, `ahead`, `now`
 * @returns {string} the clause
 */
const partitionClause = (name, table, { ahead, every, now }) => {
  if (name === 'postgres') {
    return 'PARTITION BY RANGE (at)';
  }

  if (name !== 'mysql') {
    return '';
  }

  const parts = planOf(now, { ahead, every }).map(
    (start) =>
      `PARTITION ${partitionName(name, table, start)} VALUES LESS THAN (${nextOf(start, every)})`
  );

  return `PARTITION BY RANGE (at) (\n  ${parts.join(',\n  ')},\n  PARTITION ${catchAll(name, table)} VALUES LESS THAN MAXVALUE\n)`;
};

/**
 * The statement that adds one partition
 *
 * @param {string} name the dialect
 * @param {string} table the table
 * @param {number} start the start of the period
 * @param {string} every `day` or `month`
 * @returns {string} the statement
 */
const createPartition = (name, table, start, every) => {
  const partition = partitionName(name, table, start);
  const to = nextOf(start, every);

  if (name === 'postgres') {
    return `CREATE TABLE IF NOT EXISTS "${partition}" PARTITION OF "${table}" FOR VALUES FROM (${start}) TO (${to})`;
  }

  // MySQL grows the table by splitting the catch-all, which is empty while
  // henri keeps ahead of the clock and is therefore a cheap rebuild
  return `ALTER TABLE \`${table}\` REORGANIZE PARTITION ${catchAll(name, table)} INTO (PARTITION ${partition} VALUES LESS THAN (${to}), PARTITION ${catchAll(name, table)} VALUES LESS THAN MAXVALUE)`;
};

/**
 * The statement that takes one partition away
 *
 * @param {string} name the dialect
 * @param {string} table the table
 * @param {string} partition the partition name
 * @returns {string} the statement
 */
const dropPartition = (name, table, partition) =>
  name === 'postgres'
    ? `DROP TABLE IF EXISTS "${partition}"`
    : `ALTER TABLE \`${table}\` DROP PARTITION ${partition}`;

/**
 * The query that lists the partitions of a table
 *
 * @param {string} name the dialect
 * @returns {?{sql: string, params: Array}} the query, or null
 */
const listPartitions = (name) => {
  if (name === 'postgres') {
    return {
      params: [],
      sql: 'SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = ?',
    };
  }

  if (name === 'mysql') {
    return {
      params: [],
      sql: 'SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL',
    };
  }

  return null;
};

/** Errors that mean the object was created by another process first */
const ALREADY_THERE =
  /already exists|duplicate key|duplicate table|there is already an object named|Duplicate partition name/iu;

/**
 * The SQL backend
 *
 * @class SqlCalls
 */
class SqlCalls {
  /**
   * Creates an instance of SqlCalls.
   *
   * @param {object} adapter a henri store adapter with `query()`
   * @param {object} options `dialect`, `dollars`, `table`, `partition`,
   *   `ahead`
   * @memberof SqlCalls
   */
  constructor(
    adapter,
    { ahead = 7, dialect, dollars = false, partition = false, table }
  ) {
    this.adapter = adapter;
    this.ahead = ahead;
    this.dialect = dialect;
    this.dollars = dollars;
    this.kind = 'sql';
    this.partition = partition;
    this.table = table;
    /** The moment the partitions in front of the clock run out */
    this.covered = 0;
  }

  /**
   * The statement with the placeholders this driver expects
   *
   * @param {string} sql a statement written with `?`
   * @returns {string} the statement
   * @memberof SqlCalls
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
   * @memberof SqlCalls
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
   * @memberof SqlCalls
   */
  async select(sql, params = []) {
    const rows = await this.adapter.query(this.prepare(sql), params, {
      type: 'SELECT',
    });

    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Creates the table, its indexes and its partitions; idempotent
   *
   * @param {number} [now=Date.now()] the moment
   * @returns {Promise<Array<string>>} the statements that ran
   * @memberof SqlCalls
   */
  async install(now = Date.now()) {
    const statements = install(this.dialect, this.table, {
      ahead: this.ahead,
      now,
      partition: this.partition,
    });

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

    if (this.partition) {
      await this.ensure(now);
    }

    return statements;
  }

  /**
   * Makes sure there are partitions in front of the clock.
   *
   * **A period is only ever added above every existing one**, which is not
   * an optimization: MySQL keeps its ranges in increasing order, so
   * reorganizing the catch-all into a period that sits below one that is
   * already there is refused. A period the sweep dropped therefore does not
   * come back -- and does not need to, since what it held is gone.
   *
   * A failure here is not fatal: the catch-all takes the rows and the next
   * sweep tries again, so this reports rather than throws.
   *
   * @param {number} [now=Date.now()] the moment
   * @returns {Promise<Array<string>>} the partitions that were created
   * @memberof SqlCalls
   */
  async ensure(now = Date.now()) {
    if (!this.partition) {
      return [];
    }

    const existing = await this.partitions();
    const highest = existing.reduce((most, one) => Math.max(most, one.to), 0);
    const made = [];

    for (const start of planOf(now, {
      ahead: this.ahead,
      every: this.partition,
    })) {
      if (start < highest) {
        continue;
      }

      const statement = createPartition(
        this.dialect,
        this.table,
        start,
        this.partition
      );

      try {
        await this.run(statement);
        made.push(partitionName(this.dialect, this.table, start));
        this.covered = Math.max(this.covered, nextOf(start, this.partition));
      } catch (error) {
        if (!ALREADY_THERE.test(reasons(error))) {
          debug('unable to create a partition: %s', error.message);
        }
      }
    }

    this.covered = Math.max(this.covered, highest);

    return made;
  }

  /**
   * The partitions of the table, newest bound first
   *
   * @returns {Promise<Array<object>>} `{ name, from, to }` entries
   * @memberof SqlCalls
   */
  async partitions() {
    const query = listPartitions(this.dialect);

    if (!query || !this.partition) {
      return [];
    }

    const rows = await this.select(query.sql, [this.table]);

    return rows
      .map((row) => {
        const name = row.name || row.NAME;
        const bounds = boundsOf(name, this.partition);

        return bounds ? { name, ...bounds } : null;
      })
      .filter(Boolean)
      .sort((one, two) => two.from - one.from);
  }

  /**
   * Writes rows, in one statement
   *
   * @param {Array<object>} rows the rows, in database shape
   * @returns {Promise<number>} how many were written
   * @memberof SqlCalls
   */
  async insert(rows) {
    if (rows.length === 0) {
      return 0;
    }

    const placeholders = `(${COLUMNS.map(() => '?').join(', ')})`;
    const params = [];

    for (const row of rows) {
      for (const column of COLUMNS) {
        params.push(typeof row[column] === 'undefined' ? null : row[column]);
      }
    }

    await this.run(
      `INSERT INTO ${this.table} (${COLUMNS.join(', ')}) VALUES ${rows
        .map(() => placeholders)
        .join(', ')}`,
      params
    );

    return rows.length;
  }

  /**
   * The tail of a query: an order, then a window
   *
   * @param {string} order the ordering
   * @param {number} limit how many rows
   * @param {number} [offset=0] how many to skip
   * @returns {string} the clause
   * @memberof SqlCalls
   */
  paging(order, limit, offset = 0) {
    if (this.dialect === 'mssql') {
      return ` ORDER BY ${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    }

    return ` ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`;
  }

  /**
   * The WHERE of a filter
   *
   * @param {object} filter the filter
   * @returns {{sql: string, params: Array}} the clause and its parameters
   * @memberof SqlCalls
   */
  conditions(filter) {
    const parts = [];
    const params = [];
    const equals = {
      actor: filter.actor,
      direction: filter.direction,
      outcome: filter.outcome,
      request_id: filter.requestId,
      service: filter.service,
    };

    for (const column of Object.keys(equals).sort()) {
      if (typeof equals[column] === 'string' && equals[column] !== '') {
        parts.push(`${column} = ?`);
        params.push(equals[column]);
      }
    }

    if (Number.isFinite(filter.status)) {
      parts.push('status = ?');
      params.push(filter.status);
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
   * The rows matching a filter.
   *
   * A request id answers oldest first -- that listing is one exchange read
   * as a story -- and everything else answers newest first.
   *
   * @param {object} [filter={}] the filter
   * @returns {Promise<Array<object>>} the rows
   * @memberof SqlCalls
   */
  async list(filter = {}) {
    const { sql, params } = this.conditions(filter);
    const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 1000);
    const offset = Math.max(Number(filter.offset) || 0, 0);
    const order = filter.requestId ? 'at ASC, direction DESC' : 'at DESC';

    return this.select(
      `SELECT * FROM ${this.table}${sql}${this.paging(order, limit, offset)}`,
      params
    );
  }

  /**
   * How many rows match a filter
   *
   * @param {object} [filter={}] the filter
   * @returns {Promise<number>} the count
   * @memberof SqlCalls
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
   * Takes the rows past `before` away.
   *
   * The partitioned path drops whole periods and then runs the bounded
   * delete over whatever is left -- the current period's older half, and
   * anything the catch-all took. The unpartitioned path is only the second
   * half.
   *
   * @param {number} before a timestamp in milliseconds
   * @param {object} [options={}] `batch` and `now`
   * @returns {Promise<object>} `{ removed, partitions, remaining }`
   * @memberof SqlCalls
   */
  async sweep(before, options = {}) {
    const { batch = 5000, now = Date.now() } = options;
    const dropped = [];

    if (this.partition) {
      for (const partition of await this.partitions()) {
        if (partition.to <= before) {
          await this.run(
            dropPartition(this.dialect, this.table, partition.name)
          );
          dropped.push(partition.name);
        }
      }

      await this.ensure(now);
    }

    let removed = 0;

    for (;;) {
      const rows = await this.select(
        `SELECT id FROM ${this.table} WHERE at < ?${this.paging('at ASC', batch)}`,
        [before]
      );

      if (rows.length === 0) {
        break;
      }

      await this.run(
        `DELETE FROM ${this.table} WHERE at < ? AND id IN (${rows
          .map(() => '?')
          .join(', ')})`,
        [before, ...rows.map((row) => row.id || row.ID)]
      );

      removed += rows.length;

      if (rows.length < batch) {
        break;
      }
    }

    return { partitions: dropped, removed };
  }
}

/**
 * The MongoDB backend. The documents carry the SQL column names, so both
 * backends hand the module the same rows.
 *
 * @class MongoCalls
 */
class MongoCalls {
  /**
   * Creates an instance of MongoCalls.
   *
   * @param {object} adapter a henri mongoose (or disk) adapter
   * @param {string} table the collection name
   * @memberof MongoCalls
   */
  constructor(adapter, table) {
    this.adapter = adapter;
    this.dialect = 'mongodb';
    this.kind = 'mongo';
    this.partition = false;
    this.table = table;
  }

  /**
   * The collection
   *
   * @returns {object} a MongoDB collection
   * @throws HENRI_CALLS_UNSUPPORTED_STORE when the store is not connected
   * @memberof MongoCalls
   */
  collection() {
    const connection =
      this.adapter.mongoose && this.adapter.mongoose.connection;

    if (!connection || connection.readyState !== 1 || !connection.db) {
      throw fail(
        'HENRI_CALLS_UNSUPPORTED_STORE',
        `the call log cannot be written: the ${this.adapter.name} store is not connected`
      );
    }

    return connection.db.collection(this.table);
  }

  /**
   * Creates the indexes; idempotent
   *
   * @returns {Promise<Array<string>>} what was created
   * @memberof MongoCalls
   */
  async install() {
    const collection = this.collection();

    await collection.createIndex({ request_id: 1 });
    await collection.createIndex({ at: -1 });
    await collection.createIndex({ direction: 1, service: 1, at: -1 });

    return [`${this.table}.request_id`, `${this.table}.at`];
  }

  /**
   * Nothing to keep ahead of: MongoDB has no range partitions
   *
   * @returns {Promise<Array>} an empty list
   * @memberof MongoCalls
   */
  async ensure() {
    return [];
  }

  /**
   * Nothing to list either
   *
   * @returns {Promise<Array>} an empty list
   * @memberof MongoCalls
   */
  async partitions() {
    return [];
  }

  /**
   * Writes rows
   *
   * @param {Array<object>} rows the rows
   * @returns {Promise<number>} how many were written
   * @memberof MongoCalls
   */
  async insert(rows) {
    if (rows.length === 0) {
      return 0;
    }

    await this.collection().insertMany(
      rows.map((row) => ({ ...row, _id: row.id })),
      { ordered: false }
    );

    return rows.length;
  }

  /**
   * The filter of a listing
   *
   * @param {object} filter the filter
   * @returns {object} a MongoDB filter
   * @memberof MongoCalls
   */
  conditions(filter) {
    const query = {};
    const equals = {
      actor: filter.actor,
      direction: filter.direction,
      outcome: filter.outcome,
      request_id: filter.requestId,
      service: filter.service,
    };

    for (const key of Object.keys(equals).sort()) {
      if (typeof equals[key] === 'string' && equals[key] !== '') {
        query[key] = equals[key];
      }
    }

    if (Number.isFinite(filter.status)) {
      query.status = filter.status;
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
   * The rows matching a filter
   *
   * @param {object} [filter={}] the filter
   * @returns {Promise<Array<object>>} the rows
   * @memberof MongoCalls
   */
  async list(filter = {}) {
    const limit = Math.min(Math.max(Number(filter.limit) || 100, 1), 1000);
    const sort = filter.requestId ? { at: 1, direction: -1 } : { at: -1 };

    return this.collection()
      .find(this.conditions(filter), { sort })
      .skip(Math.max(Number(filter.offset) || 0, 0))
      .limit(limit)
      .toArray();
  }

  /**
   * How many rows match a filter
   *
   * @param {object} [filter={}] the filter
   * @returns {Promise<number>} the count
   * @memberof MongoCalls
   */
  count(filter = {}) {
    return this.collection().countDocuments(this.conditions(filter));
  }

  /**
   * Takes the rows past `before` away, a batch at a time
   *
   * @param {number} before a timestamp in milliseconds
   * @param {object} [options={}] `batch`
   * @returns {Promise<object>} `{ removed, partitions }`
   * @memberof MongoCalls
   */
  async sweep(before, options = {}) {
    const { batch = 5000 } = options;
    const collection = this.collection();
    let removed = 0;

    for (;;) {
      const rows = await collection
        .find(
          { at: { $lt: before } },
          { projection: { _id: 1 }, sort: { at: 1 } }
        )
        .limit(batch)
        .toArray();

      if (rows.length === 0) {
        break;
      }

      const result = await collection.deleteMany({
        _id: { $in: rows.map((row) => row._id) },
      });

      removed += (result && result.deletedCount) || 0;

      if (rows.length < batch) {
        break;
      }
    }

    return { partitions: [], removed };
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
 * @param {object} settings the normalized `config.calls`
 * @returns {object} the backend
 * @throws HENRI_CALLS_UNSUPPORTED_STORE when the adapter cannot hold it
 */
const storeFor = (adapter, settings) => {
  if (!adapter) {
    throw fail(
      'HENRI_CALLS_UNSUPPORTED_STORE',
      'the call log has no store to be written to'
    );
  }

  if (adapter.mongoose) {
    return new MongoCalls(adapter, settings.table);
  }

  const described = typeof adapter.query === 'function' && describe(adapter);

  if (!described || !DIALECTS[described.dialect]) {
    throw fail(
      'HENRI_CALLS_UNSUPPORTED_STORE',
      `the call log cannot be kept in the ${adapter.adapterName || 'unknown'} store: it has neither query() nor a MongoDB connection henri can use`
    );
  }

  return new SqlCalls(adapter, {
    ...described,
    ahead: settings.partitionsAhead,
    partition: settings.partition,
    table: settings.table,
  });
};

module.exports = {
  COLUMNS,
  DAY,
  MongoCalls,
  SqlCalls,
  boundsOf,
  catchAll,
  createPartition,
  describe,
  dropPartition,
  install,
  listPartitions,
  nextOf,
  partitionName,
  planOf,
  stampOf,
  startOf,
  storeFor,
};
