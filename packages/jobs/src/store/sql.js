const debug = require('debug')('henri:jobs:sql');

const { JobStoreError } = require('../errors');
const { install, uninstall, upgrade } = require('./schema');
const { keep } = require('../keys');

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
 *
 * ## Concurrency limits
 *
 * A job may declare how many of it may run at once across every runner
 * (`concurrency`). That bound is **not** in the claim statement, and it
 * cannot be: a `SELECT COUNT(*) ... WHERE state = 'running'` inside the
 * claim is read at the statement's own snapshot, so two runners racing both
 * see the same free room, both take it and both commit. `FOR UPDATE SKIP
 * LOCKED` does not help -- it locks the candidate *rows*, so the second
 * runner steps over them and claims the next ones instead. Making the count
 * exact needs a lock on something shared per key, and that is
 * `pg_advisory_xact_lock` on PostgreSQL, `GET_LOCK` on MySQL,
 * `sp_getapplock` on MSSQL and nothing at all on MongoDB: four mechanisms,
 * one of them missing.
 *
 * So the bound lives in a table (`<jobs>_limits`), and the primitive is the
 * one every backend agrees on: **a unique index refusing a duplicate**. One
 * row is one slot, `(limit_key, slot)` is the primary key, and a runner
 * takes a slot by inserting it -- exactly one insert per slot wins. A runner
 * takes the permit *first* and claims one row of that key second, so a job
 * is never claimed only to be put back, which would spin the runner's loop.
 *
 * The claim statement itself gains one predicate and keeps its shape:
 * `name NOT IN (...)` for the pass that takes the unlimited work, and
 * `name IN (...) AND concurrency_key = ?` for the pass that takes one
 * limited row. With no limited job in the application the statement is what
 * it always was, down to its parameters.
 *
 * ## Batches
 *
 * A batch counts its jobs, and a counter read, added to and written back is
 * the lost update every textbook opens with -- two runners finishing at the
 * same instant would both read 39 and both write 40. So the counter is
 * **never read to be written**: `advanceBatch()` is one statement,
 * `SET done = done + 1`, which every engine evaluates under a row lock of
 * its own (sqlite serializes its writers outright), so the increments of
 * four runners are four increments.
 *
 * What makes it exactly once is the `EXISTS` in that same statement: the
 * counter only moves while the job row still holds **this runner's claim
 * token** and is already terminal -- which is true of exactly one runner,
 * the one whose token-guarded outcome write landed. A runner whose write
 * was refused because it had been recovered from counts nothing, and the
 * runner that took the job over counts once when it finishes.
 *
 * ## The tenant
 *
 * `tenant` is a column like `concurrency_key` and `batch_id`: it arrives
 * through the tolerated upgrade block, `tenanted()` asks the table whether
 * it is there, and the insert names the columns that are. It is written by
 * the enqueue and read by a listing.
 *
 * It is deliberately **not** in the claim. A runner performs every
 * tenant's work, and narrowing the claim would give one customer's backlog
 * a runner of its own -- a scheduling feature, with a fairness question
 * attached, and not this. What the column decides is which tenant the
 * runner *enters* before it calls `perform()` (`Jobs#scoped`), which is a
 * different question with a different answer.
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
  'concurrency_key',
  'batch_id',
  'tenant',
];

