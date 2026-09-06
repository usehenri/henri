const os = require('os');
const { randomUUID } = require('crypto');
const debug = require('debug')('henri:jobs:runner');

const { next: nextRun } = require('./cron');

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
      options.id ||
      `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

    this.running = new Map();
    this.stopping = false;
    this.loop = null;
    this.timer = null;
    this.wake = null;
    this.heartbeatTimer = null;
    this.maintenanceAt = 0;
    this.handlers = [];
    this.performed = 0;
    this.failed = 0;
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

    this.heartbeatTimer = setInterval(
      () => this.beat(),
      Math.max(1000, Math.floor(this.stuckAfter / 4))
    );
    this.heartbeatTimer.unref();

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
   * Stops the loop and waits for the jobs in flight
   *
   * The jobs already claimed are performed to the end and their outcome is
   * written down; nothing new is claimed.
   *
   * @returns {Promise<object>} `{ performed, failed }`
   * @memberof Runner
   */
  async stop() {
    if (this.stopping) {
      await this.loop;

      return { failed: this.failed, performed: this.performed };
    }

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

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    await this.loop;
    await Promise.all([...this.running.values()]);

    this.loop = null;
    this.jobs.runners.delete(this);
    this.log('info', 'runner', this.id, 'stopped');

    return { failed: this.failed, performed: this.performed };
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
        this.stop();
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
          await Promise.race([...this.running.values()]);
        }
      }

      await Promise.all([...this.running.values()]);
    } finally {
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
      await Promise.race([...this.running.values()]);

      return 1;
    }

    const rows = await this.jobs.storeOrDie().claim({
      limit: room,
      now: Date.now(),
      queues: this.queues,
      runner: this.id,
      token: randomUUID(),
    });

    for (const row of rows) {
      this.running.set(row.id, this.hold(row));
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
    const ids = [...this.running.keys()];

    if (ids.length === 0) {
      return;
    }

    try {
      await this.jobs.storeOrDie().heartbeat(ids, Date.now());
    } catch (error) {
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

    this.maintenanceAt = now + Math.max(this.pollInterval, 1000);

    if (this.recurring) {
      await this.schedule(now);
    }

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

    await store.pruneSchedules(schedules.map((entry) => entry.name));

    for (const entry of schedules) {
      const upcoming = this.nextRunOf(entry, now);
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
        continue;
      }

      // The configuration changed under a schedule that was already recorded
      if (row.spec !== entry.spec) {
        await store.resetSchedule({
          name: entry.name,
          next: upcoming,
          now,
          spec: entry.spec,
        });
        continue;
      }

      const due = Number(row.next_run_at);

      if (due > now) {
        continue;
      }

      const won = await store.advanceSchedule({
        due,
        name: entry.name,
        next: this.nextRunOf(entry, now),
        now,
        spec: entry.spec,
        token: randomUUID(),
      });

      if (!won) {
        continue;
      }

      try {
        const job = await this.jobs.perform(entry.job, entry.args, {
          priority: entry.priority === null ? undefined : entry.priority,
          queue: entry.queue || undefined,
          unique: `recurring:${entry.name}:${due}`,
        });

        enqueued.push(job);
        this.log('info', 'recurring', entry.name, '->', entry.job, job.id);
      } catch (error) {
        this.log('error', 'recurring', entry.name, error.message);
      }
    }

    return enqueued;
  }

  /**
   * When a schedule should next run
   *
   * `every` is anchored on the epoch, so every runner and every restart
   * agree on the slots; `cron` is read in UTC.
   *
   * @param {object} entry A normalized schedule
   * @param {number} now The current time
   * @returns {number} A timestamp in milliseconds
   * @memberof Runner
   */
  nextRunOf(entry, now) {
    if (entry.every) {
      return (Math.floor(now / entry.every) + 1) * entry.every;
    }

    return nextRun(entry.cron, now) || now + 86400000;
  }
}

module.exports = { Runner, SIGNALS };
