const BaseModule = require('./base/module');

const debug = require('debug')('henri:streams');

const { check } = require('./base/arguments');
const { fail } = require('./base/errors');
const { manyProcesses } = require('./base/shared');
const { Registry, Stream, field, settings, topicOf } = require('./base/stream');

/**
 * The streams module: `henri.streams`.
 *
 * What a stream is -- how it is framed, which policy questions it asks and
 * when, what leaves through the exit gate, what it does at the drain and
 * what henri refuses to promise about reconnection -- is in
 * `base/stream.js`, and its header is the document. This is the module
 * around it: where it sits in the boot, what the boot line says, and the
 * two calls an application makes.
 *
 * It runs at runlevel 4, after the policies (there is no stream without
 * one to ask) and the models (the exit gate publishes foreign keys), and
 * before the router, so `res.stream()` finds a registry already there.
 * `henri jobs` boots to this level, which is deliberate: a job is exactly
 * the sort of thing that wants to publish, even though the runner holds no
 * subscribers of its own and `publish()` there answers zero.
 *
 * @class StreamsModule
 * @extends {BaseModule}
 */
class StreamsModule extends BaseModule {
  /**
   * Creates an instance of StreamsModule.
   * @memberof StreamsModule
   */
  constructor() {
    super();

    this.name = 'streams';
    this.runlevel = 4;
    this.needs = ['config'];
    this.after = ['policies', 'model'];
    this.before = ['router'];
    this.reloadable = true;
    this.henri = null;

    /** The open connections of this process, until init() there are none */
    this.registry = null;
    /** `config.streams`, normalized */
    this.settings = null;
    /** Whether the "one process" warning has been said */
    this.warned = false;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
    this.open = this.open.bind(this);
    this.publish = this.publish.bind(this);
    this.count = this.count.bind(this);
    this.topics = this.topics.bind(this);
    this.drain = this.drain.bind(this);
  }

  /**
   * Module initialization
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof StreamsModule
   */
  async init() {
    const { pen } = this.henri;

    this.settings = settings(this.henri.config);
    this.registry = new Registry(this.henri);

    pen.info(
      'streams',
      'server-sent events',
      this.describe(),
      'a broadcast reaches this process'
    );
    debug('%o', this.settings);

    return this.name;
  }

  /**
   * The bounds, in words, for the boot line
   *
   * @returns {string} what this process will hold
   * @memberof StreamsModule
   */
  describe() {
    const { heartbeat, maxAge, maxOpen } = this.settings;
    const parts = [`at most ${maxOpen === false ? 'unlimited' : maxOpen} open`];

    parts.push(maxAge === false ? 'never expiring' : `${maxAge}ms each`);
    parts.push(
      heartbeat === false ? 'no heartbeat' : `heartbeat ${heartbeat}ms`
    );

    return parts.join(', ');
  }

  /**
   * Warns, once, when the environment says this process is one of several.
   *
   * Not at boot: an application that never opens a stream has nothing to
   * be told, and a warning it cannot act on is a warning it learns to
   * ignore. The first subscription is the moment it becomes true.
   *
   * @returns {boolean} whether it warned
   * @memberof StreamsModule
   */
  warnSingleProcess() {
    if (this.warned) {
      return false;
    }

    const evidence = manyProcesses();

    if (!evidence) {
      return false;
    }

    this.warned = true;
    this.henri.pen.warn(
      'streams',
      `${evidence}, and a stream lives on the process that accepted it`,
      'henri.streams.publish() reaches this process alone: the subscribers on the other processes are not told, and nothing errors. henri has no cross-process fan-out yet -- see https://usehenri.io/guides/streams/'
    );

    return true;
  }

