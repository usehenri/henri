const path = require('path');
const { randomUUID } = require('crypto');
const debug = require('debug')('henri:jobs');

const { JobError, JobStoreError, JobTimeoutError } = require('./errors');
const { deserialize, serialize } = require('./serialize');
const { callback: callbackKey, keep } = require('./keys');
const { duration, iso, runAt } = require('./duration');
const { keyOf, load, validate } = require('./definitions');
const { normalize, recurring } = require('./config');
const { storeFor } = require('./store');
const { toNumber, HISTORY_LIMIT } = require('./store/sql');
const { Batch, declaration, toBatch } = require('./batch');

/** The states a job goes through */
const STATES = ['pending', 'running', 'done', 'dead'];

/**
 * The name of the job that sends a mail `deliverLater()` handed over.
 *
 * `henri.mailers` renders the message before it hands it to the queue, so
 * the job is one line: the runner needs neither the models nor a view
 * engine. An application that wants its own (tracking, a different
 * transport) writes `app/jobs/henri/mail.js` and it wins over this one.
 */
const MAIL_JOB = 'henri/mail';

/**
 * The name of the job that sweeps what the models say they keep.
 *
 * Retention lives in core (`base/retention.js`) and needs nothing
 * installed; this is the queue's half of it, so an application that has
 * `@usehenri/jobs` gets the recurring sweep for free and one that does not
 * runs `henri retention:sweep` from cron. Like the mail job, an application
 * that wants its own writes `app/jobs/henri/retention.js`.
 */
const RETENTION_JOB = 'henri/retention';

/** A moment, as the API hands it out */
const at = iso;

/**
 * A stored row, as the API hands it out
 *
 * @param {?object} row A row of the queue
 * @returns {?object} The job
 */
const toJob = (row) => {
  if (!row) {
    return null;
  }

  const message = row.error_message || null;

  return {
    args: deserialize(row.args),
    attempts: toNumber(row.attempts) || 0,
    batchId: row.batch_id || null,
    claimedAt: at(row.claimed_at),
    claimedBy: row.claimed_by || null,
    concurrencyKey: row.concurrency_key || null,
    createdAt: at(row.created_at),
    duration: toNumber(row.duration_ms),
    error: message ? { message, stack: row.error_stack || null } : null,
    finishedAt: at(row.finished_at),
    history: deserialize(row.history) || [],
    id: row.id,
    maxAttempts: toNumber(row.max_attempts) || 0,
    name: row.name,
    priority: toNumber(row.priority) || 0,
    queue: row.queue,
    runAt: at(row.run_at),
    startedAt: at(row.started_at),
    state: row.state,
    timeout: toNumber(row.timeout_ms),
    uniqueKey: row.unique_key || null,
    updatedAt: at(row.updated_at),
  };
};

/**
 * The queue.
 *
 * This is what an application sees as `henri.jobs`: enqueue from a
 * controller, a model hook, another job or the console, look at what the
 * queue holds, and drive the dead letter queue. Performing the jobs is the
 * runner's business (`henri jobs`), never the web process's.
 *
 * @class Jobs
 */
class Jobs {
  /**
   * Creates an instance of Jobs.
   *
   * @param {object} henri The henri instance
   * @param {object} [options={}] Options
   * @param {object} [options.config] The `jobs` block of the configuration
   * @param {string} [options.cwd] The application directory
   * @param {object} [options.adapter] The store adapter, when it is not
   *   taken from `henri.model`
   * @memberof Jobs
   */
  constructor(henri, options = {}) {
    this.henri = henri;
    this.pen = (henri && henri.pen) || null;
    this.cwd =
      options.cwd || (henri && henri.cwd ? henri.cwd() : process.cwd());
    this.config = normalize(options.config || {});
    this.adapter = options.adapter || null;
    this.ownsAdapter = false;
    this.store = null;
    this.definitions = {};
    this.started = false;
    this.runners = new Set();
    /** Whether the store can hold a concurrency key; see start() */
    this.concurrent = false;
    /** Whether the store can hold a batch; see start() */
    this.batched = false;

    /**
     * The retry policy of a job whose file this runner does not have: the
     * queue's own, so an unknown name is retried rather than buried
     */
    this.unknown = { backoff: this.config.backoff, name: null };

    this.dead = {
      count: () => this.count({ state: 'dead' }),
      discard: (id) => this.discard(id),
      discardAll: (filter) => this.discardAll(filter),
      get: (id) => this.get(id),
      list: (filter) => this.list({ ...filter, state: 'dead' }),
      retry: (id, opts) => this.retry(id, opts),
      retryAll: (filter, opts) => this.retryAll(filter, opts),
    };

    /** Reading the batches back; `batch()` is what makes one */
    this.batches = {
      discard: (id) => this.discardBatch(id),
      get: (id) => this.getBatch(id),
      jobs: (id, filter) => this.list({ ...(filter || {}), batch: id }),
      list: (filter) => this.listBatches(filter),
    };
  }

  /**
   * Says something, when there is a pen to say it with
   *
   * @param {string} level info, warn or error
   * @param {...*} args What to say
   * @returns {void}
   * @memberof Jobs
   */
  log(level, ...args) {
    if (this.pen && typeof this.pen[level] === 'function') {
      this.pen[level]('jobs', ...args);
    }
  }

