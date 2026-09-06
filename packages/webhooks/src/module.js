const BaseModule = require('@usehenri/core/module');

const debug = require('debug')('henri:webhooks');

const { Webhooks } = require('./webhooks');
const { definition } = require('./job');

/**
 * Outbound webhooks: the henri module this package ships.
 *
 * `package.json` points at it with `"henri": { "module": "./module.js" }`,
 * so an application that depends on `@usehenri/webhooks` has it in the boot
 * as `henri.webhooks`, with nothing else to write. One that does not has no
 * such module, and core carries none of this.
 *
 * ## Why a package, and not part of one that exists
 *
 * It could have been part of `@usehenri/jobs`, which it depends on. It is
 * not, because the queue would then carry an HTTP client, a signing scheme,
 * an SSRF address check, an endpoints table and a key at rest -- none of
 * which a queue needs, and all of which an application that only wanted
 * background work would have to read past in a security review. It could
 * have been part of core, and core carries neither the queue nor the
 * uploads for the same reason. So: a package, next to `@usehenri/jobs` and
 * `@usehenri/uploads`, peer-depending on both core and the queue, following
 * the precedent those two set.
 *
 * ## Where it sits in the boot
 *
 * Runlevel 4, after the queue: it registers the delivery job on
 * `henri.jobs`, so `henri jobs` -- which boots to that level and binds no
 * port -- has the definition and performs the deliveries. `henri.cache` is
 * at 3 and is used, without being needed, to keep an endpoint lookup off the
 * database on every event.
 *
 * An application that installed this package and has no running queue boots
 * anyway: the endpoints can be registered and inspected, and the first
 * `emit()` is what says the queue is missing. Failing the boot over it would
 * be a worse trade -- a webhook is not what an application serves.
 *
 * @class WebhooksModule
 * @extends {BaseModule}
 */
