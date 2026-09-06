const BaseModule = require('./base/module');

const fs = require('fs');
const path = require('path');
const debug = require('debug')('henri:jobs');

const { resolveFrom } = require('./utils');

/** The job `@usehenri/jobs` ships to send a mail rendered by the mailers */
const MAIL_JOB = 'henri/mail';

/**
 * Background jobs.
 *
 * The queue itself lives in `@usehenri/jobs`, resolved from the application
 * the way a store adapter is: core knows the module, not the implementation.
 * An application that has neither `app/jobs` nor a `jobs` block in its
 * configuration keeps this module inert -- `henri.jobs.enabled` is false and
 * every call says what to install.
 *
 * The runlevel is 4, not 5: `henri jobs` boots to that level so a runner
 * never binds an HTTP port, and the models (level 3) are up by then.
 *
 * @class Jobs
 * @extends {BaseModule}
 */
class Jobs extends BaseModule {
  /**
   * Creates an instance of Jobs.
   * @memberof Jobs
   */
  constructor() {
    super();

    this.reloadable = true;
    this.runlevel = 4;
    this.name = 'jobs';
    this.henri = null;

    this.queue = null;
    this.enabled = false;

    /** The dead letter queue, see @usehenri/jobs */
    this.dead = {
      count: () => this.ready().dead.count(),
      discard: (id) => this.ready().dead.discard(id),
      discardAll: (filter) => this.ready().dead.discardAll(filter),
      get: (id) => this.ready().dead.get(id),
      list: (filter) => this.ready().dead.list(filter),
      retry: (id, options) => this.ready().dead.retry(id, options),
      retryAll: (filter, options) =>
        this.ready().dead.retryAll(filter, options),
    };

    this.init = this.init.bind(this);
    this.stop = this.stop.bind(this);
    this.reload = this.reload.bind(this);
  }