  /**
   * Loads `app/jobs` and prepares the tables
   *
   * @param {object} [options={}] Options
   * @param {boolean} [options.install] Create the tables (defaults to the
   *   `jobs.install` configuration)
   * @returns {Promise<Jobs>} This queue
   * @throws {JobError} When a job file or the store is unusable
   * @memberof Jobs
   */
  async start(options = {}) {
    this.definitions = {
      ...this.builtins(),
      ...load(path.join(this.cwd, 'app', 'jobs'), this.config),
    };

    const adapter = this.resolveAdapter();

    // An application may have a queue and no model at all: the store of the
    // configuration is then built here, and nobody has connected it yet
    if (this.ownsAdapter) {
      await adapter.start();
    }

    this.store = storeFor(adapter, this.config.tables);

    const install =
      typeof options.install === 'boolean'
        ? options.install
        : this.config.install;

    if (install) {
      try {
        await this.store.install();
      } catch (error) {
        throw new JobStoreError(
          `@usehenri/jobs: unable to create the queue tables in the "${this.config.store}" store: ${error.message}`,
          {
            cause: error,
            hint: 'Run `henri jobs:install` once with a user that may create tables, then set "install": false in the jobs configuration',
          }
        );
      }
    }

    this.concurrent = await this.store.concurrent();
    this.batched = await this.store.batched();

    const bounded = Object.values(this.definitions).filter(
      (definition) => definition.concurrency
    );

    this.conflicts(bounded);

    if (bounded.length > 0 && !this.concurrent) {
      throw new JobError(
        'HENRI_JOB_LIMIT_UNINSTALLED',
        `@usehenri/jobs: ${bounded.map((one) => one.name).join(', ')} declare a concurrency limit, and the "${this.config.store}" store has no ${this.config.tables.jobs}.concurrency_key column to hold it`,
        {
          hint: 'Run `henri jobs:install` once with a user that may alter the table; the queue itself keeps working without it, and the limit would not',
        }
      );
    }

    this.started = true;

    const missing = this.config.recurring
      .filter((entry) => !this.definitions[entry.job])
      .map((entry) => `${entry.name} -> ${entry.job}`);

    if (missing.length > 0) {
      this.log(
        'warn',
        'recurring schedules naming a job that is not in app/jobs, skipped:',
        missing.join(', ')
      );
    }

    debug('started with %d job(s)', Object.keys(this.definitions).length);

    return this;
  }

  /**
   * The jobs the package ships with, which `app/jobs` may override
   *
   * @returns {object} The definitions, by name
   * @memberof Jobs
   */
  builtins() {
    return {
      [MAIL_JOB]: validate(
        MAIL_JOB,
        {
          /**
           * Sends a message `henri.mailers.deliverLater()` rendered
           *
           * @param {object} message A nodemailer payload
           * @param {object} context The job context
           * @returns {Promise<object>} nodemailer's info
           */
          perform: (message, context) => context.henri.mail.send(message),
          queue: this.config.mailQueue,
        },
        this.config
      ),
      [RETENTION_JOB]: validate(
        RETENTION_JOB,
        {
          /**
           * Sweeps the retention rules of the models
           *
           * @param {object} args What the schedule carries (`only`)
           * @param {object} context The job context
           * @returns {Promise<object>} The receipt of the sweep
           */
          perform: (args, context) =>
            context.henri.retention.sweep({
              ...(args || {}),
              source: 'job',
            }),
        },
        this.config
      ),
    };
  }

  /**
   * Refuses two jobs that share a group and disagree on its limit
   *
   * A group is a plain string declared in a file, so this is knowable at
   * boot -- and it has to be answered there, because the two jobs would
   * otherwise take slots of the same key counting to different numbers and
   * the bound would be whichever of them asked last.
   *
   * @param {Array<object>} bounded The definitions that declare a limit
   * @returns {void}
   * @throws {JobError} HENRI_JOB_CONCURRENCY_CONFLICT when two disagree
   * @memberof Jobs
   */
  conflicts(bounded) {
    const limits = new Map();

    for (const definition of bounded) {
      const { group, limit } = definition.concurrency;
      const first = limits.get(group);

      if (first && first.limit !== limit) {
        throw new JobError(
          'HENRI_JOB_CONCURRENCY_CONFLICT',
          `The jobs "${first.name}" and "${definition.name}" share the concurrency group "${group}" and ask for different limits (${first.limit} and ${limit})`,
          {
            hint: 'Jobs that share a group share one bound: give them the same limit, or a group each',
            job: definition.name,
          }
        );
      }

      if (!first) {
        limits.set(group, { limit, name: definition.name });
      }
    }
  }

  /**
   * The jobs that declare a concurrency limit, by group
   *
   * The runner asks for this every tick: the names are what partitions the
   * claim into its two passes, and the groups are what says how many slots
   * a key has.
   *
   * @returns {object} `{ names, groups }`
   * @memberof Jobs
   */
  limited() {
    const groups = new Map();
    const names = [];

    for (const definition of Object.values(this.definitions)) {
      if (!definition.concurrency) {
        continue;
      }

      const { group, limit } = definition.concurrency;
      const entry = groups.get(group) || { limit, names: [] };

      entry.names.push(definition.name);
      groups.set(group, entry);
      names.push(definition.name);
    }

    return { groups, names: names.sort() };
  }

  /**
   * What a key with work waiting needs to be claimed from
   *
   * @param {object} entry `{ key, name }`, as the store's `waiting()` gives
   * @param {object} [bounded] What `limited()` answered, when the caller
   *   already has it (the runner asks once per tick, not once per key)
   * @returns {?object} `{ key, limit, names }`, or null when the job is gone
   * @memberof Jobs
   */
  bucket(entry, bounded = this.limited()) {
    const definition = this.definitions[entry.name];

    if (!definition || !definition.concurrency) {
      return null;
    }

    const { group, limit } = definition.concurrency;
    const value = entry.key || group;
    const held = bounded.groups.get(group);

    return {
      key: { own: value === group, value },
      limit,
      names: held ? held.names : [definition.name],
    };
  }

  /**
   * Adds a recurring schedule the configuration did not write.
   *
   * This is how a framework module asks for something to happen on a
   * schedule without an application having to copy a cron expression into
   * `config.jobs.recurring` (`henri.retention` is the one that does). An
   * entry the application declared under the same name wins: what is in
   * `config/<env>.json` is never quietly replaced.
   *
   * @param {string} name The name of the schedule
   * @param {object} entry `cron` or `every`, plus `job`, `args`, `queue`
   * @returns {boolean} false when the configuration already names it
   * @throws {Error} HENRI_JOB_INVALID_SCHEDULE on an unreadable expression
   * @memberof Jobs
   */
  recur(name, entry) {
    if (this.config.recurring.some((schedule) => schedule.name === name)) {
      return false;
    }

    this.config.recurring.push(recurring(name, entry));
    this.config.recurring.sort((one, other) =>
      one.name.localeCompare(other.name)
    );

    return true;
  }

