const debug = require('debug')('henri:jobs:sql');

const { JobStoreError } = require('../errors');
const { install, uninstall } = require('./schema');

/**
 * The SQL backend of the queue.
 *
 * Everything goes through the store adapter's own `query()`: no henri model
 * is involved, so the queue works on a store that has no models and cannot
 * be broken by an application's model conventions.
 *
 * ## Claiming
 *
 * A job must never be performed twice at once. Every dialect claims with a
 * single statement, which is therefore its own transaction, and the state
 * is part of the statement's own `WHERE`: a row is claimed by the runner
 * whose UPDATE flipped it out of `pending`, and by no one else.
 *
 * - PostgreSQL: `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`.
 *   A concurrent runner steps over the rows this one locked instead of
 *   waiting for them.
 * - MySQL: `UPDATE ... ORDER BY ... LIMIT n`. InnoDB locks the rows as it
 *   updates them; a concurrent runner blocks on a locked row, re-reads it
 *   once the lock is gone, sees it is no longer `pending` and moves on.
 * - MSSQL: `UPDATE ... WHERE id IN (SELECT TOP (n) ... WITH (UPDLOCK,
 *   READPAST))`, the SKIP LOCKED of that dialect.
 * - SQLite: `UPDATE ... WHERE id IN (SELECT ... LIMIT n)`. Writers are
 *   serialized by the database itself.
 *
 * The claim stamps a fresh `claim_token` on the rows it took, so the rows
 * are read back with an exact `WHERE claim_token = ?` rather than by
 * guessing which of the candidates were won.
 */

/** The columns of the jobs table, in insert order */
const COLUMNS = [
  'id',
  'queue',
  'name',
  'args',
  'state',
  'priority',
  'attempts',
  'max_attempts',
  'timeout_ms',
  'run_at',
  'created_at',
  'updated_at',
  'started_at',
  'finished_at',
  'duration_ms',
  'claimed_by',
  'claimed_at',
  'heartbeat_at',
  'claim_token',
  'error_message',
  'error_stack',
  'history',
  'unique_key',
];

/** How many attempts of a job are kept in its history */
const HISTORY_LIMIT = 10;

/**
 * Errors that mean the object was created by someone else in between.
 *
 * `CREATE TABLE IF NOT EXISTS` is not atomic against a concurrent creation
 * on PostgreSQL: two processes booting together -- a web server and a
 * runner, or two runners -- can both find the table missing and one of them
 * then fails on the catalogue's own unique index. The install is idempotent
 * by intent, so that failure means it is done, not that it broke.
 */
const ALREADY_THERE =
  /already exists|duplicate key|duplicate table|there is already an object named/i;

/**
 * Errors that mean a unique index refused the row.
 *
 * Sequelize names its own (`SequelizeUniqueConstraintError`, whose message
 * is the unhelpful `Validation error`), the drivers word theirs differently,
 * and drizzle passes the driver's through.
 */
const DUPLICATE =
  /unique|duplicate|Validation error|SQLITE_CONSTRAINT|ER_DUP_ENTRY|23505/i;

/** Errors that mean "another writer got there first, try again" */
const RETRYABLE =
  /deadlock|lock wait timeout|database is locked|database table is locked|SQLITE_BUSY/i;

/**
 * Everything an error says about itself, wrappers included
 *
 * Sequelize keeps the driver error on `parent`, drizzle on `cause`; the
 * useful words (deadlock, duplicate, already exists) are down there.
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
 * The parameters of a statement, short enough for a debug line
 *
 * The arguments of a job (and a rendered mail body) go through here: they
 * are never printed whole, not even with DEBUG on.
 *
 * @param {Array} params The parameters
 * @returns {Array} The parameters, the long ones cut short
 */