  /**
   * Opens a stream on this response. `res.stream()` is how a controller
   * reaches it, with the policy already asked (see `5.router.js`).
   *
   * @param {Express.Request} req the request
   * @param {Express.Response} res the response
   * @param {object} options `{ topic, action, each, subject, policy, include }`
   * @returns {Stream} the open stream
   * @throws {Error} `HENRI_STREAM_TOO_MANY` past `streams.maxOpen`
   * @memberof StreamsModule
   */
  open(req, res, options = {}) {
    const { maxOpen } = this.settings;

    if (maxOpen !== false && this.registry.size >= maxOpen) {
      const error = fail(
        'HENRI_STREAM_TOO_MANY',
        `this process is already holding ${this.registry.size} streams and streams.maxOpen is ${maxOpen}`
      );

      error.status = 503;
      error.retryAfter = Math.ceil((this.settings.retry || 3000) / 1000);
      error.hint =
        'raise streams.maxOpen, or run more processes -- but read the guide first: a broadcast reaches one process';

      throw error;
    }

    this.warnSingleProcess();

    const stream = new Stream(this.henri, req, res, {
      ...options,
      settings: this.settings,
    });

    this.registry.add(stream);

    return stream.open();
  }

  /**
   * Sends an event to the subscribers of a topic **on this process**.
   *
   * Every one of them is asked its own policy question first, so the count
   * this answers is how many people were allowed to be told -- which is
   * not how many asked to be.
   *
   * @async
   * @param {string} topic the topic
   * @param {string} event the event name
   * @param {*} [data=null] what it carries, published and stripped per
   *   subscriber before it goes out
   * @param {object} [options={}] `{ id }`, the event id henri never invents
   * @returns {Promise<number>} how many subscribers it reached
   * @memberof StreamsModule
   */
  async publish(topic, event, data = null, options = {}) {
    check('henri.streams.publish', [topic, event, data, options]);

    // The event is walked here and not only where the frame is built:
    // `Registry#publish()` catches what a subscriber's `send()` throws, so
    // a newline in it was a log line where somebody was listening and
    // nothing at all where nobody was -- and the caller, whose mistake it
    // is, heard about it neither way. The topic is walked here already
    return this.registry.publish(topicOf(topic), {
      data,
      event: field('event', event),
      id: field('id', options.id || null),
    });
  }

  /**
   * How many streams this process is holding
   *
   * @param {string} [topic] one topic, or nothing for every one
   * @returns {number} the count
   * @memberof StreamsModule
   */
  count(topic) {
    check('henri.streams.count', [topic]);

    return this.registry.count(topic);
  }

  /**
   * The topics somebody is subscribed to on this process
   *
   * @returns {Array<string>} the topics
   * @memberof StreamsModule
   */
  topics() {
    return [...this.registry.topics.keys()];
  }

  /**
   * Ends every open stream, so the drain has nothing to wait for.
   *
   * `Server#drain()` calls this before it closes the listener: a response
   * that never ends would otherwise sit through `shutdown.drain` and be
   * destroyed at the deadline on every deploy. Each stream leaves with a
   * jittered `retry:`, so the clients come back spread out and land on a
   * process that is still accepting.
   *
   * @param {string} [reason='draining'] why
   * @returns {number} how many were closed
   * @memberof StreamsModule
   */
  drain(reason = 'draining') {
    const closed = this.registry ? this.registry.closeAll(reason) : 0;

    if (closed > 0) {
      this.henri.pen.info(
        'streams',
        `${closed} stream(s) closed`,
        'the clients reconnect on their own'
      );
    }

    return closed;
  }

  /**
   * A reload drops nothing: the connections are the people who are
   * connected, and the code that changed under them is the code that will
   * answer their next event.
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof StreamsModule
   */
  async reload() {
    this.settings = settings(this.henri.config);

    if (this.registry) {
      for (const stream of this.registry.streams) {
        stream.settings = this.settings;
      }
    }

    return this.name;
  }

  /**
   * Stops the module: every stream ends
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof StreamsModule
   */
  async stop() {
    this.drain('stopping');

    return this.name;
  }
}

module.exports = StreamsModule;