  /**
   * Adds a job the application did not write
   *
   * A package that ships work of its own -- `@usehenri/webhooks` delivers a
   * webhook this way -- registers its job here rather than asking the
   * application to write a file that would only forward the call. The queue
   * then has it wherever it is booted, the runner included, because the
   * module that registers it runs at the same runlevel.
   *
   * A definition that came from `app/jobs` is never replaced: an
   * application that wants its own `henri/webhook` writes
   * `app/jobs/henri/webhook.js` and it wins, exactly as it does for
   * `henri/mail`.
   *
   * @param {string} name The job name
   * @param {object} definition `perform(args, context)` plus `queue`,
   *   `priority`, `maxAttempts`, `timeout` and `backoff`
   * @returns {boolean} Whether it was registered
   * @throws {JobError} HENRI_JOB_INVALID_DEFINITION without a `perform`
   * @memberof Jobs
   */
  define(name, definition) {
    if (this.definitions[name]) {
      debug('%s is already defined: keeping the one that is there', name);

      return false;
    }

    this.definitions[name] = validate(name, definition, this.config);

    return true;
  }

  /**
   * Stops every runner this queue started
   *
   * @returns {Promise<void>} Resolves when they are done
   * @memberof Jobs
   */
  async stop() {
    await Promise.all([...this.runners].map((runner) => runner.stop()));
    this.runners.clear();
    this.started = false;
  }

  /**
   * The store adapter backing the queue
   *
   * @returns {object} A henri store adapter
   * @throws {JobError} NO_STORE when the store is unknown
   * @memberof Jobs
   */
  resolveAdapter() {
    if (this.adapter) {
      return this.adapter;
    }

    const model = this.henri && this.henri.model;
    const stores = (model && model.stores) || {};
    const name = this.config.store;

    if (stores[name]) {
      return stores[name];
    }

    if (model && typeof model.getStore === 'function') {
      // A store no model uses has not been built yet; the model module keeps
      // it from here on, so it is stopped with the others
      let store = null;

      try {
        store = model.getStore(name);
      } catch (error) {
        debug('store %s cannot be built: %s', name, error.message);
      }

      if (store) {
        this.ownsAdapter = true;

        return store;
      }
    }

    throw new JobError(
      'HENRI_JOB_STORE_MISSING',
      `@usehenri/jobs: no store named "${name}" in the configuration`,
      { hint: 'Set jobs.store to one of the stores of config/default.json' }
    );
  }

  /**
   * The definition of a job
   *
   * @param {string} name The job name
   * @returns {object} The definition
   * @throws {JobError} HENRI_JOB_UNKNOWN when there is no such file
   * @memberof Jobs
   */
  definition(name) {
    const found = this.definitions[name];

    if (!found) {
      const known = Object.keys(this.definitions);

      throw new JobError('HENRI_JOB_UNKNOWN', `No job named "${name}"`, {
        hint:
          known.length > 0
            ? `The jobs of app/jobs are: ${known.join(', ')}`
            : 'Write one with: henri generate job <name>',
        job: name,
      });
    }

    return found;
  }

  /**
   * The names of the jobs of the application
   *
   * @returns {Array<string>} The job names
   * @memberof Jobs
   */
  names() {
    return Object.keys(this.definitions).sort();
  }

  /**
   * Enqueues a job
   *
   * Nothing runs here: the call writes one row and returns. A runner
   * (`henri jobs`) picks it up.
   *
   * @param {string} name The job name (its file under app/jobs)
   * @param {*} [args=null] What perform() receives; it has to survive JSON
   * @param {object} [options={}] Options
   * @param {(number|string)} [options.wait] Run it that much later (`'5m'`)
   * @param {(Date|string|number)} [options.at] Run it at that moment
   * @param {string} [options.queue] Another queue than the job's
   * @param {number} [options.priority] Lower goes first
   * @param {number} [options.maxAttempts] How many attempts before it dies
   * @param {(number|string)} [options.timeout] How long one attempt may take
   * @param {string} [options.unique] A key no other waiting job may hold
   * @param {string} [options.id] The id to give the job, so a caller racing
   *   another on the same `unique` key can tell whether it is the one that
   *   enqueued it (the recurring schedules use it)
   * @param {string} [options.batch] The batch to count it into; `batch()`
   *   is what makes one, and a batch that is sealed refuses
   * @returns {Promise<object>} The enqueued job
   * @throws {JobError} HENRI_JOB_UNKNOWN, or HENRI_JOB_INVALID_ARGUMENTS
   *   cannot be stored
   * @memberof Jobs
   */
  async perform(name, args = null, options = {}) {
    const definition = this.definition(name);

    if (options.batch) {
      await this.openBatch(options.batch);
    }

    // A job a package defined after the boot may declare a limit the store
    // has no column for; the enqueue is where that is caught, because
    // enqueuing it unbounded is the one answer that breaks the guarantee
    if (definition.concurrency && !this.concurrent) {
      throw new JobError(
        'HENRI_JOB_LIMIT_UNINSTALLED',
        `The job "${name}" declares a concurrency limit, and the "${this.config.store}" store has no ${this.config.tables.jobs}.concurrency_key column to hold it`,
        {
          hint: 'Run `henri jobs:install` once with a user that may alter the table',
          job: name,
        }
      );
    }

    const now = Date.now();
    const when = runAt(options, now);
    const row = {
      args: serialize(args, { maxBytes: this.config.maxArgsBytes }),
      attempts: 0,
      batch_id: options.batch || null,
      claim_token: null,
      claimed_at: null,
      claimed_by: null,
      concurrency_key: keyOf(definition, args),
      created_at: now,
      duration_ms: null,
      error_message: null,
      error_stack: null,
      finished_at: null,
      heartbeat_at: null,
      history: null,
      id: options.id || randomUUID(),
      max_attempts: Math.max(
        1,
        Number(options.maxAttempts) || definition.maxAttempts
      ),
      name,
      priority:
        typeof options.priority === 'number'
          ? options.priority
          : definition.priority,
      queue: options.queue || definition.queue,
      run_at: when,
      started_at: null,
      state: 'pending',
      timeout_ms: duration(options.timeout, definition.timeout),
      unique_key: options.unique || null,
      updated_at: now,
    };

    debug('enqueue %s on %s at %d', name, row.queue, when);

    return toJob(await this.storeOrDie().insert(row));
  }