  /**
   * Whether this application asked for a queue
   *
   * @returns {boolean} true when app/jobs holds a file, or the configuration
   *   has a `jobs` block
   * @memberof Jobs
   */
  wanted() {
    const { config } = this.henri;

    if (config && config.has && config.has('jobs')) {
      return true;
    }

    const location = path.join(this.henri.cwd(), 'app', 'jobs');

    try {
      return fs
        .readdirSync(location, { recursive: true })
        .some((entry) => String(entry).endsWith('.js'));
    } catch (error) {
      return false;
    }
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {Promise<string>} The name of the module
   * @throws when @usehenri/jobs is missing, or a job file is not a job
   * @memberof Jobs
   */
  async init() {
    const { config, pen } = this.henri;

    if (!this.wanted()) {
      debug('no app/jobs and no jobs configuration: staying out of the way');

      return this.name;
    }

    let factory;

    try {
      factory = require(resolveFrom('@usehenri/jobs', this.henri.cwd()));
    } catch (error) {
      throw pen.fatal(
        'jobs',
        `
      This application has background jobs but @usehenri/jobs is not
      installed. Add it with: npm install @usehenri/jobs`
      );
    }

    const settings =
      config && config.has && config.has('jobs') ? config.get('jobs') : {};

    this.queue = factory(this.henri, {
      config: settings || {},
      cwd: this.henri.cwd(),
    });

    try {
      await this.queue.start();
    } catch (error) {
      pen.error('jobs', 'unable to start the queue', error.message);
      throw error;
    }

    this.enabled = true;
    this.deliverMail();

    const names = this.queue.names();

    pen.info(
      'jobs',
      `${names.length} job(s)`,
      names.length > 0 ? names.join(', ') : 'none in app/jobs'
    );

    return this.name;
  }

  /**
   * Send the mails `henri.mailers.deliverLater()` renders through the queue
   *
   * The mailers module hands over a rendered nodemailer payload and the
   * options of the call (`wait`, `at`, `queue`, `priority`), which are the
   * options of `perform()`: nothing else has to be mapped. Without the queue
   * the mailers send out of band, which the mail guide is explicit about not
   * being a queue.
   *
   * @returns {boolean} Whether the handler was registered
   * @memberof Jobs
   */
  deliverMail() {
    const { mailers } = this.henri;

    if (!mailers || typeof mailers.onDeliverLater !== 'function') {
      return false;
    }

    return mailers.onDeliverLater((message, options) =>
      this.queue.perform(MAIL_JOB, message, options || {})
    );
  }

  /**
   * Stops the runners this process started
   *
   * @async
   * @returns {Promise<boolean>} true when there was something to stop
   * @memberof Jobs
   */
  async stop() {
    if (!this.queue) {
      return false;
    }

    const { mailers } = this.henri;

    if (mailers && typeof mailers.onDeliverLater === 'function') {
      mailers.onDeliverLater(null);
    }

    await this.queue.stop();
    this.enabled = false;

    return true;
  }

  /**
   * Reloads the module: `app/jobs` is read again
   *
   * @async
   * @returns {Promise<string>} Module name
   * @memberof Jobs
   */
  async reload() {
    await this.stop();

    this.queue = null;

    return this.init();
  }

  /**
   * The queue, or a readable error
   *
   * @returns {object} The queue
   * @throws when the application has no queue
   * @memberof Jobs
   */
  ready() {
    if (!this.queue) {
      throw this.henri.pen.fatal(
        'jobs',
        `
      This application has no job queue. Write a job with
      'henri generate job <name>' and install @usehenri/jobs.`
      );
    }

    return this.queue;
  }

  /**
   * Enqueues a job
   *
   * @param {string} name The job name (its file under app/jobs)
   * @param {*} [args] What perform() receives
   * @param {object} [options] `wait`, `at`, `queue`, `priority`,
   *   `maxAttempts`, `timeout`, `unique`
   * @returns {Promise<object>} The enqueued job
   * @memberof Jobs
   */
  perform(name, args, options) {
    return this.ready().perform(name, args, options);
  }

  /**
   * Enqueues a job; the name `henri.mailers.onDeliverLater()` expects
   *
   * @param {string} name The job name
   * @param {*} [args] What perform() receives
   * @param {object} [options] The options of perform()
   * @returns {Promise<object>} The enqueued job
   * @memberof Jobs
   */
  enqueue(name, args, options) {
    return this.ready().perform(name, args, options);
  }

  /**
   * Enqueues a job to run later
   *
   * @param {(number|string)} wait How long to wait (`'5m'`)
   * @param {string} name The job name
   * @param {*} [args] What perform() receives
   * @param {object} [options] The options of perform()
   * @returns {Promise<object>} The enqueued job
   * @memberof Jobs
   */
  performIn(wait, name, args, options) {
    return this.ready().performIn(wait, name, args, options);
  }

  /**
   * Enqueues a job to run at a given moment
   *
   * @param {(Date|string|number)} when The moment
   * @param {string} name The job name
   * @param {*} [args] What perform() receives
   * @param {object} [options] The options of perform()
   * @returns {Promise<object>} The enqueued job
   * @memberof Jobs
   */
  performAt(when, name, args, options) {
    return this.ready().performAt(when, name, args, options);
  }

  /**
   * Performs a job here and now, without the queue
   *
   * @param {string} name The job name
   * @param {*} [args] What perform() receives
   * @returns {Promise<*>} What perform() returned
   * @memberof Jobs
   */
  performNow(name, args) {
    return this.ready().performNow(name, args);
  }

  /**
   * One job
   *
   * @param {string} id The job id
   * @returns {Promise<?object>} The job, or null
   * @memberof Jobs
   */
  get(id) {
    return this.ready().get(id);
  }

  /**
   * The jobs of the queue
   *
   * @param {object} [filter] `state`, `queue`, `name`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The jobs
   * @memberof Jobs
   */
  list(filter) {
    return this.ready().list(filter);
  }

  /**
   * What the queue holds
   *
   * @returns {Promise<object>} Counts, timings and waits
   * @memberof Jobs
   */
  stats() {
    return this.ready().stats();
  }

  /**
   * The job names of the application
   *
   * @returns {Array<string>} The names
   * @memberof Jobs
   */
  names() {
    return this.queue ? this.queue.names() : [];
  }
}

module.exports = Jobs;
