const debug = require('debug')('henri:webhooks:sql');

const { COLUMNS, install, uninstall } = require('./schema');
const { WebhookError } = require('../errors');

/**
 * The SQL backend of the endpoints table.
 *
 * Everything goes through the store adapter's own `query()`, so no henri
 * model is involved and an application whose store has no models at all
 * still has endpoints. There is no claiming and no contention here -- an
 * endpoint is written by an operator and read by the runners -- so this is
 * six plain statements, and the concurrency of the queue is not repeated.
 */

/**
 * Errors that mean the object was created by someone else in between
 *
 * `CREATE TABLE IF NOT EXISTS` is not atomic against a concurrent creation
 * on PostgreSQL: two processes booting together can both find the table
 * missing, and one of them then fails on the catalogue's own unique index.
 * The install is idempotent by intent, so that failure means it is done.
 */
const ALREADY_THERE =
  /already exists|duplicate key|duplicate table|there is already an object named/iu;

/** Errors that mean "another writer got there first, try again" */
const RETRYABLE =
  /deadlock|lock wait timeout|database is locked|database table is locked|SQLITE_BUSY/iu;

/**
 * Everything an error says about itself, wrappers included
 *
 * Sequelize keeps the driver error on `parent`, drizzle on `cause`.
 *
 * @param {*} error An error
 * @param {number} [depth=4] How far to unwrap
 * @returns {string} The messages, joined
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
 * @param {*} value The stored value
 * @returns {?number} The number, or null
 */
const toNumber = (value) => {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isNaN(number) ? null : number;
};

/**
 * The `?` placeholders of a list
 *
 * @param {Array} values The values
 * @returns {string} `?, ?, ?`
 */
const marks = (values) => values.map(() => '?').join(', ');

/**
 * The SQL store
 *
 * @class SqlStore
 */
class SqlStore {
  /**
   * Creates an instance of SqlStore.
   *
   * @param {object} adapter A henri store adapter with `query()`
   * @param {object} options Options
   * @param {string} options.dialect sqlite, postgres, mysql or mssql
   * @param {boolean} [options.dollars=false] The driver numbers its
   *   placeholders (`$1`), as node-postgres does
   * @param {object} options.tables `{ endpoints }` table names
   * @memberof SqlStore
   */
  constructor(adapter, { dialect, dollars = false, tables }) {
    this.adapter = adapter;
    this.dialect = dialect;
    this.dollars = dollars;
    this.tables = tables;
    this.kind = 'sql';
  }