  /**
   * Enqueues a job; the name `henri.mailers.onDeliverLater()` expects
   *
   * @param {string} name The job name
   * @param {*} [args=null] What perform() receives
   * @param {object} [options={}] The options of perform()
   * @returns {Promise<object>} The enqueued job
   * @memberof Jobs
   */
  async enqueue(name, args = null, options = {}) {
    return this.perform(name, args, options);
  }

  /**
   * Enqueues a job to run later
   *
   * @param {(number|string)} wait How long to wait (`'5m'`, `300000`)
   * @param {string} name The job name
   * @param {*} [args=null] What perform() receives
   * @param {object} [options={}] The options of perform()
   * @returns {Promise<object>} The enqueued job
   * @memberof Jobs
   */
  async performIn(wait, name, args = null, options = {}) {
    return this.perform(name, args, { ...options, at: null, wait });
  }

  /**
   * Enqueues a job to run at a given moment
   *
   * @param {(Date|string|number)} when The moment
   * @param {string} name The job name
   * @param {*} [args=null] What perform() receives
   * @param {object} [options={}] The options of perform()
   * @returns {Promise<object>} The enqueued job
   * @memberof Jobs
   */
  async performAt(when, name, args = null, options = {}) {
    return this.perform(name, args, { ...options, at: when });
  }

  /**
   * Performs a job right here, right now, without the queue
   *
   * Handy in a test or in the console; a request should enqueue instead.
   * The arguments go through the same serialization, so a payload the queue
   * would refuse is refused here too.
   *
   * @param {string} name The job name
   * @param {*} [args=null] What perform() receives
   * @returns {Promise<*>} What perform() returned
   * @throws {JobError} HENRI_JOB_UNKNOWN, or whatever the job threw
   * @memberof Jobs
   */
  async performNow(name, args = null) {
    const definition = this.definition(name);
    const payload = deserialize(
      serialize(args, { maxBytes: this.config.maxArgsBytes })
    );
    const controller = new AbortController();

    return definition.perform(payload, {
      henri: this.henri,
      job: {
        attempt: 1,
        id: randomUUID(),
        inline: true,
        maxAttempts: definition.maxAttempts,
        name,
        queue: definition.queue,
      },
      signal: controller.signal,
    });
  }

  /**
   * The store, once the queue is started
   *
   * @returns {object} The store backend
   * @throws {JobError} HENRI_JOB_QUEUE_NOT_STARTED before start()
   * @memberof Jobs
   */
  storeOrDie() {
    if (!this.store) {
      throw new JobError(
        'HENRI_JOB_QUEUE_NOT_STARTED',
        '@usehenri/jobs: the queue is not started',
        {
          hint: 'henri starts it for you; outside of henri, call await jobs.start()',
        }
      );
    }

    return this.store;
  }

  /**
   * One job
   *
   * @param {string} id The job id
   * @returns {Promise<?object>} The job, or null
   * @memberof Jobs
   */
  async get(id) {
    return toJob(await this.storeOrDie().find(id));
  }

  /**
   * The jobs of the queue, newest change first
   *
   * @param {object} [filter={}] `state`, `queue`, `name`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The jobs
   * @throws {JobError} HENRI_JOB_UNKNOWN_STATE for an unknown state
   * @memberof Jobs
   */
  async list(filter = {}) {
    if (filter.state && !STATES.includes(filter.state)) {
      throw new JobError(
        'HENRI_JOB_UNKNOWN_STATE',
        `No such state "${filter.state}"`,
        {
          hint: `The states are: ${STATES.join(', ')}`,
        }
      );
    }

    const rows = await this.storeOrDie().list(filter);

    return rows.map(toJob);
  }

  /**
   * How many jobs match a filter
   *
   * @param {object} [filter={}] `state` and `queue`
   * @returns {Promise<number>} The count
   * @memberof Jobs
   */
  async count(filter = {}) {
    const counts = await this.storeOrDie().counts();

    return counts
      .filter(
        (entry) =>
          (!filter.state || entry.state === filter.state) &&
          (!filter.queue || entry.queue === filter.queue)
      )
      .reduce((total, entry) => total + entry.total, 0);
  }

  /**
   * What the queue holds: counts by queue and state, how long the finished
   * jobs took, and how long the oldest job that is due has been waiting
   *
   * @returns {Promise<object>} `{ totals, queues, timings, jobs, runners }`
   * @memberof Jobs
   */
  async stats() {
    const store = this.storeOrDie();
    const now = Date.now();
    const [counts, timings, oldest] = await Promise.all([
      store.counts(),
      store.timings(),
      store.oldest(now),
    ]);
    const totals = { dead: 0, done: 0, pending: 0, running: 0 };
    const byQueue = new Map();

    for (const entry of counts) {
      const queue = byQueue.get(entry.queue) || {
        dead: 0,
        done: 0,
        pending: 0,
        queue: entry.queue,
        running: 0,
        waiting: 0,
      };

      queue[entry.state] = entry.total;
      totals[entry.state] = (totals[entry.state] || 0) + entry.total;
      byQueue.set(entry.queue, queue);
    }

    for (const entry of oldest) {
      const queue = byQueue.get(entry.queue);

      if (queue) {
        queue.waiting = entry.waiting;
      }
    }

    return {
      jobs: this.names(),
      queues: [...byQueue.values()].sort((left, right) =>
        left.queue.localeCompare(right.queue)
      ),
      timings: timings.sort((left, right) =>
        left.queue.localeCompare(right.queue)
      ),
      totals,
    };
  }