class WebhooksModule extends BaseModule {
  /**
   * Creates an instance of WebhooksModule.
   *
   * @param {object} [henri=null] A henri instance
   * @memberof WebhooksModule
   */
  constructor(henri = null) {
    super();

    this.reloadable = true;
    this.needs = ['config', 'model'];
    this.after = ['cache', 'jobs'];
    this.runlevel = 4;
    this.name = 'webhooks';
    this.henri = henri;

    this.webhooks = null;
    this.enabled = false;

    this.init = this.init.bind(this);
    this.stop = this.stop.bind(this);
    this.reload = this.reload.bind(this);
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {Promise<string>} The name of the module
   * @throws when the endpoints table cannot be reached
   * @memberof WebhooksModule
   */
  async init() {
    const { config, pen } = this.henri;
    const settings =
      config && config.has && config.has('webhooks')
        ? config.get('webhooks')
        : {};

    this.webhooks = new Webhooks(this.henri, {
      agent: this.agent(),
      config: settings || {},
    });

    try {
      await this.webhooks.start();
    } catch (error) {
      pen.error('webhooks', 'unable to prepare the endpoints', error.message);
      throw error;
    }

    this.enabled = true;
    this.deliver();

    const wanted = this.webhooks.config;
    const said = [
      `deliveries on the ${wanted.queue} queue`,
      `${wanted.maxAttempts} attempts`,
    ];

    if (wanted.allowPrivate) {
      said.push('private addresses are ALLOWED');
    }

    if (wanted.allowHttp) {
      said.push('plaintext http is ALLOWED');
    }

    pen.info('webhooks', ...said);

    return this.name;
  }

  /**
   * The user agent the deliveries carry
   *
   * @returns {string} `henri-webhooks/<version>`
   * @memberof WebhooksModule
   */
  agent() {
    try {
      return `henri-webhooks/${require('../package.json').version}`;
    } catch (error) {
      return 'henri-webhooks';
    }
  }

  /**
   * Registers the delivery job on the queue
   *
   * An application that wants its own delivery job writes
   * `app/jobs/henri/webhook.js`, and it wins: the queue refuses to replace a
   * definition that came from a file, the way it does for `henri/mail`.
   *
   * @returns {boolean} Whether the job was registered
   * @memberof WebhooksModule
   */
  deliver() {
    const { jobs, pen } = this.henri;

    if (!jobs || !jobs.enabled) {
      pen.warn(
        'webhooks',
        'no running job queue: the endpoints can be managed, but nothing can be delivered.',
        'Install @usehenri/jobs, add a "jobs" block to the configuration and run `henri jobs`'
      );

      return false;
    }

    if (typeof jobs.define !== 'function') {
      pen.warn(
        'webhooks',
        'this @usehenri/jobs is too old to take a job from a package: upgrade it'
      );

      return false;
    }

    const { definition: job, name } = definition(this.webhooks);

    debug('registering the %s job', name);

    return jobs.define(name, job);
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {Promise<boolean>} true when there was something to stop
   * @memberof WebhooksModule
   */
  async stop() {
    if (!this.webhooks) {
      return false;
    }

    await this.webhooks.stop();
    this.enabled = false;

    return true;
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {Promise<string>} Module name
   * @memberof WebhooksModule
   */
  async reload() {
    await this.stop();

    this.webhooks = null;

    return this.init();
  }

  /**
   * The endpoints, or a readable error
   *
   * @returns {Webhooks} The endpoints
   * @throws when the module never started
   * @memberof WebhooksModule
   */
  ready() {
    if (!this.webhooks) {
      throw this.henri.pen.fatal(
        'webhooks',
        `
      The webhooks are not ready: the module did not start.`,
        null,
        null,
        'HENRI_WEBHOOK_NOT_STARTED'
      );
    }

    return this.webhooks;
  }

  /**
   * Registers an endpoint, and hands its secret over once
   *
   * @param {object} options `url`, `events`, `owner`, `description`,
   *   `headers`, `secret`
   * @returns {Promise<object>} The endpoint, with `secret`
   * @memberof WebhooksModule
   */
  register(options) {
    return this.ready().register(options);
  }

  /**
   * Sends an event to every endpoint subscribed to it
   *
   * @param {string} event The event name
   * @param {*} [data] What the receivers get, under `data`
   * @param {object} [options] `owner`, `wait`, `at`
   * @returns {Promise<Array<object>>} The deliveries enqueued
   * @memberof WebhooksModule
   */
  emit(event, data, options) {
    return this.ready().emit(event, data, options);
  }

  /**
   * Enqueues one delivery to one endpoint
   *
   * @param {string} id The endpoint id
   * @param {string} event The event name
   * @param {*} [data] What the receiver gets, under `data`
   * @param {object} [options] `wait`, `at`
   * @returns {Promise<object>} The delivery
   * @memberof WebhooksModule
   */
  deliverTo(id, event, data, options) {
    return this.ready().enqueue(id, event, data, options);
  }

  /**
   * One endpoint
   *
   * @param {string} id The endpoint id
   * @returns {Promise<?object>} The endpoint, or null
   * @memberof WebhooksModule
   */
  endpoint(id) {
    return this.ready().endpoint(id);
  }

  /**
   * The endpoints
   *
   * @param {object} [filter] `owner`, `disabled`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The endpoints
   * @memberof WebhooksModule
   */
  endpoints(filter) {
    return this.ready().endpoints(filter);
  }

  /**
   * The active secrets of an endpoint, in the clear
   *
   * @param {string} id The endpoint id
   * @returns {Promise<Array<string>>} The secrets that still sign
   * @memberof WebhooksModule
   */
  secrets(id) {
    return this.ready().secrets(id);
  }

  /**
   * Changes an endpoint
   *
   * @param {string} id The endpoint id
   * @param {object} [changes] `url`, `events`, `description`, `headers`
   * @returns {Promise<object>} The endpoint
   * @memberof WebhooksModule
   */
  update(id, changes) {
    return this.ready().update(id, changes);
  }

  /**
   * Gives an endpoint a new secret
   *
   * @param {string} id The endpoint id
   * @param {object} [options] `grace`, `secret`
   * @returns {Promise<object>} The endpoint, with the new `secret`
   * @memberof WebhooksModule
   */
  rotate(id, options) {
    return this.ready().rotate(id, options);
  }

  /**
   * Stops sending to an endpoint
   *
   * @param {string} id The endpoint id
   * @param {object} [options] `reason`
   * @returns {Promise<object>} The endpoint
   * @memberof WebhooksModule
   */
  disable(id, options) {
    return this.ready().disable(id, options);
  }

  /**
   * Sends to an endpoint again
   *
   * @param {string} id The endpoint id
   * @returns {Promise<object>} The endpoint
   * @memberof WebhooksModule
   */
  enable(id) {
    return this.ready().enable(id);
  }

  /**
   * Forgets an endpoint for good
   *
   * @param {string} id The endpoint id
   * @returns {Promise<boolean>} Whether there was one to remove
   * @memberof WebhooksModule
   */
  remove(id) {
    return this.ready().remove(id);
  }

  /**
   * The endpoints and what the queue holds for them
   *
   * @returns {Promise<object>} `{ endpoints, queue, deliveries }`
   * @memberof WebhooksModule
   */
  stats() {
    return this.ready().stats();
  }
}

module.exports = WebhooksModule;