const brief = (params) =>
  params.map((value) =>
    typeof value === 'string' && value.length > 80
      ? `${value.slice(0, 80)}... (${value.length} chars)`
      : value
  );

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
   * @param {object} options.tables `{ jobs, schedules }` table names
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

    return sql.replace(/\?/g, () => {
      index += 1;

      return `$${index}`;
    });
  }

  /**
   * Runs a statement that returns no rows
   *
   * A statement the database refused because another writer held the rows
   * (a deadlock, a lock timeout, a busy sqlite file) never executed: it was
   * rolled back, so running it again is safe and is what the retry does.
   *
   * @param {string} sql The statement, with `?` placeholders
   * @param {Array} [params=[]] The parameters
   * @returns {Promise<void>} Resolves when done
   * @memberof SqlStore
   */
  async run(sql, params = []) {
    debug('run %s %o', sql, brief(params));

    await this.retrying(() => this.adapter.query(this.prepare(sql), params));
  }

  /**
   * Runs a query and returns its rows
   *
   * `{ type: 'SELECT' }` is what the sequelize adapters need to hand back
   * plain rows instead of `[rows, metadata]`; the drizzle adapter ignores
   * the third argument and returns rows already.
   *
   * @param {string} sql The query, with `?` placeholders
   * @param {Array} [params=[]] The parameters
   * @returns {Promise<Array<object>>} The rows
   * @memberof SqlStore
   */
  async select(sql, params = []) {
    debug('select %s %o', sql, brief(params));

    const result = await this.retrying(() =>
      this.adapter.query(this.prepare(sql), params, { type: 'SELECT' })
    );

    return Array.isArray(result) ? result : [];
  }

  /**
   * Runs an operation again when the database says another writer won
   *
   * @param {function} fn The operation
   * @param {number} [attempts=5] How many times to try
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
        debug('retrying after %s', error.message);
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
      }
    }

    throw last;
  }

  /**
   * Creates the tables and the indexes; idempotent
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
   * Drops the tables
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
   * Whether the tables are there
   *
   * @returns {Promise<boolean>} true when the jobs table answers
   * @memberof SqlStore
   */
  async installed() {
    try {
      await this.select(`SELECT COUNT(*) AS total FROM ${this.tables.jobs}`);

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Inserts a job
   *
   * @param {object} job A row, in database shape
   * @returns {Promise<object>} The job, read back
   * @throws {JobStoreError} DUPLICATE when its unique key is taken
   * @memberof SqlStore
   */
  async insert(job) {
    const values = COLUMNS.map((column) =>
      typeof job[column] === 'undefined' ? null : job[column]
    );

    try {
      await this.run(
        `INSERT INTO ${this.tables.jobs} (${COLUMNS.join(', ')}) VALUES (${marks(COLUMNS)})`,
        values
      );
    } catch (error) {
      // Only a duplicate key is answered with the job that holds it. Any
      // other failure -- a value too long, a connection gone -- is the
      // caller's to see, or an enqueue would silently do nothing
      if (job.unique_key && DUPLICATE.test(reasons(error))) {
        const existing = await this.findByUniqueKey(job.unique_key);

        if (existing && existing.id !== job.id) {
          return existing;
        }
      }

      throw error;
    }

    return this.find(job.id);
  }

  /**
   * One job by id
   *
   * @param {string} id The job id
   * @returns {Promise<?object>} The row, or null
   * @memberof SqlStore
   */
  async find(id) {
    const [row] = await this.select(
      `SELECT * FROM ${this.tables.jobs} WHERE id = ?`,
      [id]
    );

    return row || null;
  }

  /**
   * One job by unique key
   *
   * @param {string} key The unique key
   * @returns {Promise<?object>} The row, or null
   * @memberof SqlStore
   */
  async findByUniqueKey(key) {
    const [row] = await this.select(
      `SELECT * FROM ${this.tables.jobs} WHERE unique_key = ?`,
      [key]
    );

    return row || null;
  }

  /**
   * The claim statement of this dialect, and its parameters
   *
   * @param {object} options `queues`, `limit`, `runner`, `token`, `now`
   * @returns {{sql: string, params: Array}} The statement
   * @memberof SqlStore
   */
  claimStatement({ queues, limit, runner, token, now }) {
    const table = this.tables.jobs;
    const set = [
      `state = 'running'`,
      'attempts = attempts + 1',
      'claimed_by = ?',
      'claim_token = ?',
      'claimed_at = ?',
      'heartbeat_at = ?',
      'started_at = ?',
      'updated_at = ?',
    ].join(', ');
    const setParams = [runner, token, now, now, now, now];
    const filter = [`state = 'pending'`, 'run_at <= ?'];
    const filterParams = [now];

    if (queues.length > 0) {
      filter.push(`queue IN (${marks(queues)})`);
      filterParams.push(...queues);
    }

    const where = filter.join(' AND ');
    const order = 'priority ASC, run_at ASC, id ASC';

    if (this.dialect === 'mysql') {
      return {
        params: [...setParams, ...filterParams, limit],
        sql: `UPDATE ${table} SET ${set} WHERE ${where} ORDER BY ${order} LIMIT ?`,
      };
    }

    if (this.dialect === 'postgres') {
      return {
        params: [...setParams, ...filterParams, limit],
        sql: `UPDATE ${table} SET ${set} WHERE id IN (SELECT id FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ? FOR UPDATE SKIP LOCKED)`,
      };
    }

    if (this.dialect === 'mssql') {
      return {
        params: [...setParams, limit, ...filterParams],
        sql: `UPDATE ${table} SET ${set} WHERE id IN (SELECT TOP (?) id FROM ${table} WITH (UPDLOCK, READPAST) WHERE ${where} ORDER BY ${order})`,
      };
    }

    return {
      params: [...setParams, ...filterParams, limit],
      sql: `UPDATE ${table} SET ${set} WHERE id IN (SELECT id FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ?)`,
    };
  }

  /**
   * Claims up to `limit` jobs for this runner
   *
   * @param {object} options Options
   * @param {Array<string>} [options.queues=[]] The queues to take from
   * @param {number} [options.limit=1] How many jobs at most
   * @param {string} options.runner The runner id
   * @param {string} options.token A token unique to this claim
   * @param {number} options.now The current time
   * @returns {Promise<Array<object>>} The rows this runner owns
   * @memberof SqlStore
   */
  async claim({ queues = [], limit = 1, runner, token, now }) {
    const { params, sql } = this.claimStatement({
      limit,
      now,
      queues,
      runner,
      token,
    });

    await this.run(sql, params);

    return this.select(
      `SELECT * FROM ${this.tables.jobs} WHERE claim_token = ? AND state = 'running' ORDER BY priority ASC, run_at ASC, id ASC`,
      [token]
    );
  }

  /**
   * Writes the outcome of an attempt
   *
   * With a token the write only lands while this runner still owns the row.
   * That matters: a runner whose heartbeat went stale has had its jobs put
   * back and re-claimed by someone else, and it must not write its outcome
   * over the new owner's.
   *
   * @param {string} id The job id
   * @param {object} changes The columns to set
   * @param {string} [token] The claim token this runner holds
   * @returns {Promise<void>} Resolves when written
   * @memberof SqlStore
   */
  async update(id, changes, token) {
    const keys = Object.keys(changes);

    if (keys.length === 0) {
      return;
    }

    const own = token ? ` AND claim_token = ? AND state = 'running'` : '';
    const params = [...keys.map((key) => changes[key]), id];

    if (token) {
      params.push(token);
    }

    await this.run(
      `UPDATE ${this.tables.jobs} SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?${own}`,
      params
    );
  }

  /**
   * Puts back the jobs of runners that stopped answering
   *
   * A runner that is killed between the claim and the outcome leaves a row
   * `running` forever; the heartbeat says when the row was last seen alive.
   * Jobs with attempts left go back to `pending`, the others to the dead
   * letter queue.
   *
   * The sweep is bounded: after a crash that left thousands of rows behind,
   * a runner puts back a batch and gets on with claiming rather than
   * blocking its own loop for the whole pass.
   *
   * @param {object} options Options
   * @param {number} options.now The current time
   * @param {number} options.stuckAfter How long without a heartbeat is dead
   * @param {number} [options.limit=100] How many rows one sweep puts back
   * @returns {Promise<Array<object>>} The rows that were recovered
   * @memberof SqlStore
   */
  async recover({ now, stuckAfter, limit = 100 }) {
    const table = this.tables.jobs;
    const page =
      this.dialect === 'mssql'
        ? 'ORDER BY heartbeat_at ASC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY'
        : 'ORDER BY heartbeat_at ASC LIMIT ?';
    const rows = await this.select(
      `SELECT * FROM ${table} WHERE state = 'running' AND heartbeat_at < ? ${page}`,
      [now - stuckAfter, limit]
    );

    for (const row of rows) {
      const attempts = toNumber(row.attempts) || 0;
      const max = toNumber(row.max_attempts) || 0;
      const dead = attempts >= max;

      await this.run(
        `UPDATE ${table} SET state = ?, run_at = ?, claim_token = NULL, unique_key = ?, error_message = ?, finished_at = ?, updated_at = ? WHERE id = ? AND state = 'running' AND claim_token = ?`,
        [
          dead ? 'dead' : 'pending',
          now,
          // A dead job holds its unique key no longer: the same work may be
          // enqueued again while this one sits in the dead letter queue
          dead ? null : row.unique_key,
          `the runner ${row.claimed_by} stopped answering while performing this job`,
          dead ? now : null,
          now,
          row.id,
          row.claim_token,
        ]
      );
    }

    return rows;
  }

  /**
   * Tells the database this runner is still on these jobs
   *
   * A runner that was already recovered from no longer owns these rows, so
   * the token is part of the filter: its heartbeats become no-ops instead of
   * hiding the staleness the recovery is there to notice.
   *
   * @param {Array<string>} ids The job ids
   * @param {number} now The current time
   * @param {string} [token] The claim token this runner holds
   * @returns {Promise<void>} Resolves when written
   * @memberof SqlStore
   */
  async heartbeat(ids, now, token) {
    if (ids.length === 0) {
      return;
    }

    const own = token ? ' AND claim_token = ?' : '';

    await this.run(
      `UPDATE ${this.tables.jobs} SET heartbeat_at = ? WHERE id IN (${marks(ids)})${own}`,
      token ? [now, ...ids, token] : [now, ...ids]
    );
  }

  /**
   * Deletes the finished jobs older than a moment
   *
   * @param {number} before A timestamp
   * @param {number} [limit=1000] How many rows one pass deletes
   * @returns {Promise<number>} How many rows were deleted
   * @memberof SqlStore
   */
  async prune(before, limit = 1000) {
    const page =
      this.dialect === 'mssql'
        ? 'ORDER BY finished_at ASC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY'
        : 'ORDER BY finished_at ASC LIMIT ?';
    const rows = await this.select(
      `SELECT id FROM ${this.tables.jobs} WHERE state = 'done' AND finished_at < ? ${page}`,
      [before, limit]
    );

    if (rows.length === 0) {
      return 0;
    }

    const ids = rows.map((row) => row.id);

    await this.run(
      `DELETE FROM ${this.tables.jobs} WHERE id IN (${marks(ids)})`,
      ids
    );

    return ids.length;
  }

  /**
   * Lists jobs
   *
   * @param {object} [options={}] `state`, `queue`, `name`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The rows
   * @memberof SqlStore
   */
  async list({ state, queue, name, limit = 50, offset = 0 } = {}) {
    const filter = [];
    const params = [];
    // The driver binds what it is given: `LIMIT '25'` is text where sqlite
    // wants an integer
    const rows = Math.max(1, Number(limit) || 50);
    const from = Math.max(0, Number(offset) || 0);

    if (state) {
      filter.push('state = ?');
      params.push(state);
    }

    if (queue) {
      filter.push('queue = ?');
      params.push(queue);
    }

    if (name) {
      filter.push('name = ?');
      params.push(name);
    }

    const where = filter.length > 0 ? `WHERE ${filter.join(' AND ')}` : '';
    const page =
      this.dialect === 'mssql'
        ? 'OFFSET ? ROWS FETCH NEXT ? ROWS ONLY'
        : 'LIMIT ? OFFSET ?';
    const paging = this.dialect === 'mssql' ? [from, rows] : [rows, from];

    return this.select(
      `SELECT * FROM ${this.tables.jobs} ${where} ORDER BY updated_at DESC, id ASC ${page}`,
      [...params, ...paging]
    );
  }

  /**
   * Deletes jobs
   *
   * @param {object} [options={}] `id`, `state`, `queue`, `name`
   * @returns {Promise<number>} How many rows were deleted
   * @memberof SqlStore
   */
  async remove({ id, state, queue, name } = {}) {
    const filter = [];
    const params = [];

    for (const [column, value] of [
      ['id', id],
      ['state', state],
      ['queue', queue],
      ['name', name],
    ]) {
      if (value) {
        filter.push(`${column} = ?`);
        params.push(value);
      }
    }

    if (filter.length === 0) {
      return 0;
    }

    const where = `WHERE ${filter.join(' AND ')}`;
    const rows = await this.select(
      `SELECT id FROM ${this.tables.jobs} ${where}`,
      params
    );

    if (rows.length > 0) {
      await this.run(`DELETE FROM ${this.tables.jobs} ${where}`, params);
    }

    return rows.length;
  }

  /**
   * Counts the jobs of every queue and state
   *
   * @returns {Promise<Array<object>>} `{ queue, state, total }` rows
   * @memberof SqlStore
   */
  async counts() {
    const rows = await this.select(
      `SELECT queue, state, COUNT(*) AS total FROM ${this.tables.jobs} GROUP BY queue, state`
    );

    return rows.map((row) => ({
      queue: row.queue,
      state: row.state,
      total: toNumber(row.total) || 0,
    }));
  }

  /**
   * How long the finished jobs of every queue took
   *
   * @returns {Promise<Array<object>>} `{ queue, count, min, max, avg }` rows
   * @memberof SqlStore
   */
  async timings() {
    const rows = await this.select(
      `SELECT queue, COUNT(*) AS runs, MIN(duration_ms) AS shortest, MAX(duration_ms) AS longest, AVG(duration_ms) AS average FROM ${this.tables.jobs} WHERE state = 'done' AND duration_ms IS NOT NULL GROUP BY queue`
    );

    return rows.map((row) => ({
      average: Math.round(toNumber(row.average) || 0),
      longest: toNumber(row.longest) || 0,
      queue: row.queue,
      runs: toNumber(row.runs) || 0,
      shortest: toNumber(row.shortest) || 0,
    }));
  }

  /**
   * The moment the oldest job waiting in every queue was due
   *
   * @param {number} now The current time
   * @returns {Promise<Array<object>>} `{ queue, waiting }` rows
   * @memberof SqlStore
   */
  async oldest(now) {
    const rows = await this.select(
      `SELECT queue, MIN(run_at) AS due FROM ${this.tables.jobs} WHERE state = 'pending' AND run_at <= ? GROUP BY queue`,
      [now]
    );

    return rows.map((row) => ({
      queue: row.queue,
      waiting: Math.max(0, now - (toNumber(row.due) || now)),
    }));
  }

  /**
   * The schedule of a recurring job
   *
   * @param {string} name The schedule name
   * @returns {Promise<?object>} The row, or null
   * @memberof SqlStore
   */
  async schedule(name) {
    const [row] = await this.select(
      `SELECT * FROM ${this.tables.schedules} WHERE name = ?`,
      [name]
    );

    return row || null;
  }

  /**
   * Records a schedule that has none yet
   *
   * @param {object} row The schedule row
   * @returns {Promise<?object>} The schedule, or null when another runner
   *   recorded it first
   * @memberof SqlStore
   */
  async addSchedule(row) {
    try {
      await this.run(
        `INSERT INTO ${this.tables.schedules} (name, job, spec, next_run_at, last_run_at, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.name,
          row.job,
          row.spec,
          row.next_run_at,
          null,
          null,
          row.created_at,
          row.updated_at,
        ]
      );
    } catch (error) {
      // Another runner recording it first is the expected failure; anything
      // else (no table, no permission) is answered with null, and the runner
      // says so rather than silently never running the schedule
      debug('schedule %s not recorded (%s)', row.name, error.message);
    }

    return this.schedule(row.name).catch(() => null);
  }

  /**
   * Moves a schedule forward, if this runner is the one that got there first
   *
   * The update only matches while `next_run_at` still holds the moment this
   * runner read: exactly one runner can move a schedule on, and it is the
   * one that enqueues the job.
   *
   * @param {object} options Options
   * @param {string} options.name The schedule name
   * @param {string} options.spec The schedule expression, refreshed
   * @param {number} options.due The moment this runner read
   * @param {number} options.next When it should run after that
   * @param {string} options.token A token unique to this attempt
   * @param {number} options.now The current time
   * @returns {Promise<boolean>} Whether this runner won the slot
   * @memberof SqlStore
   */
  async advanceSchedule({ name, spec, due, next, token, now }) {
    await this.run(
      `UPDATE ${this.tables.schedules} SET next_run_at = ?, last_run_at = ?, spec = ?, token = ?, updated_at = ? WHERE name = ? AND next_run_at = ?`,
      [next, due, spec, token, now, name, due]
    );

    const row = await this.schedule(name);

    return Boolean(row && row.token === token);
  }

  /**
   * Points a schedule at a new moment, whatever it held (the expression of
   * the configuration changed)
   *
   * @param {object} options `name`, `spec`, `next` and `now`
   * @returns {Promise<void>} Resolves when written
   * @memberof SqlStore
   */
  async resetSchedule({ name, spec, next, now }) {
    await this.run(
      `UPDATE ${this.tables.schedules} SET next_run_at = ?, spec = ?, updated_at = ? WHERE name = ?`,
      [next, spec, now, name]
    );
  }

  /**
   * Forgets the schedules the configuration no longer declares
   *
   * @param {Array<string>} names The schedules to keep
   * @returns {Promise<void>} Resolves when done
   * @memberof SqlStore
   */
  async pruneSchedules(names) {
    if (names.length === 0) {
      await this.run(`DELETE FROM ${this.tables.schedules}`);

      return;
    }

    await this.run(
      `DELETE FROM ${this.tables.schedules} WHERE name NOT IN (${marks(names)})`,
      names
    );
  }
}

/**
 * The dialect of a store adapter, or nothing when it is not SQL
 *
 * @param {object} adapter A henri store adapter
 * @returns {?{dialect: string, dollars: boolean}} How to talk to it
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
    const name = adapter.ensureConnector().getDialect();

    return { dialect: name === 'mssql' ? 'mssql' : name, dollars: false };
  }

  return null;
};

/**
 * Builds the SQL store of an adapter
 *
 * @param {object} adapter A henri store adapter
 * @param {object} tables `{ jobs, schedules }` table names
 * @returns {SqlStore} The store
 * @throws {JobStoreError} When the dialect cannot back a queue
 */
const create = (adapter, tables) => {
  const described = describe(adapter);

  if (!described) {
    throw new JobStoreError(
      `@usehenri/jobs: the ${adapter.adapterName} adapter has no SQL surface`
    );
  }

  if (!['mssql', 'mysql', 'postgres', 'sqlite'].includes(described.dialect)) {
    throw new JobStoreError(
      `@usehenri/jobs: the ${described.dialect} dialect is not supported`
    );
  }

  return new SqlStore(adapter, { ...described, tables });
};

module.exports = {
  COLUMNS,
  DUPLICATE,
  HISTORY_LIMIT,
  SqlStore,
  create,
  describe,
  reasons,
  toNumber,
};