  /**
   * What the concurrency limits are, and which of their slots are held
   *
   * The pair an operator needs and no log line carries: what the
   * application asked for, and what is holding it up right now. It carries
   * job ids and runner names and no arguments -- what a job was given is
   * the application's data, and `henri jobs:show <id>` is where it is read
   * by somebody who may.
   *
   * @returns {Promise<object>} `{ declared, held }`
   * @memberof Jobs
   */
  async limits() {
    const declared = Object.values(this.definitions)
      .filter((definition) => definition.concurrency)
      .map((definition) => ({
        group: definition.concurrency.group,
        job: definition.name,
        keyed: Boolean(definition.concurrency.key),
        limit: definition.concurrency.limit,
      }))
      .sort((one, other) => one.job.localeCompare(other.job));
    const held = this.concurrent ? await this.storeOrDie().slots() : [];

    return { declared, held };
  }

  /**
   * Refuses to store a batch this store has nowhere to put it
   *
   * The concurrency limit's refusal, for the same reason and with the same
   * shape: the tables of the queue have no migration chain behind them, so
   * a new column and a new table arrive through the tolerated upgrade block
   * of the install -- and what decides at runtime is asking the table.
   * Running a batch that counts nothing would be worse than refusing it.
   *
   * @returns {object} The store
   * @throws {JobError} HENRI_JOB_BATCH_UNINSTALLED
   * @memberof Jobs
   */
  batchable() {
    if (!this.batched) {
      throw new JobError(
        'HENRI_JOB_BATCH_UNINSTALLED',
        `The "${this.config.store}" store has no ${this.config.tables.batches} table (or no ${this.config.tables.jobs}.batch_id column) to hold a batch`,
        {
          hint: 'Run `henri jobs:install` once with a user that may create a table and alter one; the queue itself keeps working without it, and a batch would not',
        }
      );
    }

    return this.storeOrDie();
  }

  /**
   * The batch a job may still be added to
   *
   * Asked of the table rather than of the handle: "adding a job to a batch
   * that has finished is refused" is a promise about the batch, not about
   * the object in this process's memory.
   *
   * @param {string} id The batch id
   * @returns {Promise<object>} The stored row
   * @throws {JobError} HENRI_JOB_BATCH_CLOSED when it is sealed or gone
   * @memberof Jobs
   */
  async openBatch(id) {
    const store = this.batchable();
    const row = await store.findBatch(id);

    if (!row || row.sealed_at) {
      throw new JobError(
        'HENRI_JOB_BATCH_CLOSED',
        row
          ? `The batch ${id} is closed: it holds ${toNumber(row.total)} job(s) and was sealed at ${at(row.sealed_at)}`
          : `There is no batch ${id}`,
        {
          batch: id,
          hint: 'A batch is built where it is created: add every job before it is sealed, or make another batch',
        }
      );
    }

    return row;
  }

  /**
   * Makes a batch: these jobs, and one that runs when they are all done
   *
   * The callback runs once every job of the batch has reached a terminal
   * state, `dead` included, and it is handed the counts under `batch` --
   * see `./batch.js` for the whole of the argument.
   *
   * @param {object} [options={}] Options
   * @param {string} [options.callback] The job to run when it finishes
   * @param {object} [options.args] The callback's own arguments; the counts
   *   are added to them under `batch`
   * @param {string} [options.name] A label, for `henri jobs:batches`
   * @param {Array} [options.jobs] The jobs, as `'name'`, `['name', args]`,
   *   `['name', args, options]` or `{ name, args, options }`
   * @param {string} [options.queue] The callback's queue; `priority`,
   *   `maxAttempts`, `timeout`, `wait` and `at` are read the same way
   * @param {function} [build] Adds the jobs itself, when there are too many
   *   to write out: it is given the batch and the batch is sealed when it
   *   resolves
   * @returns {Promise<Batch>} The batch, sealed unless it was given neither
   *   `jobs` nor a function
   * @throws {JobError} HENRI_JOB_BATCH_UNINSTALLED, HENRI_JOB_INVALID_BATCH
   *   or HENRI_JOB_UNKNOWN when the callback is not a job
   * @memberof Jobs
   */
  async batch(options = {}, build) {
    const store = this.batchable();
    const declared = declaration(options);

    if (declared.jobs && typeof build === 'function') {
      throw new JobError(
        'HENRI_JOB_INVALID_BATCH',
        'The batch was given both a list of jobs and a function to add them',
        { hint: 'Pass `jobs`, or a function, and not both' }
      );
    }

    // A callback nothing answers to is refused here rather than when the
    // last job of the batch finishes, which is minutes later and elsewhere
    if (declared.callback) {
      this.definition(declared.callback);
    }

    const now = Date.now();
    const row = await store.createBatch({
      callback: declared.callback,
      callback_args: serialize(declared.args, {
        maxBytes: this.config.maxArgsBytes,
      }),
      callback_id: null,
      callback_options: JSON.stringify(declared.options),
      created_at: now,
      done: 0,
      failed: 0,
      finished_at: null,
      id: randomUUID(),
      name: declared.name,
      sealed_at: null,
      total: 0,
      updated_at: now,
    });
    const batch = new Batch(this, row);

    debug('batch %s -> %s', batch.id, declared.callback || 'no callback');

    // A list, even an empty one, is a batch that says what it holds: it is
    // sealed here and now. No list at all leaves it open for the caller
    if (declared.jobs) {
      await batch.addAll(declared.jobs);

      return batch.seal();
    }

    if (typeof build === 'function') {
      // A builder that throws leaves the batch unsealed on purpose: its
      // jobs run, its callback never does, and `henri jobs:batches` shows
      // it. Sealing what an application abandoned half way through would
      // call the callback for a batch that was never a batch
      await build(batch);

      return batch.seal();
    }

    return batch;
  }