/** The columns of the batches table, in insert order */
const BATCH_COLUMNS = [
  'id',
  'name',
  'callback',
  'callback_args',
  'callback_options',
  'callback_id',
  'total',
  'done',
  'failed',
  'created_at',
  'updated_at',
  'sealed_at',
  'finished_at',
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
  /already exists|duplicate key|duplicate table|duplicate column|duplicate key name|there is already an object named/i;

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
   * @param {object} options.tables `{ jobs, schedules, limits, batches }` table names
   * @memberof SqlStore
   */
  constructor(adapter, { dialect, dollars = false, tables }) {
    this.adapter = adapter;
    this.dialect = dialect;
    this.dollars = dollars;
    this.tables = tables;
    this.kind = 'sql';
    /** Whether the table has `concurrency_key`; asked once, see concurrent() */
    this.limits = null;
    /** Whether the store can hold a batch; asked once, see batched() */
    this.batches = null;
    /** Whether the table has `tenant`; asked once, see tenanted() */
    this.tenants = null;
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
   * The upgrade block (`schema.upgrade()`) is tolerated whatever it answers:
   * it touches a table an older henri created, and a user who may not
   * `ALTER` must not fail the boot of an application that never asked for
   * the column it adds. What the column is needed for asks for it by name
   * (`concurrent()`), and says so with the install line.
   *
   * @returns {Promise<Array<string>>} The statements that ran
   * @memberof SqlStore
   */
  async install() {
    const statements = install(this.dialect, this.tables);
    const soft = new Set(upgrade(this.dialect, this.tables));

    for (const statement of statements) {
      try {
        await this.run(statement);
      } catch (error) {
        if (soft.has(statement)) {
          debug('upgrade statement did not apply: %s', error.message);
          continue;
        }

        if (!ALREADY_THERE.test(reasons(error))) {
          throw error;
        }

        debug('another process created it first: %s', error.message);
      }
    }

    this.limits = null;
    this.batches = null;
    this.tenants = null;

    return statements;
  }

  /**
   * Whether the jobs table has the column concurrency limits need
   *
   * Asked once, of the table itself rather than of what the install
   * answered: an installation that upgraded henri without running the
   * install, or whose database user may not `ALTER`, has the table an older
   * version wrote and the queue works exactly as it did.
   *
   * @returns {Promise<boolean>} true when `concurrency_key` is there
   * @memberof SqlStore
   */
  async concurrent() {
    if (typeof this.limits === 'boolean') {
      return this.limits;
    }

    try {
      // Reads nothing: the planner still has to resolve the column
      await this.select(
        `SELECT concurrency_key FROM ${this.tables.jobs} WHERE 1 = 0`
      );
      this.limits = true;
    } catch (error) {
      debug('no concurrency_key column: %s', error.message);
      this.limits = false;
    }

    return this.limits;
  }

  /**
   * Whether this store can hold a batch
   *
   * Asked once, of the database rather than of what the install answered,
   * for the reason `concurrent()` gives: an installation that upgraded
   * henri without running the install, or whose database user may not
   * `ALTER`, has the tables an older version wrote and the queue works
   * exactly as it did. Both halves are asked, because a batch needs the
   * column that ties a job to it *and* the table that counts.
   *
   * @returns {Promise<boolean>} true when a batch can be stored
   * @memberof SqlStore
   */
  async batched() {
    if (typeof this.batches === 'boolean') {
      return this.batches;
    }

    try {
      // Reads nothing: the planner still has to resolve both
      await this.select(`SELECT batch_id FROM ${this.tables.jobs} WHERE 1 = 0`);
      await this.select(`SELECT id FROM ${this.tables.batches} WHERE 1 = 0`);
      this.batches = true;
    } catch (error) {
      debug('no batches here: %s', error.message);
      this.batches = false;
    }

    return this.batches;
  }

  /**
   * Whether the jobs table has the column a tenant is stamped in
   *
   * Asked once, of the table itself rather than of what the install
   * answered, for the reason `concurrent()` gives. An application that is
   * not multi-tenant never notices either answer: the column holds null
   * for every row it writes.
   *
   * @returns {Promise<boolean>} true when `tenant` is there
   * @memberof SqlStore
   */
  async tenanted() {
    if (typeof this.tenants === 'boolean') {
      return this.tenants;
    }

    try {
      // Reads nothing: the planner still has to resolve the column
      await this.select(`SELECT tenant FROM ${this.tables.jobs} WHERE 1 = 0`);
      this.tenants = true;
    } catch (error) {
      debug('no tenant column: %s', error.message);
      this.tenants = false;
    }

    return this.tenants;
  }

  /**
   * The columns of the jobs table an insert may name
   *
   * A table an older henri wrote has none of `concurrency_key`, `batch_id`
   * and `tenant`, and an application that uses none of them must not
   * notice: the insert names the columns that are there, so the queue works
   * exactly as it did.
   *
   * @returns {Promise<Array<string>>} The column names
   * @memberof SqlStore
   */
  async columns() {
    const missing = [];

    if (!(await this.concurrent())) {
      missing.push('concurrency_key');
    }

    if (!(await this.batched())) {
      missing.push('batch_id');
    }

    if (!(await this.tenanted())) {
      missing.push('tenant');
    }

    return missing.length === 0
      ? COLUMNS
      : COLUMNS.filter((column) => !missing.includes(column));
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
    const columns = await this.columns();
    const values = columns.map((column) =>
      typeof job[column] === 'undefined' ? null : job[column]
    );

    try {
      await this.run(
        `INSERT INTO ${this.tables.jobs} (${columns.join(', ')}) VALUES (${marks(columns)})`,
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
   * @param {object} options Options
   * @param {Array<string>} options.queues The queues to take from
   * @param {number} options.limit How many rows at most
   * @param {string} options.runner The runner id
   * @param {string} options.token A token unique to this claim
   * @param {number} options.now The current time
   * @param {object} [options.key] `{ value, own }`, the concurrency key this
   *   pass holds a slot for; `own` when it is the group's own bucket
   * @param {Array<string>} [options.names] Only these job names
   * @param {Array<string>} [options.except] Every name but these
   * @returns {{sql: string, params: Array}} The statement
   * @memberof SqlStore
   */
  claimStatement({ queues, limit, runner, token, now, key, names, except }) {
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

    // The two passes partition the pending rows by **name**, so every row
    // belongs to exactly one of them: a job that gained a limit is taken by
    // the second pass from that moment on, and one that lost its limit goes
    // back to the first even though its rows still carry a key
    if (except && except.length > 0) {
      filter.push(`name NOT IN (${marks(except)})`);
      filterParams.push(...except);
    }

    if (names && names.length > 0) {
      filter.push(`name IN (${marks(names)})`);
      filterParams.push(...names);
    }

    if (key) {
      // A row enqueued before the limit was declared carries no key at all;
      // it belongs to the group's own bucket, which is what `key.own` says
      filter.push(
        key.own
          ? '(concurrency_key = ? OR concurrency_key IS NULL)'
          : 'concurrency_key = ?'
      );
      filterParams.push(key.value);
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
   * @param {object} [options.key] The concurrency key a slot is held for
   * @param {Array<string>} [options.names] Only these job names
   * @param {Array<string>} [options.except] Every name but these
   * @returns {Promise<Array<object>>} The rows this runner owns
   * @memberof SqlStore
   */
  async claim({
    queues = [],
    limit = 1,
    runner,
    token,
    now,
    key,
    names,
    except,
  }) {
    const { params, sql } = this.claimStatement({
      except,
      key,
      limit,
      names,
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
   * The concurrency keys with work waiting, the most urgent first
   *
   * One row per `(concurrency_key, name)` pair, so the caller can map a row
   * that carries no key -- enqueued before the limit was declared -- onto
   * the group it belongs to, which only the definitions know.
   *
   * @param {object} options Options
   * @param {number} options.now The current time
   * @param {Array<string>} options.names The names of the limited jobs
   * @param {Array<string>} [options.queues=[]] The queues to look at
   * @param {number} [options.limit=100] How many keys at most
   * @returns {Promise<Array<object>>} `{ key, name, total }` rows
   * @memberof SqlStore
   */
  async waiting({ now, names, queues = [], limit = 100 }) {
    if (!names || names.length === 0) {
      return [];
    }

    const filter = [
      `state = 'pending'`,
      'run_at <= ?',
      `name IN (${marks(names)})`,
    ];
    const params = [now, ...names];

    if (queues.length > 0) {
      filter.push(`queue IN (${marks(queues)})`);
      params.push(...queues);
    }

    const page =
      this.dialect === 'mssql'
        ? 'OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY'
        : 'LIMIT ?';
    const rows = await this.select(
      `SELECT concurrency_key, name, COUNT(*) AS total FROM ${this.tables.jobs} WHERE ${filter.join(' AND ')} GROUP BY concurrency_key, name ORDER BY MIN(priority) ASC, MIN(run_at) ASC ${page}`,
      [...params, Math.max(1, Number(limit) || 100)]
    );

    return rows.map((row) => ({
      key: row.concurrency_key || null,
      name: row.name,
      total: toNumber(row.total) || 0,
    }));
  }

  /**
   * Takes one of a key's slots, or answers null when they are all held
   *
   * **This is the bound.** `(limit_key, slot)` is the primary key, so of
   * every runner inserting the same slot exactly one succeeds and the others
   * are refused by the index -- no transaction, no affected-row count, no
   * dialect of its own. The slots are tried in order, so a key at its limit
   * costs `limit` refused inserts and nothing else.
   *
   * @param {object} options Options
   * @param {string} options.key The concurrency key
   * @param {number} options.limit How many may run at once
   * @param {string} options.runner The runner id
   * @param {number} options.now The current time
   * @returns {Promise<?number>} The slot this runner holds, or null
   * @memberof SqlStore
   */
  async takeSlot({ key, limit, runner, now }) {
    const held = await this.select(
      `SELECT slot FROM ${this.tables.limits} WHERE limit_key = ?`,
      [key]
    );
    const taken = new Set(held.map((row) => toNumber(row.slot)));

    for (let slot = 0; slot < limit; slot += 1) {
      if (taken.has(slot)) {
        continue;
      }

      try {
        await this.run(
          `INSERT INTO ${this.tables.limits} (limit_key, slot, job_id, runner, taken_at, heartbeat_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [key, slot, null, runner, now, now]
        );

        return slot;
      } catch (error) {
        if (!DUPLICATE.test(reasons(error))) {
          throw error;
        }

        debug('slot %d of %s was taken first', slot, key);
      }
    }

    return null;
  }

  /**
   * Says which job a slot is being held for
   *
   * @param {string} key The concurrency key
   * @param {number} slot The slot
   * @param {?string} id The job id
   * @param {number} now The current time
   * @returns {Promise<void>} Resolves when written
   * @memberof SqlStore
   */
  async holdSlot(key, slot, id, now) {
    await this.run(
      `UPDATE ${this.tables.limits} SET job_id = ?, heartbeat_at = ? WHERE limit_key = ? AND slot = ?`,
      [id, now, key, slot]
    );
  }

  /**
   * Gives a slot back
   *
   * @param {string} key The concurrency key
   * @param {number} slot The slot
   * @param {string} [runner] Only when this runner still holds it
   * @returns {Promise<void>} Resolves when written
   * @memberof SqlStore
   */
  async releaseSlot(key, slot, runner) {
    const own = runner ? ' AND runner = ?' : '';
    const params = runner ? [key, slot, runner] : [key, slot];

    await this.run(
      `DELETE FROM ${this.tables.limits} WHERE limit_key = ? AND slot = ?${own}`,
      params
    );
  }

  /**
   * Tells the database this runner still holds these slots
   *
   * @param {Array<object>} slots `{ key, slot }` entries
   * @param {number} now The current time
   * @param {string} runner The runner id
   * @returns {Promise<void>} Resolves when written
   * @memberof SqlStore
   */
  async heartbeatSlots(slots, now, runner) {
    for (const held of slots) {
      await this.run(
        `UPDATE ${this.tables.limits} SET heartbeat_at = ? WHERE limit_key = ? AND slot = ? AND runner = ?`,
        [now, held.key, held.slot, runner]
      );
    }
  }

  /**
   * Frees the slots of runners that stopped answering
   *
   * The bound rests on this being slower than the heartbeat: a slot is
   * refreshed four times per `stuckAfter`, and freeing one that is still
   * held would let a second runner perform alongside the first. It is the
   * same condition the recovery of a claimed job already rests on.
   *
   * @param {object} options Options
   * @param {number} options.now The current time
   * @param {number} options.stuckAfter How long without a heartbeat is dead
   * @param {number} [options.limit=100] How many one sweep frees
   * @returns {Promise<Array<object>>} The slots that were freed
   * @memberof SqlStore
   */
  async sweepSlots({ now, stuckAfter, limit = 100 }) {
    const page =
      this.dialect === 'mssql'
        ? 'ORDER BY heartbeat_at ASC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY'
        : 'ORDER BY heartbeat_at ASC LIMIT ?';
    const rows = await this.select(
      `SELECT * FROM ${this.tables.limits} WHERE heartbeat_at < ? ${page}`,
      [now - stuckAfter, limit]
    );

    for (const row of rows) {
      await this.run(
        `DELETE FROM ${this.tables.limits} WHERE limit_key = ? AND slot = ? AND heartbeat_at = ?`,
        [row.limit_key, toNumber(row.slot), toNumber(row.heartbeat_at)]
      );
    }

    return rows.map((row) => ({
      job: row.job_id || null,
      key: row.limit_key,
      runner: row.runner,
      slot: toNumber(row.slot),
      takenAt: toNumber(row.taken_at),
    }));
  }

  /**
   * Every slot being held right now
   *
   * @param {number} [limit=200] How many at most
   * @returns {Promise<Array<object>>} The held slots
   * @memberof SqlStore
   */
  async slots(limit = 200) {
    const page =
      this.dialect === 'mssql'
        ? 'OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY'
        : 'LIMIT ?';
    const rows = await this.select(
      `SELECT * FROM ${this.tables.limits} ORDER BY limit_key ASC, slot ASC ${page}`,
      [limit]
    );

    return rows.map((row) => ({
      heartbeatAt: toNumber(row.heartbeat_at),
      job: row.job_id || null,
      key: row.limit_key,
      runner: row.runner,
      slot: toNumber(row.slot),
      takenAt: toNumber(row.taken_at),
    }));
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
          dead ? keep(row.unique_key) : row.unique_key,
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
   * @param {object} [options={}] `state`, `queue`, `name`, `batch`,
   *   `tenant`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The rows
   * @memberof SqlStore
   */
  async list({
    state,
    queue,
    name,
    batch,
    tenant,
    limit = 50,
    offset = 0,
  } = {}) {
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

    if (batch) {
      filter.push('batch_id = ?');
      params.push(batch);
    }

    if (tenant) {
      filter.push('tenant = ?');
      params.push(tenant);
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
   * @param {object} [options={}] `id`, `state`, `queue`, `name`, `tenant`
   * @returns {Promise<number>} How many rows were deleted
   * @memberof SqlStore
   */
  async remove({ id, state, queue, name, tenant } = {}) {
    const filter = [];
    const params = [];

    for (const [column, value] of [
      ['id', id],
      ['state', state],
      ['queue', queue],
      ['name', name],
      ['tenant', tenant],
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

  /**
   * Records a batch
   *
   * @param {object} batch A batch row, in database shape
   * @returns {Promise<object>} The batch, read back
   * @memberof SqlStore
   */
  async createBatch(batch) {
    const values = BATCH_COLUMNS.map((column) =>
      typeof batch[column] === 'undefined' ? null : batch[column]
    );

    await this.run(
      `INSERT INTO ${this.tables.batches} (${BATCH_COLUMNS.join(', ')}) VALUES (${marks(BATCH_COLUMNS)})`,
      values
    );

    return this.findBatch(batch.id);
  }

  /**
   * One batch by id
   *
   * @param {string} id The batch id
   * @returns {Promise<?object>} The row, or null
   * @memberof SqlStore
   */
  async findBatch(id) {
    const [row] = await this.select(
      `SELECT * FROM ${this.tables.batches} WHERE id = ?`,
      [id]
    );

    return row || null;
  }

  /**
   * Closes a batch to new jobs and writes down how many it holds
   *
   * `total` is written once and never moves again, which is what makes
   * "the counter reached the total" mean "every job of the batch is
   * terminal". Nothing settles before this: the guard of `settleBatch()`
   * asks for `sealed_at`, so a batch whose first job finished while the
   * fortieth was still being enqueued does not call its callback early.
   *
   * @param {object} options Options
   * @param {string} options.id The batch id
   * @param {number} options.total How many jobs it holds
   * @param {number} options.now The current time
   * @returns {Promise<?object>} The batch, or null when it was sealed
   *   already (or is gone)
   * @memberof SqlStore
   */
  async sealBatch({ id, total, now }) {
    await this.run(
      `UPDATE ${this.tables.batches} SET total = ?, sealed_at = ?, updated_at = ? WHERE id = ? AND sealed_at IS NULL`,
      [total, now, now, id]
    );

    const row = await this.findBatch(id);

    return row && toNumber(row.sealed_at) === now ? row : null;
  }

  /**
   * Counts one terminal outcome into its batch
   *
   * One statement, and it is the whole of the exactly-once claim:
   *
   * - `done = done + 1` is evaluated by the engine under its own row lock,
   *   so two runners finishing at the same instant make two increments and
   *   not one. It is never read into this process to be written back.
   * - the `EXISTS` is the guard: the job row has to still hold **this
   *   runner's claim token** and be terminal, which is true only of the
   *   runner whose token-guarded outcome write landed. A runner that was
   *   recovered from wrote nothing and counts nothing.
   * - `finished_at IS NULL` stops a batch that has already called its
   *   callback from counting anything more.
   *
   * @param {object} options Options
   * @param {string} options.id The batch id
   * @param {string} options.job The job that reached a terminal state
   * @param {string} options.token The claim token its outcome was written
   *   under
   * @param {boolean} options.failed Whether it died rather than finished
   * @param {number} options.now The current time
   * @returns {Promise<?object>} The batch as it is now, or null
   * @memberof SqlStore
   */
  async advanceBatch({ id, job, token, failed, now }) {
    await this.run(
      `UPDATE ${this.tables.batches} SET done = done + 1, failed = failed + ?, updated_at = ? WHERE id = ? AND finished_at IS NULL AND EXISTS (SELECT 1 FROM ${this.tables.jobs} WHERE id = ? AND batch_id = ? AND claim_token = ? AND state IN ('done', 'dead'))`,
      [failed ? 1 : 0, now, id, job, id, token]
    );

    return this.findBatch(id);
  }

  /**
   * Gives a batch its slot back, when a job of it is put back in the queue
   *
   * A dead job that is retried will reach a terminal state a second time
   * and count a second time, which would take `done` past what the batch
   * holds. A finished batch never moves again, which is what the guard
   * says.
   *
   * @param {object} options Options
   * @param {string} options.id The batch id
   * @param {boolean} options.failed Whether the job was in the dead letter
   *   queue
   * @param {number} options.now The current time
   * @returns {Promise<void>} Resolves when written
   * @memberof SqlStore
   */
  async releaseBatch({ id, failed, now }) {
    await this.run(
      `UPDATE ${this.tables.batches} SET done = done - 1, failed = ${failed ? 'failed - 1' : 'failed'}, updated_at = ? WHERE id = ? AND finished_at IS NULL AND done > 0`,
      [now, id]
    );
  }

  /**
   * Says a batch has finished, and what enqueued its callback
   *
   * The callback is enqueued *before* this is written, so a process that
   * dies in between leaves the batch unfinished and the next sweep settles
   * it again -- the enqueue is idempotent (`../keys.js`).
   *
   * @param {object} options Options
   * @param {string} options.id The batch id
   * @param {?string} options.callback The id of the callback job
   * @param {number} options.now The current time
   * @returns {Promise<void>} Resolves when written
   * @memberof SqlStore
   */
  async finishBatch({ id, callback, now }) {
    await this.run(
      `UPDATE ${this.tables.batches} SET finished_at = ?, callback_id = ?, updated_at = ? WHERE id = ? AND finished_at IS NULL`,
      [now, callback || null, now, id]
    );
  }

  /**
   * What a batch's jobs actually say, read from the queue itself
   *
   * The repair the sweep uses: a runner killed between writing an
   * outcome and counting it leaves a batch one short forever, and a job
   * buried by the recovery of a dead runner was never counted by anybody.
   * Counting the rows answers both.
   *
   * @param {string} id The batch id
   * @returns {Promise<object>} `{ done, failed }`
   * @memberof SqlStore
   */
  async countBatch(id) {
    const rows = await this.select(
      `SELECT state, COUNT(*) AS total FROM ${this.tables.jobs} WHERE batch_id = ? AND state IN ('done', 'dead') GROUP BY state`,
      [id]
    );
    const counted = { done: 0, failed: 0 };

    for (const row of rows) {
      const total = toNumber(row.total) || 0;

      counted.done += total;

      if (row.state === 'dead') {
        counted.failed += total;
      }
    }

    return counted;
  }

  /**
   * Moves a batch's counters up to what its jobs say
   *
   * Only ever **forward**: a job pruned after it finished is a row that is
   * no longer counted, and a batch must not walk backwards over one.
   *
   * @param {object} options Options
   * @param {string} options.id The batch id
   * @param {number} options.done How many jobs are terminal
   * @param {number} options.failed How many of them died
   * @param {number} options.now The current time
   * @returns {Promise<?object>} The batch as it is now
   * @memberof SqlStore
   */
  async syncBatch({ id, done, failed, now }) {
    await this.run(
      `UPDATE ${this.tables.batches} SET done = ?, failed = ?, updated_at = ? WHERE id = ? AND finished_at IS NULL AND done < ?`,
      [done, failed, now, id, done]
    );

    return this.findBatch(id);
  }

  /**
   * The batches that were sealed and have not finished
   *
   * @param {object} options Options
   * @param {number} options.before Only those untouched since that moment
   * @param {number} [options.limit=50] How many at most
   * @returns {Promise<Array<object>>} The rows
   * @memberof SqlStore
   */
  async openBatches({ before, limit = 50 }) {
    const page =
      this.dialect === 'mssql'
        ? 'ORDER BY updated_at ASC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY'
        : 'ORDER BY updated_at ASC LIMIT ?';

    return this.select(
      `SELECT * FROM ${this.tables.batches} WHERE finished_at IS NULL AND sealed_at IS NOT NULL AND updated_at < ? ${page}`,
      [before, Math.max(1, Number(limit) || 50)]
    );
  }

  /**
   * Lists batches, the ones still running first
   *
   * @param {object} [options={}] `finished`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The rows
   * @memberof SqlStore
   */
  async listBatches({ finished, limit = 50, offset = 0 } = {}) {
    const rows = Math.max(1, Number(limit) || 50);
    const from = Math.max(0, Number(offset) || 0);
    const filter =
      typeof finished === 'boolean'
        ? `WHERE finished_at IS ${finished ? 'NOT NULL' : 'NULL'}`
        : '';
    const page =
      this.dialect === 'mssql'
        ? 'OFFSET ? ROWS FETCH NEXT ? ROWS ONLY'
        : 'LIMIT ? OFFSET ?';
    const paging = this.dialect === 'mssql' ? [from, rows] : [rows, from];

    return this.select(
      `SELECT * FROM ${this.tables.batches} ${filter} ORDER BY created_at DESC, id ASC ${page}`,
      paging
    );
  }

  /**
   * Forgets a batch
   *
   * @param {string} id The batch id
   * @returns {Promise<boolean>} Whether there was one
   * @memberof SqlStore
   */
  async removeBatch(id) {
    if (!(await this.findBatch(id))) {
      return false;
    }

    await this.run(`DELETE FROM ${this.tables.batches} WHERE id = ?`, [id]);

    return true;
  }

  /**
   * Deletes the batches that finished before a moment
   *
   * @param {number} before A timestamp
   * @param {number} [limit=1000] How many one pass deletes
   * @returns {Promise<number>} How many were deleted
   * @memberof SqlStore
   */
  async pruneBatches(before, limit = 1000) {
    const page =
      this.dialect === 'mssql'
        ? 'ORDER BY finished_at ASC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY'
        : 'ORDER BY finished_at ASC LIMIT ?';
    const rows = await this.select(
      `SELECT id FROM ${this.tables.batches} WHERE finished_at IS NOT NULL AND finished_at < ? ${page}`,
      [before, limit]
    );

    if (rows.length === 0) {
      return 0;
    }

    const ids = rows.map((row) => row.id);

    await this.run(
      `DELETE FROM ${this.tables.batches} WHERE id IN (${marks(ids)})`,
      ids
    );

    return ids.length;
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
  BATCH_COLUMNS,
  COLUMNS,
  DUPLICATE,
  HISTORY_LIMIT,
  SqlStore,
  create,
  describe,
  reasons,
  toNumber,
};
