const os = require('os');
const { randomUUID: uuid } = require('crypto');
const debug = require('debug')('henri:jobs:runner');

const { next: nextRun } = require('./cron');

/** What a schedule waits before it looks again at an expression */
const MINUTE = 60000;

/** The signals a runner stops on */
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

/**
 * A worker process: it claims jobs, performs them, keeps the recurring
 * schedules moving and puts back what a dead runner left behind.
 *
 * Several runners are meant to run at once against one database. Nothing in
 * here assumes it is alone: the claim is atomic (see `store/sql.js` and
 * `store/mongo.js`), and so is moving a recurring schedule forward.
 *
 * @class Runner
 */
class Runner {
  /**
   * Creates an instance of Runner.
   *
   * @param {object} jobs The queue
   * @param {object} [options={}] Options
   * @param {Array<string>} [options.queues] The queues to take from (all of
   *   them when the list is empty)
   * @param {number} [options.concurrency] How many jobs at once
   * @param {boolean} [options.recurring=true] Honour the schedules
   * @param {string} [options.id] The runner id, for the logs and the rows
   * @memberof Runner
   */
  constructor(jobs, options = {}) {
    const { config } = jobs;

    this.jobs = jobs;
    this.pen = jobs.pen;
    this.concurrency = Math.max(
      1,
      Number(options.concurrency) || config.concurrency
    );
    this.queues = options.queues || config.queues;
    this.recurring = options.recurring !== false;
    this.pollInterval = config.pollInterval;
    this.stuckAfter = config.stuckAfter;
    this.keepCompleted = config.keepCompleted;
    this.id =
      options.id || `${os.hostname()}:${process.pid}:${uuid().slice(0, 8)}`;

    /** The jobs in flight: id -> { promise, token } */
    this.running = new Map();
    this.stopping = false;
    this.stopped = null;
    this.loop = null;
    this.timer = null;
    this.wake = null;
    this.heartbeatTimer = null;
    this.maintenanceAt = 0;
    this.sweepAt = 0;
    this.prunedSchedules = false;
    this.handlers = [];
    this.performed = 0;
    this.failed = 0;
    this.beatFailed = false;
    /** Schedules already reported as unrunnable, so they are said once */
    this.warned = new Set();
  }

  /**
   * Says something, when there is a pen to say it with
   *
   * @param {string} level info, warn or error
   * @param {...*} args What to say
   * @returns {void}
   * @memberof Runner
   */
  log(level, ...args) {
    if (this.pen && typeof this.pen[level] === 'function') {
      this.pen[level]('jobs', ...args);
    }
  }

  /**
   * Starts the loop
   *
   * @param {object} [options={}] Options
   * @param {boolean} [options.signals=false] Stop on SIGINT, SIGTERM, SIGQUIT
   * @returns {Runner} This runner
   * @memberof Runner
   */
  start({ signals = false } = {}) {
    if (this.loop) {
      return this;
    }

    this.stopping = false;
    this.jobs.runners.add(this);

    if (signals) {
      this.trap();
    }

    this.beating();
    this.loop = this.cycle();

    this.log(
      'info',
      'runner',
      this.id,
      'started',
      `concurrency ${this.concurrency}`,
      this.queues.length > 0 ? `queues ${this.queues.join(', ')}` : 'all queues'
    );

    return this;
  }

  /**
   * Starts the heartbeat that says this runner is still on its jobs
   *
   * @returns {void}
   * @memberof Runner
   */
  beating() {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(
      () => this.beat(),
      Math.max(1000, Math.floor(this.stuckAfter / 4))
    );
    this.heartbeatTimer.unref();
  }

  /**
   * Stops the heartbeat
   *
   * @returns {void}
   * @memberof Runner
   */
  stopBeating() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Stops the loop and waits for the jobs in flight
   *
   * The jobs already claimed are performed to the end and their outcome is
   * written down; nothing new is claimed. Every caller waits for the same
   * shutdown: the CLI's signal handler and `henri.stop()` both call this.
   *
   * @returns {Promise<object>} `{ performed, failed }`
   * @memberof Runner
   */
  stop() {
    if (!this.stopped) {
      this.stopped = this.shutdown();
    }

    return this.stopped;
  }