  /**
   * One batch
   *
   * @param {string} id The batch id
   * @returns {Promise<?object>} The batch, or null
   * @memberof Jobs
   */
  async getBatch(id) {
    return toBatch(await this.batchable().findBatch(id));
  }

  /**
   * The batches of the queue, the newest first
   *
   * @param {object} [filter={}] `finished`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The batches
   * @memberof Jobs
   */
  async listBatches(filter = {}) {
    const rows = await this.batchable().listBatches(filter);

    return rows.map(toBatch);
  }

  /**
   * Forgets a batch, leaving its jobs alone
   *
   * The way out of a batch that can never finish because one of its jobs
   * was discarded: what is left of it counts against nothing.
   *
   * @param {string} id The batch id
   * @returns {Promise<boolean>} Whether there was one to forget
   * @memberof Jobs
   */
  async discardBatch(id) {
    return this.batchable().removeBatch(id);
  }

  /**
   * Counts one terminal outcome into the batch of a job, and settles it
   *
   * @param {object} row The row whose outcome was just written
   * @param {object} [options={}] `failed`, whether it died
   * @returns {Promise<?object>} The batch, when this outcome finished it
   * @memberof Jobs
   */
  async advance(row, options = {}) {
    if (!row.batch_id || !this.batched) {
      return null;
    }

    try {
      const batch = await this.storeOrDie().advanceBatch({
        failed: Boolean(options.failed),
        id: row.batch_id,
        job: row.id,
        now: Date.now(),
        token: row.claim_token,
      });

      return await this.settle(batch);
    } catch (error) {
      // Never fail an attempt whose outcome is already written over the
      // bookkeeping of its batch: the sweep settles what this missed
      this.log(
        'warn',
        row.name,
        row.id,
        `could not count into the batch ${row.batch_id}:`,
        error.message
      );
      debug('%O', error);

      return null;
    }
  }

  /**
   * Enqueues the callback of a batch whose jobs are all terminal
   *
   * Idempotent, and that is the point: the callback is enqueued under a
   * unique key of the batch's own (`./keys.js`), so a second settle -- from
   * another runner, or from the sweep after a runner was killed between
   * writing an outcome and counting it -- answers the job that is already
   * in the queue instead of enqueuing a second one. The batch is stamped
   * finished **after** the enqueue, so that gap is what the sweep repairs.
   *
   * @param {?object} row A batch row
   * @returns {Promise<?object>} The batch, when this call finished it
   * @memberof Jobs
   */
  async settle(row) {
    if (!row || !row.sealed_at || row.finished_at) {
      return null;
    }

    const store = this.storeOrDie();
    const total = toNumber(row.total) || 0;
    const done = toNumber(row.done) || 0;

    if (done < total) {
      return null;
    }

    const failed = toNumber(row.failed) || 0;
    const counts = {
      done,
      failed,
      id: row.id,
      name: row.name || null,
      succeeded: Math.max(0, done - failed),
      total,
    };
    let job = null;

    if (row.callback) {
      const options = deserialize(row.callback_options) || {};

      // The unique key is the arbiter and the id is not: two runners
      // settling at once send the same insert, and the one the index
      // refuses is answered with the job the other one enqueued -- which
      // `insert()` only does for a row it did not write itself
      job = await this.perform(
        row.callback,
        { ...(deserialize(row.callback_args) || {}), batch: counts },
        { ...options, unique: callbackKey(row.id) }
      );
    }

    await store.finishBatch({
      callback: job && job.id,
      id: row.id,
      now: Date.now(),
    });

    this.log(
      'info',
      'batch',
      row.id,
      `finished: ${counts.succeeded} done, ${counts.failed} dead`,
      job ? `-> ${row.callback} ${job.id}` : '(no callback)'
    );

    return toBatch(await store.findBatch(row.id));
  }

  /**
   * Settles the batches nothing else will
   *
   * Two things leave a batch short of its total with every job of it
   * terminal, and one sweep answers both: a runner killed between writing
   * an outcome and counting it, and a job buried by the recovery of a dead
   * runner, whose outcome no attempt of anybody's ever wrote. Counting the
   * rows is what decides -- and it only ever moves a batch forward, so a
   * finished job pruned out of the table cannot undo one.
   *
   * @param {object} options Options
   * @param {number} options.before Only batches untouched since that moment
   * @param {number} [options.limit=50] How many one sweep looks at
   * @returns {Promise<Array<object>>} The batches this sweep finished
   * @memberof Jobs
   */
  async reconcile({ before, limit = 50 }) {
    if (!this.batched) {
      return [];
    }

    const store = this.storeOrDie();
    const open = await store.openBatches({ before, limit });
    const finished = [];

    for (const row of open) {
      const counted = await store.countBatch(row.id);
      const batch = await store.syncBatch({
        done: counted.done,
        failed: counted.failed,
        id: row.id,
        now: Date.now(),
      });
      const settled = await this.settle(batch);

      if (settled) {
        finished.push(settled);
      }
    }

    return finished;
  }

