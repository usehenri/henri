const os = require('os');
const { randomUUID: uuid } = require('crypto');
const debug = require('debug')('henri:jobs:runner');

const { next: nextRun } = require('./cron');
const { slot } = require('./keys');

/** What a schedule waits before it looks again at an expression */
const MINUTE = 60000;

/**
 * How many concurrency keys one tick looks at.
 *
 * A keyed limit (`key: 'tenantId'`) makes as many keys as there are tenants
 * with work waiting, and a runner only ever has room for a handful of them:
 * the store hands back the most urgent, which is the order the claim would
 * have taken them in anyway.
 */
const KEYS_PER_TICK = 100;

/** No job of this application declares a limit */
const UNBOUNDED = { groups: new Map(), names: [] };

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
    /** The concurrency slots this runner holds: job id -> { key, slot } */
    this.slots = new Map();
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

    // How long claiming took: the number that says a queue is contended,
    // which no log line carries and no count can be derived from. It is a
    // recorder that does nothing when henri is not tracing, so the loop
    // below has nothing to test (see base/telemetry.js in core)
    const telemetry = jobs.henri && jobs.henri.telemetry;

    this.claimed =
      telemetry && typeof telemetry.histogram === 'function'
        ? telemetry.histogram('henri.jobs.claim.duration', {
            description: 'How long one claim took, whatever it claimed',
            unit: 's',
          })
        : { record: () => {} };
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

    // The two passes partition the queue by job name: the first takes
    // everything that declares no limit, in one statement, exactly as it
    // always did; the second takes one row per concurrency slot it holds
    const bounded = this.jobs.concurrent ? this.jobs.limited() : UNBOUNDED;
    const token = uuid();
    const now = Date.now();
    const started = process.hrtime.bigint();
    const rows = await this.jobs.storeOrDie().claim({
      except: bounded.names,
      limit: room,
      now,
      queues: this.queues,
      runner: this.id,
      token,
    });

    for (const row of rows) {
      this.running.set(row.id, { promise: this.hold(row), token });
    }

    const left = room - rows.length;
    const held =
      left > 0 && bounded.names.length > 0
        ? await this.throttled(bounded, left, now)
        : 0;

    this.claimed.record(Number(process.hrtime.bigint() - started) / 1e9, {
      'henri.jobs.claimed': rows.length + held,
    });

    return rows.length + held;
  }

  /**
   * Claims the jobs whose concurrency limit leaves room for them
   *
   * The permit comes **first**: a slot is taken, and only then is one row of
   * that key claimed. The other order -- claim, discover the key is full,
   * put the row back -- would make a full key spin this loop, because the
   * cycle only sleeps when a tick claimed nothing.
   *
   * @param {object} bounded `{ names, groups }` from the queue
   * @param {number} room How many jobs this runner still has room for
   * @param {number} now The current time
   * @returns {Promise<number>} How many jobs were claimed
   * @memberof Runner
   */
  async throttled(bounded, room, now) {
    const store = this.jobs.storeOrDie();
    const waiting = await store.waiting({
      limit: KEYS_PER_TICK,
      names: bounded.names,
      now,
      queues: this.queues,
    });
    const seen = new Set();
    let taken = 0;

    for (const entry of waiting) {
      if (taken >= room) {
        break;
      }

      const bucket = this.jobs.bucket(entry, bounded);

      // Two jobs of one group may answer for the same key: it is one bound,
      // so it is asked for once
      if (!bucket || seen.has(bucket.key.value)) {
        continue;
      }

      seen.add(bucket.key.value);

      // A key with room for three and a runner with room for three takes
      // three: the slots run out (`takeSlot` answers null) or the key does
      // (`claimOne` gives the permit straight back)
      while (taken < room) {
        const slot = await store.takeSlot({
          key: bucket.key.value,
          limit: bucket.limit,
          now: Date.now(),
          runner: this.id,
        });

        if (slot === null || !(await this.claimOne(bucket, slot, now))) {
          break;
        }

        taken += 1;
      }
    }

    return taken;
  }

  /**
   * Claims one row of a key this runner holds a slot of
   *
   * @param {object} bucket `{ key, limit, names }`
   * @param {number} slot The slot this runner took
   * @param {number} now The current time
   * @returns {Promise<boolean>} Whether a job was claimed
   * @memberof Runner
   */
  async claimOne(bucket, slot, now) {
    const store = this.jobs.storeOrDie();
    const key = bucket.key.value;
    const token = uuid();
    let rows;

    try {
      rows = await store.claim({
        key: bucket.key,
        limit: 1,
        names: bucket.names,
        now,
        queues: this.queues,
        runner: this.id,
        token,
      });
    } catch (error) {
      await store.releaseSlot(key, slot, this.id).catch(() => null);
      throw error;
    }

    const [row] = rows;

    if (!row) {
      // Another runner took the last row of this key in between: the permit
      // goes back at once rather than waiting for the sweep
      await store.releaseSlot(key, slot, this.id);

      return false;
    }

    this.slots.set(row.id, { key, slot });
    // Says what the slot is being held for, for `henri jobs:status`; the
    // bound does not rest on it, so a failure here is a debug line
    await store
      .holdSlot(key, slot, row.id, Date.now())
      .catch((error) => debug('holdSlot: %s', error.message));
    this.running.set(row.id, { promise: this.hold(row), token });

    return true;
  }

  /**
   * Gives back the concurrency slot a job was performed under
   *
   * A slot that cannot be given back is freed by the sweep once its
   * heartbeat goes stale, like the job of a runner that died.
   *
   * @param {string} id The job id
   * @returns {Promise<void>} Resolves when it is back
   * @memberof Runner
   */
  async free(id) {
    const held = this.slots.get(id);

    if (!held) {
      return;
    }

    this.slots.delete(id);

    try {
      await this.jobs.storeOrDie().releaseSlot(held.key, held.slot, this.id);
    } catch (error) {
      this.log(
        'warn',
        'runner',
        this.id,
        `could not free the concurrency slot ${held.key}#${held.slot}:`,
        error.message
      );
    }
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
      // The slot goes back before the job leaves `running`, and in that
      // order: `shutdown()` waits on the promises of what is running, so a
      // job removed first would let the runner stop with its permit still
      // held, to be freed by a sweep five minutes later
      await this.free(row.id);
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
    const claims = new Map();

    for (const [id, entry] of this.running) {
      const ids = claims.get(entry.token) || [];

      ids.push(id);
      claims.set(entry.token, ids);
    }

    if (claims.size === 0) {
      return;
    }

    const now = Date.now();

    try {
      for (const [token, ids] of claims) {
        await this.jobs.storeOrDie().heartbeat(ids, now, token);
      }

      // The concurrency slots are refreshed by the same beat, and the sweep
      // that frees a stale one uses the same `stuckAfter`: a slot outlives
      // a runner by exactly as long as its jobs do
      if (this.slots.size > 0) {
        await this.jobs
          .storeOrDie()
          .heartbeatSlots([...this.slots.values()], now, this.id);
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

    const store = this.jobs.storeOrDie();
    const recovered = await store.recover({ now, stuckAfter: this.stuckAfter });

    for (const row of recovered) {
      this.log('warn', row.name, row.id, 'recovered from', row.claimed_by);
    }

    if (this.jobs.concurrent) {
      const freed = await store.sweepSlots({
        now,
        stuckAfter: this.stuckAfter,
      });

      for (const held of freed) {
        this.log(
          'warn',
          'concurrency',
          `${held.key}#${held.slot}`,
          'freed from',
          held.runner
        );
      }
    }

    // The batches nothing else will settle: one killed between the outcome
    // of its last job and the counting of it, and one whose last job was
    // buried by the recovery above, which wrote an outcome no attempt owns.
    // The window is the same clock, for the same reason
    if (this.jobs.batched) {
      const settled = await this.jobs.reconcile({
        before: now - this.stuckAfter,
      });

      for (const batch of settled) {
        this.log('warn', 'batch', batch.id, 'settled by the sweep');
      }
    }

    if (this.keepCompleted > 0) {
      await this.jobs.storeOrDie().prune(now - this.keepCompleted);

      if (this.jobs.batched) {
        await this.jobs
          .storeOrDie()
          .pruneBatches(now - this.keepCompleted)
          .catch((error) => debug('pruneBatches: %s', error.message));
      }
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
      unique: slot(entry.name, due),
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

module.exports = { KEYS_PER_TICK, Runner, SIGNALS };