  /**
   * The shutdown itself
   *
   * @returns {Promise<object>} `{ performed, failed }`
   * @memberof Runner
   */
  async shutdown() {
    this.stopping = true;
    this.release();

    // Wake the loop out of its poll instead of leaving it on a timer that
    // will never fire: `await this.loop` below is what waits for it
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.wake) {
      const wake = this.wake;

      this.wake = null;
      wake();
    }

    this.stopBeating();

    await this.loop;
    await Promise.all(this.inFlight());

    this.loop = null;
    this.jobs.runners.delete(this);
    this.log('info', 'runner', this.id, 'stopped');

    return { failed: this.failed, performed: this.performed };
  }

  /**
   * The promises of the jobs being performed right now
   *
   * @returns {Array<Promise>} The promises
   * @memberof Runner
   */
  inFlight() {
    return [...this.running.values()].map((entry) => entry.promise);
  }

  /**
   * Stops on the usual signals
   *
   * @returns {void}
   * @memberof Runner
   */
  trap() {
    for (const signal of SIGNALS) {
      const handler = () => {
        this.log(
          'info',
          'runner',
          this.id,
          `${signal}, finishing the jobs in flight`
        );
        this.stop().catch((error) =>
          this.log('error', 'runner', this.id, error.message)
        );
      };

      this.handlers.push([signal, handler]);
      process.on(signal, handler);
    }
  }

  /**
   * Puts the signal handlers back
   *
   * @returns {void}
   * @memberof Runner
   */
  release() {
    for (const [signal, handler] of this.handlers) {
      process.removeListener(signal, handler);
    }

    this.handlers = [];
  }

  /**
   * Waits, unless the runner is stopping
   *
   * @param {number} ms How long to wait
   * @returns {Promise<void>} Resolves when the time is up
   * @memberof Runner
   */
  sleep(ms) {
    if (this.stopping) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const done = () => {
        this.timer = null;
        this.wake = null;
        resolve();
      };

      this.wake = done;
      this.timer = setTimeout(done, ms);
      this.timer.unref();
    });
  }

  /**
   * The loop: claim, perform, repeat
   *
   * @returns {Promise<void>} Resolves when the runner is stopped
   * @memberof Runner
   */
  async cycle() {
    while (!this.stopping) {
      let claimed = 0;

      try {
        await this.maintain();
        claimed = await this.tick();
      } catch (error) {
        this.log('error', 'runner', this.id, error.message);
        debug('%O', error);
      }

      if (claimed === 0) {
        await this.sleep(this.pollInterval);
      }
    }
  }

  /**
   * Performs everything that is due and returns, instead of looping
   *
   * This is what `henri jobs --once` runs: a drain. A job whose next attempt
   * is in the future is left alone, so a drain always ends.
   *
   * @param {object} [options={}] Options
   * @param {boolean} [options.maintain=true] Run the housekeeping first
   * @returns {Promise<object>} `{ performed, failed }`
   * @memberof Runner
   */
  async once({ maintain = true } = {}) {
    this.stopping = false;
    this.jobs.runners.add(this);
    // A drain can outlive `stuckAfter` as easily as the loop can: without
    // the heartbeat its jobs would be recovered out from under it
    this.beating();

    try {
      if (maintain) {
        await this.maintain();
      }

      for (;;) {
        const claimed = await this.tick();

        if (claimed === 0 && this.running.size === 0) {
          break;
        }

        if (claimed === 0) {
          await Promise.race(this.inFlight());
        }
      }

      await Promise.all(this.inFlight());
    } finally {
      this.stopBeating();
      this.jobs.runners.delete(this);
    }

    return { failed: this.failed, performed: this.performed };
  }

  /**
   * Claims what there is room for and performs it
   *
   * @returns {Promise<number>} How many jobs were claimed
   * @memberof Runner
   */
  async tick() {
    const room = this.concurrency - this.running.size;

    if (room < 1) {
      await Promise.race(this.inFlight());

      return 1;
    }

    const token = uuid();
    const rows = await this.jobs.storeOrDie().claim({
      limit: room,
      now: Date.now(),
      queues: this.queues,
      runner: this.id,
      token,
    });

    for (const row of rows) {
      this.running.set(row.id, { promise: this.hold(row), token });
    }

    return rows.length;
  }

  /**
   * Performs one claimed row and forgets it when it is done
   *
   * @param {object} row A claimed row
   * @returns {Promise<void>} Resolves when the outcome is written
   * @memberof Runner
   */
  async hold(row) {
    const started = Date.now();

    try {
      const result = await this.jobs.run(row, { runner: this.id });

      if (result.state === 'done') {
        this.performed += 1;
        this.log('info', row.name, row.id, 'done', `${Date.now() - started}ms`);
      } else {
        this.failed += 1;
      }
    } catch (error) {
      this.failed += 1;
      this.log('error', 'runner', this.id, row.name, error.message);
      debug('%O', error);
    } finally {
      this.running.delete(row.id);
    }
  }

  /**
   * Tells the database this runner is still alive on its jobs
   *
   * @returns {Promise<void>} Resolves when written
   * @memberof Runner
   */
  async beat() {
    const batches = new Map();

    for (const [id, entry] of this.running) {
      const ids = batches.get(entry.token) || [];

      ids.push(id);
      batches.set(entry.token, ids);
    }

    if (batches.size === 0) {
      return;
    }

    const now = Date.now();

    try {
      for (const [token, ids] of batches) {
        await this.jobs.storeOrDie().heartbeat(ids, now, token);
      }

      this.beatFailed = false;
    } catch (error) {
      // A heartbeat that keeps failing means these jobs are about to be
      // recovered and performed a second time: say so once
      if (!this.beatFailed) {
        this.beatFailed = true;
        this.log('warn', 'runner', this.id, 'heartbeat failed', error.message);
      }

      debug('heartbeat failed: %s', error.message);
    }
  }

  /**
   * Housekeeping: recurring schedules, jobs left behind by a dead runner,
   * and the finished jobs that are old enough to go
   *
   * @returns {Promise<void>} Resolves when done
   * @memberof Runner
   */
  async maintain() {
    const now = Date.now();

    if (now < this.maintenanceAt) {
      return;
    }

    // A cron expression has a minute of resolution, so the schedules are
    // looked at every second at most
    this.maintenanceAt = now + Math.max(this.pollInterval, 1000);

    if (now >= this.sweepAt) {
      await this.sweep(now);
    }

    if (this.recurring) {
      await this.schedule(now);
    }
  }

  /**
   * Puts back the jobs of runners that died and prunes the finished ones
   *
   * @param {number} now The current time
   * @returns {Promise<void>} Resolves when done
   * @memberof Runner
   */
  async sweep(now) {
    // Nothing here is urgent: a job left behind is not late until
    // `stuckAfter` has gone by, and the pruning is housekeeping
    this.sweepAt = now + Math.max(5000, Math.floor(this.stuckAfter / 10));

    const recovered = await this.jobs
      .storeOrDie()
      .recover({ now, stuckAfter: this.stuckAfter });

    for (const row of recovered) {
      this.log('warn', row.name, row.id, 'recovered from', row.claimed_by);
    }

    if (this.keepCompleted > 0) {
      await this.jobs.storeOrDie().prune(now - this.keepCompleted);
    }
  }

  /**
   * Enqueues the recurring jobs that are due
   *
   * A schedule holds the next moment it should run. Whoever moves it forward
   * -- one runner, never two, because the update only matches the moment it
   * read -- is the one that enqueues the job. The new moment is computed
   * from now, not from the moment that was missed: after an hour of
   * downtime an hourly job runs once, not sixty times.
   *
   * @param {number} now The current time
   * @returns {Promise<Array<object>>} The jobs that were enqueued
   * @memberof Runner
   */
  async schedule(now) {
    const store = this.jobs.storeOrDie();
    const schedules = this.jobs.config.recurring;
    const enqueued = [];

    // The schedules the configuration no longer declares only have to go
    // once, when this runner starts
    if (!this.prunedSchedules) {
      this.prunedSchedules = true;
      await store.pruneSchedules(schedules.map((entry) => entry.name));
    }

    for (const entry of schedules) {
      try {
        const job = await this.due(entry, now, store);

        if (job) {
          enqueued.push(job);
        }
      } catch (error) {
        // One schedule must never stop the runner claiming: the loop that
        // calls this is the same one that claims jobs
        this.log('error', 'recurring', entry.name, error.message);
        debug('%O', error);
      }
    }

    return enqueued;
  }

  /**
   * Enqueues one schedule if its moment has come
   *
   * The job is enqueued **before** the schedule is moved on, and it carries
   * the slot as its unique key: whichever runner gets here, exactly one job
   * exists for that slot, and an enqueue that fails leaves the schedule due
   * so the next tick tries again.
   *
   * @param {object} entry A normalized schedule
   * @param {number} now The current time
   * @param {object} store The store backend
   * @returns {Promise<?object>} The job this runner enqueued, or null
   * @memberof Runner
   */
  async due(entry, now, store) {
    if (!this.jobs.definitions[entry.job]) {
      return this.giveUp(entry, `no job named "${entry.job}" in app/jobs`);
    }

    const upcoming = this.nextRunOf(entry, now);

    if (upcoming === null) {
      return this.giveUp(entry, `${entry.spec} can never come round again`);
    }

    let row = await store.schedule(entry.name);

    if (!row) {
      row = await store.addSchedule({
        created_at: now,
        job: entry.job,
        name: entry.name,
        next_run_at: upcoming,
        spec: entry.spec,
        updated_at: now,
      });
    }

    if (!row) {
      return this.giveUp(
        entry,
        'the schedule could not be recorded; is the queue installed?'
      );
    }

    // The configuration changed under a schedule that was already recorded
    if (row.spec !== entry.spec) {
      await store.resetSchedule({
        name: entry.name,
        next: upcoming,
        now,
        spec: entry.spec,
      });

      return null;
    }

    const due = Number(row.next_run_at);

    if (due > now) {
      return null;
    }

    const id = uuid();
    const job = await this.jobs.perform(entry.job, entry.args, {
      id,
      priority: entry.priority === null ? undefined : entry.priority,
      queue: entry.queue || undefined,
      unique: `recurring:${entry.name}:${due}`,
    });

    // Now that the slot is in the queue the schedule may move on; if another
    // runner moved it already, its own enqueue and this one are the same row
    await store.advanceSchedule({
      due,
      name: entry.name,
      next: this.nextRunOf(entry, now) || now + MINUTE,
      now,
      spec: entry.spec,
      token: uuid(),
    });

    if (job.id !== id) {
      // Another runner enqueued this slot first
      return null;
    }

    this.warned.delete(entry.name);
    this.log('info', 'recurring', entry.name, '->', entry.job, job.id);

    return job;
  }

  /**
   * Says once why a schedule is being skipped
   *
   * @param {object} entry A normalized schedule
   * @param {string} why What is wrong with it
   * @returns {null} Always null, so callers can return it
   * @memberof Runner
   */
  giveUp(entry, why) {
    if (!this.warned.has(entry.name)) {
      this.warned.add(entry.name);
      this.log('warn', 'recurring', entry.name, 'skipped:', why);
    }

    return null;
  }

  /**
   * When a schedule should next run
   *
   * `every` is anchored on the epoch, so every runner and every restart
   * agree on the slots; `cron` is read in UTC.
   *
   * @param {object} entry A normalized schedule
   * @param {number} now The current time
   * @returns {?number} A timestamp in milliseconds, or null when the
   *   expression can never match again
   * @memberof Runner
   */
  nextRunOf(entry, now) {
    if (entry.every) {
      return (Math.floor(now / entry.every) + 1) * entry.every;
    }

    // Null when the expression can never match again (`0 0 30 2 *`); it is
    // not turned into some other moment, which would make "never" mean daily
    return nextRun(entry.cron, now);
  }
}

module.exports = { Runner, SIGNALS };