  /**
   * Puts a job back in its queue
   *
   * Its attempt count starts over, so the retry policy applies again. Works
   * on a dead job (the point of the dead letter queue) and on one that is
   * still waiting (it runs now).
   *
   * A job a runner is performing right now is refused: requeuing it would
   * hand the same work to a second runner.
   *
   * @param {string} id The job id
   * @param {object} [options={}] Options
   * @param {(number|string)} [options.wait] Run it that much later
   * @param {(Date|string|number)} [options.at] Run it at that moment
   * @returns {Promise<?object>} The job, or null when there is no such id
   * @throws {JobError} RUNNING when a runner is performing it
   * @memberof Jobs
   */
  async retry(id, options = {}) {
    const store = this.storeOrDie();
    const row = await store.find(id);

    if (!row) {
      return null;
    }

    if (row.state === 'running') {
      throw new JobError(
        'HENRI_JOB_RUNNING',
        `The job ${id} is being performed by ${row.claimed_by}`,
        {
          hint: 'Wait for it to finish, or for the runner that died on it to be recovered from (jobs.stuckAfter)',
        }
      );
    }

    const now = Date.now();

    // A job that was counted into a batch and is put back will reach a
    // terminal state a second time, so it gives its slot back first: a
    // batch that has already finished never moves again, which is what the
    // guard of releaseBatch() says
    if (row.batch_id && this.batched && row.state !== 'pending') {
      await store.releaseBatch({
        failed: row.state === 'dead',
        id: row.batch_id,
        now,
      });
    }

    await store.update(id, {
      attempts: 0,
      claim_token: null,
      claimed_at: null,
      claimed_by: null,
      duration_ms: null,
      finished_at: null,
      run_at: runAt(options, now),
      started_at: null,
      state: 'pending',
      updated_at: now,
    });

    return toJob(await store.find(id));
  }

  /**
   * Puts every job matching a filter back in its queue
   *
   * @param {object} [filter={}] `state` (dead by default), `queue`, `name`
   * @param {object} [options={}] The options of retry()
   * @returns {Promise<number>} How many jobs were requeued
   * @memberof Jobs
   */
  async retryAll(filter = {}, options = {}) {
    const jobs = await this.list({
      limit: filter.limit || 1000,
      ...filter,
      state: filter.state || 'dead',
    });

    for (const job of jobs) {
      await this.retry(job.id, options);
    }

    return jobs.length;
  }

  /**
   * Deletes a job for good
   *
   * @param {string} id The job id
   * @returns {Promise<boolean>} Whether there was one to delete
   * @memberof Jobs
   */
  async discard(id) {
    return (await this.storeOrDie().remove({ id })) > 0;
  }

  /**
   * Deletes every job matching a filter
   *
   * @param {object} [filter={}] `state` (dead by default), `queue`, `name`
   * @returns {Promise<number>} How many jobs were deleted
   * @memberof Jobs
   */
  async discardAll(filter = {}) {
    return this.storeOrDie().remove({
      ...filter,
      state: filter.state || 'dead',
    });
  }

  /**
   * How long to wait before the next attempt of a job
   *
   * @param {object} definition The job definition
   * @param {number} attempts How many attempts have been made
   * @returns {number} A delay in milliseconds
   * @memberof Jobs
   */
  backoff(definition, attempts) {
    const { base, factor, jitter, max } = definition.backoff;
    const delay = Math.min(
      base * Math.pow(factor, Math.max(0, attempts - 1)),
      max
    );

    if (jitter <= 0) {
      return Math.round(delay);
    }

    return Math.round(delay * (1 + (Math.random() * 2 - 1) * jitter));
  }

  /**
   * Performs one claimed row, inside a span when henri is tracing
   *
   * The span carries the job's name, its queue, its attempt and its id, and
   * nothing of its arguments: they are the application's data, and
   * `base/telemetry.js` in core is explicit that what leaves the process is
   * henri's own or an identifier that means nothing on its own. The dead
   * letter row already holds the arguments, durably, for whoever is allowed
   * to read them.
   *
   * It is a root span, not a child of whatever enqueued the job: the queue
   * carries no trace context on its rows, deliberately -- see the guide.
   *
   * A failed attempt is not a failed span: the queue catches the error
   * itself, retries it and, in the end, writes the row of the dead letter
   * queue that holds the arguments, every attempt and the stack. That row
   * is the durable record -- the same reason `base/reporting.js` gives for
   * not reporting a dead job -- and a second, thinner copy of it in a trace
   * backend would be one more thing to keep in step.
   *
   * @param {object} row A row this runner claimed
   * @param {object} [options={}] Options
   * @param {string} [options.runner] The runner id, for the logs
   * @returns {Promise<object>} `{ state, job, error }`
   * @memberof Jobs
   */
  run(row, options = {}) {
    const telemetry = this.henri && this.henri.telemetry;
    const perform = () => this.attempt(row, options);

    if (!telemetry || typeof telemetry.span !== 'function') {
      return perform();
    }

    return telemetry.span(
      `henri.job ${row.name}`,
      {
        attributes: {
          'henri.job.attempt': toNumber(row.attempts) || 1,
          'henri.job.id': row.id,
          'henri.job.name': row.name,
          'henri.job.queue': row.queue,
        },
        boundary: 'jobs',
        kind: 'consumer',
      },
      perform
    );
  }

