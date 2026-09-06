const debug = require('debug')('henri:jobs:mongo');

const { JobStoreError } = require('../errors');
const { keep } = require('../keys');

/**
 * The MongoDB backend of the queue.
 *
 * ## Claiming
 *
 * MongoDB has no `SELECT ... FOR UPDATE`, but it does not need one here: a
 * single-document update is atomic, and `findOneAndUpdate` matches and
 * writes in that one operation. The filter carries `state: 'pending'`, so
 * two runners racing for the same document are resolved by the server --
 * one of them writes, the other one's filter no longer matches and it is
 * handed the next document instead. That is the same guarantee the SQL
 * backend gets from its single-statement claim, and it holds on a
 * standalone `mongod` (the `disk` adapter) as much as on a replica set, no
 * transaction involved.
 *
 * The cost is that documents are claimed one at a time rather than in a
 * batch: a runner asking for eight jobs makes eight round trips.
 *
 * Documents use the same field names as the SQL columns so the two backends
 * hand the queue the same rows.
 */

/** The collection is written with the SQL column names, on purpose */
const ID = 'id';

/**
 * The MongoDB store
 *
 * @class MongoStore
 */
class MongoStore {
  /**
   * Creates an instance of MongoStore.
   *
   * @param {object} adapter A henri mongoose (or disk) adapter
   * @param {object} tables `{ jobs, schedules }` collection names
   * @memberof MongoStore
   */
  constructor(adapter, tables) {
    this.adapter = adapter;
    this.tables = tables;
    this.dialect = 'mongodb';
    this.kind = 'mongo';
  }

  /**
   * The database of the store
   *
   * @returns {object} A MongoDB database
   * @throws {JobStoreError} When the store is not connected
   * @memberof MongoStore
   */
  database() {
    const connection =
      this.adapter.mongoose && this.adapter.mongoose.connection;

    if (!connection || connection.readyState !== 1 || !connection.db) {
      throw new JobStoreError(
        `@usehenri/jobs: the ${this.adapter.name} store is not connected`
      );
    }

    return connection.db;
  }

  /**
   * The jobs collection
   *
   * @returns {object} A MongoDB collection
   * @memberof MongoStore
   */
  jobs() {
    return this.database().collection(this.tables.jobs);
  }

  /**
   * The schedules collection
   *
   * @returns {object} A MongoDB collection
   * @memberof MongoStore
   */
  schedules() {
    return this.database().collection(this.tables.schedules);
  }

  /**
   * A document, as the queue reads rows
   *
   * @param {?object} document A stored document
   * @returns {?object} The row, or null
   * @memberof MongoStore
   */
  row(document) {
    if (!document) {
      return null;
    }

    const { _id, ...rest } = document;

    return { ...rest, [ID]: _id };
  }

  /**
   * Creates the collections and their indexes; idempotent
   *
   * @returns {Promise<Array<string>>} What was created
   * @memberof MongoStore
   */
  async install() {
    // The key order of a compound index decides which queries it serves:
    // these are index specifications, not objects to be sorted
    /* eslint-disable sort-keys */
    await this.index(
      { state: 1, queue: 1, priority: 1, run_at: 1 },
      { name: `${this.tables.jobs}_claim` }
    );
    await this.index(
      { state: 1, finished_at: 1 },
      { name: `${this.tables.jobs}_finished` }
    );
    /* eslint-enable sort-keys */
    // A partial index, not a sparse one: a sparse unique index still holds
    // every document whose `unique_key` is present and null, so the second
    // job without a unique key would be refused
    await this.index(
      { unique_key: 1 },
      {
        name: `${this.tables.jobs}_unique`,
        partialFilterExpression: { unique_key: { $type: 'string' } },
        unique: true,
      }
    );

    return [this.tables.jobs, this.tables.schedules];
  }

  /**
   * Creates an index, replacing one an older version left with other options
   *
   * @param {object} keys The index keys
   * @param {object} options The index options (`name` is required)
   * @returns {Promise<void>} Resolves when the index is there
   * @memberof MongoStore
   */
  async index(keys, options) {
    try {
      await this.jobs().createIndex(keys, options);
    } catch (error) {
      // IndexOptionsConflict / IndexKeySpecsConflict
      if (error.code !== 85 && error.code !== 86) {
        throw error;
      }

      debug('replacing the index %s', options.name);
      await this.jobs().dropIndex(options.name);
      await this.jobs().createIndex(keys, options);
    }
  }