  /**
   * The statement with the placeholders the driver expects
   *
   * @param {string} sql A statement written with `?` placeholders
   * @returns {string} The statement
   * @memberof SqlStore
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
   * Runs an operation again when the database says another writer won
   *
   * @param {Function} fn The operation
   * @param {number} [attempts=8] How many times to try
   * @returns {Promise<*>} What fn returns
   * @throws {Error} The last error when every attempt failed
   * @memberof SqlStore
   */
  async retrying(fn, attempts = 8) {
    let last = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        if (!RETRYABLE.test(reasons(error))) {
          throw error;
        }

        last = error;
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
      }
    }

    throw last;
  }

  /**
   * Runs a statement that returns no rows
   *
   * @param {string} sql The statement, with `?` placeholders
   * @param {Array} [params=[]] The parameters
   * @returns {Promise<void>} Resolves when done
   * @memberof SqlStore
   */
  async run(sql, params = []) {
    debug('run %s', sql);

    await this.retrying(() => this.adapter.query(this.prepare(sql), params));
  }

  /**
   * Runs a query and returns its rows
   *
   * @param {string} sql The query, with `?` placeholders
   * @param {Array} [params=[]] The parameters
   * @returns {Promise<Array<object>>} The rows
   * @memberof SqlStore
   */
  async select(sql, params = []) {
    debug('select %s', sql);

    const result = await this.retrying(() =>
      this.adapter.query(this.prepare(sql), params, { type: 'SELECT' })
    );

    return Array.isArray(result) ? result : [];
  }

  /**
   * Creates the table and its index; idempotent
   *
   * @returns {Promise<Array<string>>} The statements that ran
   * @memberof SqlStore
   */
  async install() {
    const statements = install(this.dialect, this.tables);

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
   * Drops the table
   *
   * @returns {Promise<Array<string>>} The statements that ran
   * @memberof SqlStore
   */
  async uninstall() {
    const statements = uninstall(this.dialect, this.tables);

    for (const statement of statements) {
      await this.run(statement);
    }

    return statements;
  }

  /**
   * Whether the table is there
   *
   * @returns {Promise<boolean>} true when it answers
   * @memberof SqlStore
   */
  async installed() {
    try {
      await this.select(
        `SELECT COUNT(*) AS total FROM ${this.tables.endpoints}`
      );

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Inserts an endpoint
   *
   * @param {object} row A row, in database shape
   * @returns {Promise<object>} The endpoint, read back
   * @memberof SqlStore
   */
  async insert(row) {
    const values = COLUMNS.map((column) =>
      typeof row[column] === 'undefined' ? null : row[column]
    );

    await this.run(
      `INSERT INTO ${this.tables.endpoints} (${COLUMNS.join(', ')}) VALUES (${marks(COLUMNS)})`,
      values
    );

    return this.find(row.id);
  }

  /**
   * One endpoint by id
   *
   * @param {string} id The endpoint id
   * @returns {Promise<?object>} The row, or null
   * @memberof SqlStore
   */
  async find(id) {
    const [row] = await this.select(
      `SELECT * FROM ${this.tables.endpoints} WHERE id = ?`,
      [id]
    );

    return row || null;
  }

  /**
   * Writes a few columns of an endpoint
   *
   * @param {string} id The endpoint id
   * @param {object} changes The columns to write
   * @returns {Promise<?object>} The row, read back
   * @memberof SqlStore
   */
  async update(id, changes) {
    const keys = Object.keys(changes).filter((key) => COLUMNS.includes(key));

    if (keys.length === 0) {
      return this.find(id);
    }

    await this.run(
      `UPDATE ${this.tables.endpoints} SET ${keys
        .map((key) => `${key} = ?`)
        .join(', ')} WHERE id = ?`,
      [...keys.map((key) => changes[key]), id]
    );

    return this.find(id);
  }

  /**
   * Deletes an endpoint
   *
   * @param {string} id The endpoint id
   * @returns {Promise<boolean>} Whether there was one to delete
   * @memberof SqlStore
   */
  async remove(id) {
    const before = await this.find(id);

    await this.run(`DELETE FROM ${this.tables.endpoints} WHERE id = ?`, [id]);

    return Boolean(before);
  }

  /**
   * The endpoints of an application, or of one owner
   *
   * @param {object} [filter={}] `owner`, `disabled`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The rows
   * @memberof SqlStore
   */
  async list(filter = {}) {
    const where = [];
    const params = [];

    if (typeof filter.owner === 'string') {
      where.push('owner = ?');
      params.push(filter.owner);
    }

    // `null` is a filter, not the absence of one: an event emitted without
    // an owner reaches the endpoints that have none, and never a tenant's
    if (filter.owner === null) {
      where.push('owner IS NULL');
    }

    if (filter.disabled === false) {
      where.push('disabled_at IS NULL');
    }

    if (filter.disabled === true) {
      where.push('disabled_at IS NOT NULL');
    }

    const limit = Math.max(1, Math.min(Number(filter.limit) || 1000, 10000));
    const offset = Math.max(0, Number(filter.offset) || 0);
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const paging =
      this.dialect === 'mssql'
        ? ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
        : ` LIMIT ${limit} OFFSET ${offset}`;

    return this.select(
      `SELECT * FROM ${this.tables.endpoints}${clause} ORDER BY created_at ASC, id ASC${paging}`,
      params
    );
  }

  /**
   * How many endpoints there are
   *
   * @param {object} [filter={}] `owner`, `disabled`
   * @returns {Promise<number>} The count
   * @memberof SqlStore
   */
  async count(filter = {}) {
    const where = [];
    const params = [];

    if (typeof filter.owner === 'string') {
      where.push('owner = ?');
      params.push(filter.owner);
    }

    if (filter.owner === null) {
      where.push('owner IS NULL');
    }

    if (filter.disabled === false) {
      where.push('disabled_at IS NULL');
    }

    if (filter.disabled === true) {
      where.push('disabled_at IS NOT NULL');
    }

    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const [row] = await this.select(
      `SELECT COUNT(*) AS total FROM ${this.tables.endpoints}${clause}`,
      params
    );

    return toNumber(row && (row.total || row.TOTAL)) || 0;
  }
}

/**
 * The dialect of a store adapter, or nothing when it is not SQL
 *
 * @param {object} adapter A henri store adapter
 * @returns {?object} `{ dialect, dollars }`
 */
const describe = (adapter) => {
  // The drizzle adapter names its dialect and its placeholder style
  if (adapter.dialect && typeof adapter.dialect === 'object') {
    return {
      dialect: adapter.dialect.name,
      dollars: adapter.dialect.placeholder(1) === '$1',
    };
  }

  // The sequelize adapters: the dialect comes from the connector, and
  // sequelize renders `?` replacements itself on every dialect
  if (typeof adapter.ensureConnector === 'function') {
    return { dialect: adapter.ensureConnector().getDialect(), dollars: false };
  }

  return null;
};

/**
 * Builds the SQL store of an adapter
 *
 * @param {object} adapter A henri store adapter
 * @param {object} tables `{ endpoints }` table names
 * @returns {SqlStore} The store
 * @throws {WebhookError} When the dialect cannot hold the endpoints
 */
const create = (adapter, tables) => {
  const described = describe(adapter);

  if (!described) {
    throw new WebhookError(
      'HENRI_WEBHOOK_UNSUPPORTED_STORE',
      `@usehenri/webhooks: the ${adapter.adapterName} adapter has no SQL surface`
    );
  }

  if (!['mssql', 'mysql', 'postgres', 'sqlite'].includes(described.dialect)) {
    throw new WebhookError(
      'HENRI_WEBHOOK_UNSUPPORTED_STORE',
      `@usehenri/webhooks: the ${described.dialect} dialect is not supported`
    );
  }

  return new SqlStore(adapter, { ...described, tables });
};

module.exports = { SqlStore, create, describe, reasons, toNumber };