  /**
   * Performs one claimed row and writes down what happened
   *
   * A job that throws goes back to its queue with an exponential backoff
   * until it runs out of attempts, and then to the dead letter queue with
   * its error, its stack and the history of every attempt.
   *
   * @param {object} row A row this runner claimed
   * @param {object} [options={}] Options
   * @param {string} [options.runner] The runner id, for the logs
   * @returns {Promise<object>} `{ state, job, error }`
   * @memberof Jobs
   */
  async attempt(row, options = {}) {
    const store = this.storeOrDie();
    const started = Date.now();
    const attempts = toNumber(row.attempts) || 1;
    const timeout = toNumber(row.timeout_ms);
    const controller = new AbortController();
    let definition;

    try {
      definition = this.definition(row.name);
    } catch (error) {
      // A runner that is older than the process that enqueued this does not
      // have the file yet: put the job back rather than kill it, so a
      // rolling deploy does not fill the dead letter queue
      return this.failed(row, error, {
        attempts,
        definition: this.unknown,
        duration: 0,
        store,
      });
    }

    let args;

    try {
      args = deserialize(row.args, { strict: true });
    } catch (error) {
      // Performing a job with `null` where its arguments should be is worse
      // than failing the attempt and saying so
      return this.failed(row, error, {
        attempts,
        definition,
        duration: 0,
        store,
      });
    }

    const context = {
      henri: this.henri,
      job: {
        args,
        attempt: attempts,
        enqueuedAt: at(row.created_at),
        id: row.id,
        maxAttempts: toNumber(row.max_attempts) || definition.maxAttempts,
        name: row.name,
        queue: row.queue,
        runner: options.runner || null,
      },
      signal: controller.signal,
    };

    try {
      await this.invoke(definition, context, controller, timeout);
    } catch (error) {
      return this.failed(row, error, {
        attempts,
        definition,
        duration: Date.now() - started,
        store,
      });
    }

    const finished = Date.now();

    await store.update(
      row.id,
      {
        // A job of a batch keeps the token of the claim that wrote this,
        // and that is what makes the counting exactly once: the batch is
        // advanced by the runner whose token is on the row, which is the
        // one whose outcome landed (see SqlStore#advanceBatch)
        claim_token: row.batch_id ? row.claim_token : null,
        duration_ms: finished - started,
        error_message: null,
        error_stack: null,
        finished_at: finished,
        state: 'done',
        // A finished job holds its unique key no longer, unless the queue
        // wrote it for itself (see ./keys.js)
        unique_key: keep(row.unique_key),
        updated_at: finished,
      },
      row.claim_token
    );

    const job = toJob(await store.find(row.id));

    this.lost(row, job);
    // The counter of a batch is advanced by the write above and by nothing
    // else: an outcome that was refused counts nothing (see advanceBatch)
    await this.advance(row, { failed: false });

    return { job, state: 'done' };
  }

  /**
   * Calls perform(), giving up after the job's timeout
   *
   * JavaScript cannot stop a function that is already running: the timeout
   * fails the attempt and aborts `context.signal`, so a job that watches the
   * signal stops on its own. One that does not keeps running until it
   * returns, and its result is ignored.
   *
   * @param {object} definition The job definition
   * @param {object} context What perform() receives as its second argument
   * @param {AbortController} controller The controller of `context.signal`
   * @param {?number} timeout The timeout in milliseconds
   * @returns {Promise<*>} What perform() returned
   * @throws {JobTimeoutError} When the attempt ran past its timeout
   * @memberof Jobs
   */
  async invoke(definition, context, controller, timeout) {
    const call = Promise.resolve().then(() =>
      definition.perform(context.job.args, context)
    );

    if (!timeout) {
      return call;
    }

    let timer = null;

    try {
      return await Promise.race([
        call,
        new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new JobTimeoutError(definition.name, timeout));
          }, timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      // The job may still be running: do not leave an unhandled rejection
      call.catch(() => null);
    }
  }

  /**
   * Records a failed attempt: back to the queue, or to the dead letter queue
   *
   * @param {object} row The row that failed
   * @param {Error} error What went wrong
   * @param {object} context `attempts`, `definition`, `duration` and `store`
   * @returns {Promise<object>} `{ state, job, error }`
   * @memberof Jobs
   */
  async failed(row, error, context) {
    const { attempts, definition, duration: took, store } = context;
    const now = Date.now();
    const max = toNumber(row.max_attempts) || this.config.maxAttempts;
    // A failure that says `retryable: false` is buried now rather than
    // after every attempt has learned the same thing: a webhook url that
    // resolves to a private address, a receiver that answered `410 Gone`, a
    // payload a remote API will refuse in exactly the same way in six
    // hours. The job is in the dead letter queue with its reason, which is
    // where an operator would have found it anyway -- sooner
    const permanent = Boolean(error) && error.retryable === false;
    const dead = attempts >= max || !definition || permanent;
    const history = (deserialize(row.history) || []).slice(-HISTORY_LIMIT + 1);
    const message = String((error && error.message) || error);

    history.push({
      at: new Date(now).toISOString(),
      attempt: attempts,
      duration: took,
      message,
      runner: row.claimed_by || null,
    });

    const wait = dead ? 0 : this.backoff(definition, attempts);

    await store.update(
      row.id,
      {
        // Kept on a terminal row of a batch, for the reason attempt()
        // gives; a failure that goes back to its queue is claimed again
        // and gets a token of its own
        claim_token: dead && row.batch_id ? row.claim_token : null,
        duration_ms: took,
        error_message: message,
        error_stack: (error && error.stack) || null,
        finished_at: dead ? now : null,
        history: JSON.stringify(history),
        run_at: dead ? toNumber(row.run_at) : now + wait,
        state: dead ? 'dead' : 'pending',
        // A dead job holds its unique key no longer: the same work may be
        // enqueued again while this one waits in the dead letter queue
        unique_key: dead ? keep(row.unique_key) : row.unique_key,
        updated_at: now,
      },
      row.claim_token
    );

    this.log(
      dead ? 'error' : 'warn',
      row.name,
      row.id,
      dead ? 'died after' : 'failed on attempt',
      `${attempts}/${max}`,
      permanent && attempts < max ? `(no retry) ${message}` : message
    );

    const job = toJob(await store.find(row.id));

    this.lost(row, job);

    // A batch counts what is terminal: an attempt going back to its queue
    // with a backoff is not an outcome, and the batch waits for it
    if (dead) {
      await this.advance(row, { failed: true });
    }

    return { error, job, state: dead ? 'dead' : 'pending' };
  }

  /**
   * Says so when the outcome of an attempt was refused
   *
   * The write only lands while the runner still owns the row. It does not
   * when the runner's heartbeat went stale and someone else took the job
   * back, which means the job is about to be performed twice: nothing is
   * lost, but it is worth a line in the log.
   *
   * @param {object} row The row this runner had claimed
   * @param {?object} job The job as it is now
   * @returns {boolean} Whether the outcome was refused
   * @memberof Jobs
   */
  lost(row, job) {
    if (!job || !row.claim_token || job.state !== 'running') {
      return false;
    }

    this.log(
      'warn',
      row.name,
      row.id,
      'was taken over while it was being performed; the outcome was dropped'
    );

    return true;
  }
}

module.exports = { Jobs, MAIL_JOB, RETENTION_JOB, STATES, toJob };
