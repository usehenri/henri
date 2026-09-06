const path = require('path');
const { randomUUID } = require('crypto');
const debug = require('debug')('henri:jobs');

const { JobError, JobStoreError, JobTimeoutError } = require('./errors');
const { deserialize, serialize } = require('./serialize');
const { duration, runAt } = require('./duration');
const { load, validate } = require('./definitions');
const { normalize } = require('./config');
const { storeFor } = require('./store');
const { toNumber, HISTORY_LIMIT } = require('./store/sql');

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
 * A moment, as the API hands it out
 *
 * @param {*} value A timestamp in milliseconds
 * @returns {?string} An ISO string, or null
 */
const at = (value) => {
  const number = toNumber(value);

  return number === null ? null : new Date(number).toISOString();
};

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
    claimedAt: at(row.claimed_at),
    claimedBy: row.claimed_by || null,
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

    this.dead = {
      count: () => this.count({ state: 'dead' }),
      discard: (id) => this.discard(id),
      discardAll: (filter) => this.discardAll(filter),
      get: (id) => this.get(id),
      list: (filter) => this.list({ ...filter, state: 'dead' }),
      retry: (id, opts) => this.retry(id, opts),
      retryAll: (filter, opts) => this.retryAll(filter, opts),
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

    this.started = true;
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
    };
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
      const store = model.getStore(name);

      if (store) {
        this.ownsAdapter = true;

        return store;
      }
    }

    throw new JobError(
      'NO_STORE',
      `@usehenri/jobs: no store named "${name}" in the configuration`,
      { hint: 'Set jobs.store to one of the stores of config/default.json' }
    );
  }

  /**
   * The definition of a job
   *
   * @param {string} name The job name
   * @returns {object} The definition
   * @throws {JobError} UNKNOWN_JOB when there is no such file
   * @memberof Jobs
   */
  definition(name) {
    const found = this.definitions[name];

    if (!found) {
      const known = Object.keys(this.definitions);

      throw new JobError('UNKNOWN_JOB', `No job named "${name}"`, {
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
   * @returns {Promise<object>} The enqueued job
   * @throws {JobError} UNKNOWN_JOB, or BAD_ARGUMENTS when the arguments
   *   cannot be stored
   * @memberof Jobs
   */
  async perform(name, args = null, options = {}) {
    const definition = this.definition(name);
    const now = Date.now();
    const when = runAt(options, now);
    const row = {
      args: serialize(args, { maxBytes: this.config.maxArgsBytes }),
      attempts: 0,
      claim_token: null,
      claimed_at: null,
      claimed_by: null,
      created_at: now,
      duration_ms: null,
      error_message: null,
      error_stack: null,
      finished_at: null,
      heartbeat_at: null,
      history: null,
      id: randomUUID(),
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
   * @throws {JobError} UNKNOWN_JOB, or whatever the job threw
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
   * @throws {JobError} NOT_STARTED before start()
   * @memberof Jobs
   */
  storeOrDie() {
    if (!this.store) {
      throw new JobError(
        'NOT_STARTED',
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
   * @throws {JobError} BAD_STATE for a state that does not exist
   * @memberof Jobs
   */
  async list(filter = {}) {
    if (filter.state && !STATES.includes(filter.state)) {
      throw new JobError('BAD_STATE', `No such state "${filter.state}"`, {
        hint: `The states are: ${STATES.join(', ')}`,
      });
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
   * Puts a job back in its queue
   *
   * Its attempt count starts over, so the retry policy applies again. Works
   * on a dead job (the point of the dead letter queue) and on one that is
   * still waiting (it runs now).
   *
   * @param {string} id The job id
   * @param {object} [options={}] Options
   * @param {(number|string)} [options.wait] Run it that much later
   * @param {(Date|string|number)} [options.at] Run it at that moment
   * @returns {Promise<?object>} The job, or null when there is no such id
   * @memberof Jobs
   */
  async retry(id, options = {}) {
    const store = this.storeOrDie();
    const row = await store.find(id);

    if (!row) {
      return null;
    }

    const now = Date.now();

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
  async run(row, options = {}) {
    const store = this.storeOrDie();
    const started = Date.now();
    const attempts = toNumber(row.attempts) || 1;
    const timeout = toNumber(row.timeout_ms);
    const controller = new AbortController();
    let definition;

    try {
      definition = this.definition(row.name);
    } catch (error) {
      return this.failed(row, error, { attempts, duration: 0, store });
    }

    const context = {
      henri: this.henri,
      job: {
        args: deserialize(row.args),
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

    await store.update(row.id, {
      claim_token: null,
      duration_ms: finished - started,
      error_message: null,
      error_stack: null,
      finished_at: finished,
      state: 'done',
      updated_at: finished,
    });

    return { job: toJob(await store.find(row.id)), state: 'done' };
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
    const dead = attempts >= max || !definition;
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

    await store.update(row.id, {
      claim_token: null,
      duration_ms: took,
      error_message: message,
      error_stack: (error && error.stack) || null,
      finished_at: dead ? now : null,
      history: JSON.stringify(history),
      run_at: dead ? row.run_at : now + wait,
      state: dead ? 'dead' : 'pending',
      updated_at: now,
    });

    this.log(
      dead ? 'error' : 'warn',
      row.name,
      row.id,
      dead ? 'died after' : 'failed on attempt',
      `${attempts}/${max}`,
      message
    );

    return {
      error,
      job: toJob(await store.find(row.id)),
      state: dead ? 'dead' : 'pending',
    };
  }
}

module.exports = { Jobs, MAIL_JOB, STATES, toJob };