  /**
   * Drops the collections
   *
   * @returns {Promise<Array<string>>} What was dropped
   * @memberof MongoStore
   */
  async uninstall() {
    for (const name of [this.tables.jobs, this.tables.schedules]) {
      await this.database()
        .collection(name)
        .drop()
        .catch(() => null);
    }

    return [this.tables.schedules, this.tables.jobs];
  }

  /**
   * Whether the collections can be read
   *
   * @returns {Promise<boolean>} true when the database answers
   * @memberof MongoStore
   */
  async installed() {
    try {
      await this.jobs().estimatedDocumentCount();

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Inserts a job
   *
   * @param {object} job A row
   * @returns {Promise<object>} The job, read back
   * @memberof MongoStore
   */
  async insert(job) {
    const { id, ...rest } = job;

    // A job without a unique key has no `unique_key` field at all, so the
    // partial unique index never sees it
    if (rest.unique_key === null || typeof rest.unique_key === 'undefined') {
      delete rest.unique_key;
    }

    try {
      await this.jobs().insertOne({ _id: id, ...rest });
    } catch (error) {
      // Only a duplicate key is answered with the job that holds it. Any
      // other failure is the caller's to see, or an enqueue would silently
      // do nothing
      if (job.unique_key && error.code === 11000) {
        const existing = await this.findByUniqueKey(job.unique_key);

        if (existing && existing.id !== id) {
          return existing;
        }
      }

      throw error;
    }

    return this.find(id);
  }

  /**
   * One job by id
   *
   * @param {string} id The job id
   * @returns {Promise<?object>} The row, or null
   * @memberof MongoStore
   */
  async find(id) {
    return this.row(await this.jobs().findOne({ _id: id }));
  }

  /**
   * One job by unique key
   *
   * @param {string} key The unique key
   * @returns {Promise<?object>} The row, or null
   * @memberof MongoStore
   */
  async findByUniqueKey(key) {
    return this.row(await this.jobs().findOne({ unique_key: key }));
  }

  /**
   * Claims up to `limit` jobs for this runner
   *
   * Every document is taken with one atomic `findOneAndUpdate`; the loop
   * stops as soon as there is nothing left to take.
   *
   * @param {object} options Options
   * @param {Array<string>} [options.queues=[]] The queues to take from
   * @param {number} [options.limit=1] How many jobs at most
   * @param {string} options.runner The runner id
   * @param {string} options.token A token unique to this claim
   * @param {number} options.now The current time
   * @returns {Promise<Array<object>>} The rows this runner owns
   * @memberof MongoStore
   */
  async claim({ queues = [], limit = 1, runner, token, now }) {
    // `includeResultMetadata: false` is the default of the v6+ driver and is
    // named here on purpose: under an older one findOneAndUpdate answers
    // `{ value }`, which would read as a win for every runner

    const filter = { run_at: { $lte: now }, state: 'pending' };
    const claimed = [];

    if (queues.length > 0) {
      filter.queue = { $in: queues };
    }

    for (let taken = 0; taken < limit; taken += 1) {
      const document = await this.jobs().findOneAndUpdate(
        filter,
        {
          $inc: { attempts: 1 },
          $set: {
            claim_token: token,
            claimed_at: now,
            claimed_by: runner,
            heartbeat_at: now,
            started_at: now,
            state: 'running',
            updated_at: now,
          },
        },
        {
          includeResultMetadata: false,
          returnDocument: 'after',
          // Ordered, like an ORDER BY
          // eslint-disable-next-line sort-keys
          sort: { priority: 1, run_at: 1, _id: 1 },
        }
      );

      if (!document) {
        break;
      }

      claimed.push(this.row(document));
    }

    debug('claimed %d job(s) for %s', claimed.length, runner);

    return claimed;
  }

  /**
   * Writes the outcome of an attempt
   *
   * With a token the write only lands while this runner still owns the
   * document, so a runner that was recovered from cannot write over the new
   * owner's outcome.
   *
   * @param {string} id The job id
   * @param {object} changes The fields to set
   * @param {string} [token] The claim token this runner holds
   * @returns {Promise<void>} Resolves when written
   * @memberof MongoStore
   */
  async update(id, changes, token) {
    if (Object.keys(changes).length === 0) {
      return;
    }

    const filter = token
      ? { _id: id, claim_token: token, state: 'running' }
      : { _id: id };

    await this.jobs().updateOne(filter, { $set: changes });
  }

  /**
   * Puts back the jobs of runners that stopped answering
   *
   * @param {object} options `now`, `stuckAfter` and `limit`
   * @returns {Promise<Array<object>>} The rows that were recovered
   * @memberof MongoStore
   */
  async recover({ now, stuckAfter, limit = 100 }) {
    const documents = await this.jobs()
      .find({ heartbeat_at: { $lt: now - stuckAfter }, state: 'running' })
      .sort({ heartbeat_at: 1 })
      .limit(limit)
      .toArray();
    const rows = documents.map((document) => this.row(document));

    for (const row of rows) {
      const dead = (row.attempts || 0) >= (row.max_attempts || 0);
      // A dead job holds its unique key no longer, unless the queue wrote it
      // for itself (see ../keys.js)
      const held = dead ? keep(row.unique_key) : row.unique_key;

      await this.jobs().updateOne(
        { _id: row.id, claim_token: row.claim_token, state: 'running' },
        {
          $set: {
            error_message: `the runner ${row.claimed_by} stopped answering while performing this job`,
            finished_at: dead ? now : null,
            run_at: now,
            state: dead ? 'dead' : 'pending',
            updated_at: now,
          },
          $unset: held
            ? { claim_token: '' }
            : { claim_token: '', unique_key: '' },
        }
      );
    }

    return rows;
  }

  /**
   * Tells the database this runner is still on these jobs
   *
   * A runner that was already recovered from no longer owns these documents,
   * so the token is part of the filter.
   *
   * @param {Array<string>} ids The job ids
   * @param {number} now The current time
   * @param {string} [token] The claim token this runner holds
   * @returns {Promise<void>} Resolves when written
   * @memberof MongoStore
   */
  async heartbeat(ids, now, token) {
    if (ids.length === 0) {
      return;
    }

    const filter = { _id: { $in: ids } };

    if (token) {
      filter.claim_token = token;
    }

    await this.jobs().updateMany(filter, { $set: { heartbeat_at: now } });
  }

  /**
   * Deletes the finished jobs older than a moment
   *
   * @param {number} before A timestamp
   * @param {number} [limit=1000] How many documents one pass deletes
   * @returns {Promise<number>} How many documents were deleted
   * @memberof MongoStore
   */
  async prune(before, limit = 1000) {
    const documents = await this.jobs()
      .find({ finished_at: { $lt: before }, state: 'done' })
      .sort({ finished_at: 1 })
      .limit(limit)
      .project({ _id: 1 })
      .toArray();

    if (documents.length === 0) {
      return 0;
    }

    const result = await this.jobs().deleteMany({
      _id: { $in: documents.map((document) => document._id) },
    });

    return result.deletedCount || 0;
  }

  /**
   * Lists jobs
   *
   * @param {object} [options={}] `state`, `queue`, `name`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The rows
   * @memberof MongoStore
   */
  async list({ state, queue, name, limit = 50, offset = 0 } = {}) {
    const filter = {};

    if (state) {
      filter.state = state;
    }

    if (queue) {
      filter.queue = queue;
    }

    if (name) {
      filter.name = name;
    }

    const documents = await this.jobs()
      .find(filter)
      // eslint-disable-next-line sort-keys
      .sort({ updated_at: -1, _id: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return documents.map((document) => this.row(document));
  }

  /**
   * Deletes jobs
   *
   * @param {object} [options={}] `id`, `state`, `queue`, `name`
   * @returns {Promise<number>} How many documents were deleted
   * @memberof MongoStore
   */
  async remove({ id, state, queue, name } = {}) {
    const filter = {};

    if (id) {
      filter._id = id;
    }

    if (state) {
      filter.state = state;
    }

    if (queue) {
      filter.queue = queue;
    }

    if (name) {
      filter.name = name;
    }

    if (Object.keys(filter).length === 0) {
      return 0;
    }

    const result = await this.jobs().deleteMany(filter);

    return result.deletedCount || 0;
  }

  /**
   * Counts the jobs of every queue and state
   *
   * @returns {Promise<Array<object>>} `{ queue, state, total }` rows
   * @memberof MongoStore
   */
  async counts() {
    const rows = await this.jobs()
      .aggregate([
        {
          $group: {
            _id: { queue: '$queue', state: '$state' },
            total: { $sum: 1 },
          },
        },
      ])
      .toArray();

    return rows.map((row) => ({
      queue: row._id.queue,
      state: row._id.state,
      total: row.total,
    }));
  }

  /**
   * How long the finished jobs of every queue took
   *
   * @returns {Promise<Array<object>>} `{ queue, runs, shortest, longest, average }` rows
   * @memberof MongoStore
   */
  async timings() {
    const rows = await this.jobs()
      .aggregate([
        { $match: { duration_ms: { $ne: null }, state: 'done' } },
        {
          $group: {
            _id: '$queue',
            average: { $avg: '$duration_ms' },
            longest: { $max: '$duration_ms' },
            runs: { $sum: 1 },
            shortest: { $min: '$duration_ms' },
          },
        },
      ])
      .toArray();

    return rows.map((row) => ({
      average: Math.round(row.average || 0),
      longest: row.longest || 0,
      queue: row._id,
      runs: row.runs || 0,
      shortest: row.shortest || 0,
    }));
  }

  /**
   * The moment the oldest job waiting in every queue was due
   *
   * @param {number} now The current time
   * @returns {Promise<Array<object>>} `{ queue, waiting }` rows
   * @memberof MongoStore
   */
  async oldest(now) {
    const rows = await this.jobs()
      .aggregate([
        { $match: { run_at: { $lte: now }, state: 'pending' } },
        { $group: { _id: '$queue', due: { $min: '$run_at' } } },
      ])
      .toArray();

    return rows.map((row) => ({
      queue: row._id,
      waiting: Math.max(0, now - (row.due || now)),
    }));
  }

  /**
   * The schedule of a recurring job
   *
   * @param {string} name The schedule name
   * @returns {Promise<?object>} The row, or null
   * @memberof MongoStore
   */
  async schedule(name) {
    const document = await this.schedules().findOne({ _id: name });

    return document ? { ...document, name: document._id } : null;
  }

  /**
   * Records a schedule that has none yet
   *
   * @param {object} row The schedule row
   * @returns {Promise<?object>} The schedule
   * @memberof MongoStore
   */
  async addSchedule(row) {
    const { name, ...rest } = row;

    try {
      await this.schedules().insertOne({
        _id: name,
        ...rest,
        last_run_at: null,
        token: null,
      });
    } catch (error) {
      // Another runner recording it first is the expected failure; anything
      // else is answered with null, and the runner says so
      debug('schedule %s not recorded (%s)', name, error.message);
    }

    return this.schedule(name).catch(() => null);
  }

  /**
   * Moves a schedule forward, if this runner is the one that got there first
   *
   * @param {object} options `name`, `spec`, `due`, `next`, `token`, `now`
   * @returns {Promise<boolean>} Whether this runner won the slot
   * @memberof MongoStore
   */
  async advanceSchedule({ name, spec, due, next, token, now }) {
    const document = await this.schedules().findOneAndUpdate(
      { _id: name, next_run_at: due },
      {
        $set: {
          last_run_at: due,
          next_run_at: next,
          spec,
          token,
          updated_at: now,
        },
      },
      { includeResultMetadata: false, returnDocument: 'after' }
    );

    return Boolean(document);
  }

  /**
   * Points a schedule at a new moment
   *
   * @param {object} options `name`, `spec`, `next` and `now`
   * @returns {Promise<void>} Resolves when written
   * @memberof MongoStore
   */
  async resetSchedule({ name, spec, next, now }) {
    await this.schedules().updateOne(
      { _id: name },
      { $set: { next_run_at: next, spec, updated_at: now } }
    );
  }

  /**
   * Forgets the schedules the configuration no longer declares
   *
   * @param {Array<string>} names The schedules to keep
   * @returns {Promise<void>} Resolves when done
   * @memberof MongoStore
   */
  async pruneSchedules(names) {
    await this.schedules().deleteMany({ _id: { $nin: names } });
  }
}

/**
 * Builds the MongoDB store of an adapter
 *
 * @param {object} adapter A henri mongoose (or disk) adapter
 * @param {object} tables `{ jobs, schedules }` collection names
 * @returns {MongoStore} The store
 */
const create = (adapter, tables) => new MongoStore(adapter, tables);

module.exports = { MongoStore, create };
