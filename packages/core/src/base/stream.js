/**
 * `res.stream()`: real time as a route, and the policy asked on every event.
 *
 * henri's answer to "push something to the browser" is server-sent events.
 * It is a `GET` that does not end, on the http server henri already runs,
 * through the router, the session, the role guard and the policies that
 * every other route goes through. There is no second protocol, no second
 * port, no sticky sessions and no dependency: `EventSource` is in every
 * browser, a proxy needs nothing configured, and a stream that breaks is
 * reconnected by the client rather than by a library.
 *
 * ```js
 * // app/controllers/proposals.js
 * events: async (req, res) => {
 *   const proposal = await Proposal.findById(req.params.id);
 *
 *   if (!proposal) {
 *     return res.notFound();
 *   }
 *
 *   return res.stream(`proposal:${proposal.externalId}`, {
 *     subject: proposal,
 *   });
 * },
 * ```
 *
 * ```js
 * // anywhere: a controller, a job, a model hook
 * await henri.streams.publish(`proposal:${proposal.externalId}`, 'changed', proposal);
 * ```
 *
 * ## What a subscription is a stream *of*
 *
 * Two things, named separately, because they answer different questions.
 *
 * The **topic** is the address `publish()` writes to. It is a string, and
 * it is chosen by the *controller* -- never by the client. A client asks
 * for a route; the controller loads what that route is about, asks the
 * policy, and only then decides which topic this connection is on. There
 * is no endpoint anywhere in henri that takes a topic from a query string,
 * because "subscribe to whatever you name" is the whole vulnerability in
 * one line.
 *
 * The **subject** is the record the subscription is about, and it is what
 * the policy is asked about. A stream without one is a stream of a
 * collection, and it is asked the record-less question (`index`) the same
 * way `req.can('index')` is.
 *
 * ## The policy, asked twice, and the second time is the point
 *
 * **At subscribe time**, before a byte: `req.authorize(action, subject)`.
 * A refused subscription answers the ordinary refusal -- the configured
 * 404, or a 401 and the login page for an anonymous visitor -- negotiated
 * by `base/http.js` like every other refusal, and *not* a stream carrying
 * an error event. An `EventSource` that receives a non-2xx status fails
 * permanently and does not retry, which is exactly right for a refusal,
 * and a refused subscription is byte-for-byte the answer a route that does
 * not exist gives (see `refusal()` in `3.policies.js`, and #418).
 *
 * A stream cannot be opened without a policy to ask. `res.stream()` refuses
 * with `HENRI_STREAM_POLICY_REQUIRED` when nothing names one -- there is no
 * setting that turns that into a yes, and an application whose stream
 * really is public writes `show: () => true` in the policy file and has
 * said so on purpose.
 *
 * **On every event**, before it is written, the same questions again:
 *
 * - the subscription's own (`action`, `subject`), and
 * - the one about the record the event carries (`each`, that record), when
 *   it carries one.
 *
 * Both have to say yes. This is the part that is not optional. A stream is
 * a decision made once and answered from for hours: a subscription opened
 * at nine is still open at five, and in between a proposal was
 * unpublished, an owner changed and somebody left a team. Asking once
 * would make an eight-hour stream exactly as safe as the state of the
 * world at nine o'clock. Asking per event makes it as safe as sixty
 * one-minute requests, which is what it is pretending to be.
 *
 * A refusal is **silent**. The event is not written and nothing tells the
 * subscriber that an event existed: `event: denied` would say "something
 * just happened to a record you may not see", which is the leak with a
 * politer name. The count is on the stream (`dropped`) for the application
 * to read, and nowhere else.
 *
 * And it costs what it costs: a broadcast to a thousand subscribers is a
 * thousand policy questions. That is the right price -- it is a thousand
 * answers leaving the server -- and an application that cannot pay it
 * publishes to a narrower topic (one per person) so the fan-out is small.
 * A rule that queries the database runs here, once per event per
 * subscriber, so it should not.
 *
 * ## What the subject cannot tell you, and what bounds it
 *
 * The subject is the copy loaded at subscribe time. So is the user, and so
 * is the session behind it. Re-asking the policy against a record held in
 * memory re-reads the *rule*, not the row: if the proposal was unpublished
 * an hour ago, this stream's copy still says published.
 *
 * The bound on that staleness is `streams.maxAge` (fifteen minutes), and
 * it is free, because the protocol already has the answer. henri ends the
 * stream cleanly when it reaches its age; the client's `EventSource`
 * reconnects on its own; the controller runs again; the record is loaded
 * again, the session is deserialized again -- and `passwordChangedAt`,
 * a revoked membership, a deleted account and an unpublished record are
 * all seen at that moment. Nothing an application writes has to know this
 * happened.
 *
 * The event's own record has no such problem: whoever called `publish()`
 * was holding it.
 *
 * ## The exit gate
 *
 * Every event's data goes through `toPublic()` -- `publish()` then
 * `henri.privacy.strip()` -- the same call `res.resource()`,
 * `res.collection()`, `res.render()` and `res.csv()` make. A foreign key
 * leaves as the `externalId` of the row it names, no primary key leaves at
 * all, and a field marked `personal: { expose: false }` is not in the
 * frame. `include` is the way back, declared on the subscription, because
 * the shape of the answer belongs to whoever is being answered.
 *
 * Data is **always JSON**. There is no way to write bytes to a stream,
 * because bytes are where the gate stops being able to see anything: the
 * point `base/answers.js` makes about `res.send(JSON.stringify(value))` is
 * the same point, and an escape hatch here would be a hole in every one of
 * those guarantees.
 *
 * ## More than one process: it does not fan out, and that is the headline
 *
 * A connection lives on the process that accepted it. `publish()` reaches
 * the subscribers **of this process** and nobody else. Two workers behind
 * a load balancer means a broadcast reaches roughly half of the people who
 * asked for it, and there is no error anywhere to tell you.
 *
 * henri does not paper over this. It says it in the guide in a box at the
 * top, and it warns on the first stream a process opens whenever the
 * environment says this process is one of several -- a cluster worker,
 * `WEB_CONCURRENCY`, a numbered pm2 instance (`manyProcesses()`, the same
 * evidence the rate limit and the cache use). A cross-process fan-out over
 * `config.shared` is a real feature and it is not in this release.
 *
 * ## Reconnection: henri promises nothing, out loud
 *
 * SSE has `Last-Event-ID` and a retry hint. henri sends the hint
 * (`streams.retry`) and hands the header to the controller as
 * `req.lastEventId`, and that is the entire feature. **There is no buffer
 * and there is no replay.** Whatever happened while a client was
 * reconnecting did not reach it, and henri has no idea what that was.
 *
 * henri therefore never invents an `id:` either. An id is a promise that
 * the stream can be resumed from it, and henri cannot keep that promise --
 * so the field appears only when the application sets one, on a stream it
 * can replay itself from `req.lastEventId`. A buffer that lies is worth
 * less than a sentence that does not.
 *
 * ## The drain, and the request timeout
 *
 * A response that never ends holds a shutdown open forever, so the drain
 * ends them first. `Server#drain()` (`2.server.js`) closes every open
 * stream *before* it closes the listener: each one gets a fresh, jittered
 * `retry:` and then ends, so the clients come back spread over a few
 * seconds and land on a process that is still accepting. Without this,
 * every stream would sit through `shutdown.drain` and be destroyed at the
 * deadline, with a line about it, on every single deploy.
 *
 * `config.requestTimeout` is the other one. Its rule is "nothing is sent
 * once the headers are out" (`base/timeout.js`), which is already right,
 * but it would still set `req.timedout` on a stream that is behaving
 * perfectly -- a flag that means "stop, nobody is waiting for this". So a
 * stream takes the timer off when it opens (`res.emit('henri:stream')`):
 * the request is not one without an answer, it is one whose answer began.
 *
 * ## The bounds
 *
 * - `streams.heartbeat` (25s): a comment frame, which keeps an idle
 *   connection from being closed by a proxy and is how a dead client is
 *   noticed. It carries no data and is never gated -- there is nothing in
 *   it.
 * - `streams.maxOpen` (1000): how many streams one process will hold. Over
 *   it, a 503 with a `Retry-After` -- a file descriptor limit reached by
 *   surprise takes the whole application down, not just the streams.
 * - `streams.maxBuffer` (1mb): a subscriber that is not reading has its
 *   stream closed rather than allowed to become this process's memory.
 *   It reconnects; it misses what it missed, which henri already said it
 *   would.
 *
 * ## No regular expression anywhere in this file
 *
 * The framing is a walk over code points, like `base/csv.js`. A payload is
 * split into `data:` lines by walking it, `Last-Event-ID` is validated by
 * walking it, and an event name is checked by walking it -- which is not
 * only about backtracking here. An `event` or an `id` holding a newline
 * would let whoever chose it write raw SSE fields into the frame, so those
 * two are refused (`HENRI_STREAM_EVENT_INVALID`) rather than escaped.
 *
 * @module base/stream
 */

const { fail } = require('./errors');

/** What an application gets without saying anything */
const DEFAULTS = Object.freeze({
  heartbeat: 25000,
  maxAge: 900000,
  maxBuffer: 1048576,
  maxOpen: 1000,
  retry: 3000,
});

/** The longest `Last-Event-ID` henri hands a controller */
const MAX_EVENT_ID = 256;

/** The longest topic henri will address */
const MAX_TOPIC = 256;

/** How much of `retry` the drain jitters by, so clients do not return together */
const JITTER = 0.5;

/**
 * A positive number, `false`, or the fallback
 *
 * @param {*} value what the configuration held
 * @param {number} fallback what henri uses instead
 * @returns {(number|false)} milliseconds, or false for "never"
 */
function duration(value, fallback) {
  if (value === false) {
    return false;
  }

  return Number.isFinite(Number(value)) && Number(value) > 0
    ? Number(value)
    : fallback;
}

/**
 * The normalized `streams` settings
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {object} the settings
 */
function settings(config) {
  const has =
    Boolean(config) &&
    typeof config.has === 'function' &&
    config.has('streams');
  const raw = has ? config.get('streams') : {};
  const asked =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  return {
    heartbeat: duration(asked.heartbeat, DEFAULTS.heartbeat),
    maxAge: duration(asked.maxAge, DEFAULTS.maxAge),
    maxBuffer: duration(asked.maxBuffer, DEFAULTS.maxBuffer),
    maxOpen: duration(asked.maxOpen, DEFAULTS.maxOpen),
    retry: duration(asked.retry, DEFAULTS.retry),
  };
}

/**
 * Is every code point of this string writable in an SSE field?
 *
 * A walk, not a pattern: a newline or a carriage return in an `event` or an
 * `id` would end the field and let whoever chose it write raw SSE fields
 * into the frame, which is why these are refused rather than escaped.
 *
 * @param {string} value the field value
 * @returns {boolean} true when it holds no control character
 */
function writable(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  return true;
}

/**
 * An SSE field value, or a refusal naming what is wrong with it
 *
 * @param {string} what the field (`event`, `id`)
 * @param {*} value what the application passed
 * @returns {?string} the value, or null when there was none
 * @throws {Error} `HENRI_STREAM_EVENT_INVALID` when it cannot be written
 */
function field(what, value) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  const text = String(value);

  if (text.length === 0 || !writable(text)) {
    const error = fail(
      'HENRI_STREAM_EVENT_INVALID',
      `the ${what} of a stream event must be a non-empty string without control characters, and it is ${JSON.stringify(text)}`
    );

    // A newline there would end the field and let whoever chose it write
    // raw SSE fields into the frame, so it is refused rather than escaped
    error.hint = `name it something like "changed" or "proposal.updated": henri.streams.publish(topic, "changed", record)`;

    throw error;
  }

  return text;
}

/**
 * Splits a payload into the `data:` lines of one frame.
 *
 * The event stream format is decoded line by line, and a line ends at a
 * line feed, a carriage return, or the two together -- so a payload that
 * holds any of them is several `data:` lines rather than one. Walked
 * rather than matched, like every other split in this repository.
 *
 * @param {string} text the payload
 * @returns {Array<string>} the lines, at least one
 */
function dataLines(text) {
  const lines = [];
  let line = '';

  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);

    if (code === 0x0a) {
      lines.push(line);
      line = '';
      continue;
    }

    if (code === 0x0d) {
      lines.push(line);
      line = '';

      if (text.charCodeAt(index + 1) === 0x0a) {
        index++;
      }
      continue;
    }

    line += text[index];
  }

  lines.push(line);

  return lines;
}

/**
 * One event stream frame
 *
 * @param {object} parts what goes in it
 * @param {string} [parts.comment] a comment (no data, no event)
 * @param {string} [parts.data] the payload, already JSON
 * @param {string} [parts.event] the event name
 * @param {string} [parts.id] the event id
 * @param {number} [parts.retry] the reconnection hint (ms)
 * @returns {string} the frame, terminated
 */
function frame(parts = {}) {
  const { comment, data, event, id, retry } = parts;
  let out = '';

  if (typeof comment === 'string') {
    for (const line of dataLines(comment)) {
      out += `: ${line}\n`;
    }
  }

  if (Number.isFinite(retry)) {
    out += `retry: ${Math.trunc(retry)}\n`;
  }

  if (typeof id === 'string') {
    out += `id: ${id}\n`;
  }

  if (typeof event === 'string') {
    out += `event: ${event}\n`;
  }

  if (typeof data === 'string') {
    for (const line of dataLines(data)) {
      out += `data: ${line}\n`;
    }
  }

  return out.length > 0 ? `${out}\n` : '';
}

/**
 * The `Last-Event-ID` of a request, as far as henri will believe it.
 *
 * Client input, so: a walk, a length cap, and no pattern. It is handed to
 * the controller and used for nothing else -- henri replays nothing, so
 * there is nothing here for a bad value to reach.
 *
 * @param {Express.Request} req the request
 * @returns {?string} the id, or null when there is none henri will pass on
 */
function lastEventId(req) {
  const raw =
    req && typeof req.get === 'function' ? req.get('last-event-id') : null;

  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > MAX_EVENT_ID
  ) {
    return null;
  }

  return writable(raw) ? raw : null;
}

/**
 * The topic a subscription is on, or a refusal
 *
 * @param {*} value what the controller named
 * @returns {string} the topic
 * @throws {Error} `HENRI_STREAM_TOPIC_INVALID` when it is not a usable name
 */
function topicOf(value) {
  const text = typeof value === 'string' ? value : '';

  if (text.length === 0 || text.length > MAX_TOPIC || !writable(text)) {
    const error = fail(
      'HENRI_STREAM_TOPIC_INVALID',
      `a stream topic is a string of 1 to ${MAX_TOPIC} characters without control characters, and this one is ${JSON.stringify(String(value))}`
    );

    error.hint =
      'the controller names the topic and the client never does: ' +
      'res.stream(`proposal:${proposal.externalId}`, { subject: proposal })';

    throw error;
  }

  return text;
}

/**
 * The publish-then-strip pass every answer leaves through.
 *
 * Required late, the way `base/csv.js` does it: `base/hateoas.js` reaches
 * `base/filters.js` through `base/embeds.js`, and asking for the gate when
 * it is used rather than when this file loads breaks the cycle.
 *
 * @param {Henri} henri the henri instance
 * @param {*} value the record, or whatever the application published
 * @param {Array<string>} include the personal fields this stream may carry
 * @returns {Promise<*>} the published, stripped copy
 */
function toPublic(henri, value, include) {
  return require('./hateoas').toPublic(henri, value, include);
}

/**
 * One open connection.
 *
 * @class Stream
 */
class Stream {
  /**
   * Creates an instance of Stream.
   *
   * @param {Henri} henri the henri instance
   * @param {Express.Request} req the request
   * @param {Express.Response} res the response
   * @param {object} options what the controller declared
   * @memberof Stream
   */
  constructor(henri, req, res, options = {}) {
    this.henri = henri;
    this.req = req;
    this.res = res;

    /** The address `publish()` writes to */
    this.topic = options.topic;
    /** The subscription's own question */
    this.action = options.action;
    /** The question asked of each record an event carries */
    this.each = options.each;
    /** The record this subscription is about, as it was at subscribe time */
    this.subject =
      typeof options.subject === 'undefined' ? null : options.subject;
    /** The policy name, when the controller named one */
    this.policy = options.policy || null;
    /** The personal fields this stream may carry */
    this.include = Array.isArray(options.include) ? options.include : [];
    /** Whoever opened it, as they were at subscribe time */
    this.user = (req && req.user) || null;
    /** The normalized `config.streams` */
    this.settings = options.settings || settings(null);
    /** The registry holding it */
    this.registry = options.registry || null;

    this.opened = Date.now();
    this.sent = 0;
    this.dropped = 0;
    this.closed = false;
    this.reason = null;

    this._age = null;
    this._beat = null;
  }

  /** @returns {number} how long this stream has been open (ms) */
  get age() {
    return Date.now() - this.opened;
  }

  /**
   * Writes the headers, the retry hint and arms the timers.
   *
   * `no-transform` is what takes this response out of the compression
   * middleware's hands (it honours the directive), and `X-Accel-Buffering`
   * is nginx's own way of being told not to buffer -- a proxy that buffers
   * turns a stream into a very slow response and nothing says so.
   *
   * @returns {Stream} itself
   * @memberof Stream
   */
  open() {
    const { req, res } = this;

    res.status(200);
    res.set('Content-Type', 'text/event-stream; charset=utf-8');
    res.set('Cache-Control', 'no-cache, no-transform');
    res.set('X-Accel-Buffering', 'no');

    // Illegal on HTTP/2, where the connection is not the response's business
    if (!req || !req.httpVersionMajor || req.httpVersionMajor < 2) {
      res.set('Connection', 'keep-alive');
    }

    typeof res.flushHeaders === 'function' && res.flushHeaders();

    // The request timeout (base/timeout.js) comes off here: this request's
    // answer has begun, so the timer that would flag it as unanswered would
    // be firing into a response whose headers went out long ago
    res.emit('henri:stream');

    this.write(frame({ retry: this.settings.retry || undefined }));

    if (this.settings.heartbeat) {
      this._beat = setInterval(
        () => this.comment('keep-alive'),
        this.settings.heartbeat
      );
      typeof this._beat.unref === 'function' && this._beat.unref();
    }

    if (this.settings.maxAge) {
      this._age = setTimeout(() => this.close('max-age'), this.settings.maxAge);
      typeof this._age.unref === 'function' && this._age.unref();
    }

    res.on('close', () => this.close('client'));

    return this;
  }

  /**
   * May this event go out to this subscriber?
   *
   * Two questions, both fail closed: the subscription's own, and the one
   * about the record the event carries when it carries one. A value that
   * names no model is not a record -- the same inference `henri.can()`
   * makes -- so there is nothing to ask about it and the subscription's
   * question stands alone.
   *
   * @async
   * @param {*} value what is being published
   * @returns {Promise<boolean>} allowed or not
   * @memberof Stream
   */
  async allows(value) {
    const { policies } = this.henri;

    if (!policies) {
      return false;
    }

    const asked = { policy: this.policy, req: this.req };

    if (!(await policies.answer(this.user, this.action, this.subject, asked))) {
      return false;
    }

    if (!policies.nameFor(value, {})) {
      return true;
    }

    return policies.answer(this.user, this.each, value, { req: this.req });
  }

  /**
   * Sends one event, if the policy still says so.
   *
   * @async
   * @param {object} payload `{ data, event, id }`
   * @returns {Promise<boolean>} whether it went out
   * @memberof Stream
   */
  async send(payload = {}) {
    if (this.closed || this.res.writableEnded) {
      return false;
    }

    const event = field('event', payload.event);
    const id = field('id', payload.id);

    if (!(await this.allows(payload.data))) {
      this.dropped++;

      return false;
    }

    const { henri } = this;
    const body = await toPublic(henri, payload.data, this.include);

    henri.trail && (await henri.trail.seen(this.req, payload.data));

    const written = this.write(
      frame({
        data: JSON.stringify(typeof body === 'undefined' ? null : body),
        event: event || undefined,
        id: id || undefined,
      })
    );

    if (written) {
      this.sent++;
    }

    return written;
  }

  /**
   * Writes a comment frame: no event, no data, nothing gated
   *
   * @param {string} text what to say
   * @returns {boolean} whether it went out
   * @memberof Stream
   */
  comment(text) {
    return this.write(frame({ comment: String(text) }));
  }

  /**
   * Writes to the socket, and closes a subscriber that is not reading.
   *
   * `res.flush()` is the compression middleware's, and is there whether or
   * not this response is being compressed (it is not: `no-transform`).
   *
   * @param {string} text the bytes
   * @returns {boolean} whether they were written
   * @memberof Stream
   */
  write(text) {
    const { res } = this;

    if (
      this.closed ||
      res.writableEnded ||
      res.destroyed ||
      text.length === 0
    ) {
      return false;
    }

    const flushed = res.write(text);

    typeof res.flush === 'function' && res.flush();

    if (
      !flushed &&
      this.settings.maxBuffer &&
      res.writableLength > this.settings.maxBuffer
    ) {
      // The alternative to closing is holding an unbounded queue of this
      // person's events in the memory of a process serving everybody else
      this.close('backpressure');

      return false;
    }

    return true;
  }

  /**
   * Ends the stream.
   *
   * A close henri decided (the age, the drain, a subscriber that is not
   * reading) re-issues a jittered `retry:` on the way out, so a thousand
   * clients do not all come back in the same millisecond.
   *
   * @param {string} [reason='server'] why
   * @returns {boolean} whether this call was the one that closed it
   * @memberof Stream
   */
  close(reason = 'server') {
    if (this.closed) {
      return false;
    }

    this.closed = true;
    this.reason = reason;

    this._beat && clearInterval(this._beat);
    this._age && clearTimeout(this._age);
    this._beat = null;
    this._age = null;

    this.registry && this.registry.forget(this);

    const { res } = this;

    if (reason !== 'client' && !res.writableEnded && !res.destroyed) {
      const { retry } = this.settings;

      if (retry) {
        res.write(
          frame({ retry: retry + Math.floor(Math.random() * retry * JITTER) })
        );
      }
      res.end();
    }

    return true;
  }

  /**
   * What this stream is, for a log line or `henri.streams.list()`
   *
   * @returns {object} the description
   * @memberof Stream
   */
  describe() {
    return {
      action: this.action,
      age: this.age,
      dropped: this.dropped,
      sent: this.sent,
      topic: this.topic,
    };
  }
}

/**
 * The open streams of this process, by topic.
 *
 * @class Registry
 */
class Registry {
  /**
   * Creates an instance of Registry.
   *
   * @param {Henri} henri the henri instance
   * @memberof Registry
   */
  constructor(henri) {
    this.henri = henri;
    this.topics = new Map();
    this.streams = new Set();
  }

  /** @returns {number} how many streams are open on this process */
  get size() {
    return this.streams.size;
  }

  /**
   * Adds a stream
   *
   * @param {Stream} stream the stream
   * @returns {Stream} the stream
   * @memberof Registry
   */
  add(stream) {
    const held = this.topics.get(stream.topic) || new Set();

    held.add(stream);
    this.topics.set(stream.topic, held);
    this.streams.add(stream);
    stream.registry = this;

    return stream;
  }

  /**
   * Drops a stream that has closed
   *
   * @param {Stream} stream the stream
   * @returns {boolean} whether it was held
   * @memberof Registry
   */
  forget(stream) {
    const held = this.topics.get(stream.topic);

    if (held) {
      held.delete(stream);

      if (held.size === 0) {
        this.topics.delete(stream.topic);
      }
    }

    return this.streams.delete(stream);
  }

  /**
   * How many streams are open, on one topic or on all of them
   *
   * @param {string} [topic] the topic, or nothing for every one
   * @returns {number} the count
   * @memberof Registry
   */
  count(topic) {
    if (typeof topic === 'undefined') {
      return this.streams.size;
    }

    const held = this.topics.get(topic);

    return held ? held.size : 0;
  }

  /**
   * Sends an event to the subscribers of a topic **on this process**.
   *
   * Every subscriber is asked its own policy question, so the number this
   * answers is the number of people who were allowed to be told, which is
   * not the number who asked.
   *
   * @async
   * @param {string} topic the topic
   * @param {object} payload `{ data, event, id }`
   * @returns {Promise<number>} how many subscribers it reached
   * @memberof Registry
   */
  async publish(topic, payload) {
    const held = this.topics.get(topic);

    if (!held || held.size === 0) {
      return 0;
    }

    const answers = await Promise.all(
      [...held].map((stream) =>
        stream.send(payload).catch((error) => {
          this.henri.pen &&
            this.henri.pen.error(
              'streams',
              `${topic} could not be delivered`,
              (error && error.message) || String(error)
            );

          return false;
        })
      )
    );

    return answers.filter(Boolean).length;
  }

  /**
   * Ends every open stream: the drain, and `henri.stop()`.
   *
   * @param {string} [reason='draining'] why
   * @returns {number} how many were closed
   * @memberof Registry
   */
  closeAll(reason = 'draining') {
    let closed = 0;

    for (const stream of [...this.streams]) {
      stream.close(reason) && closed++;
    }

    this.topics.clear();
    this.streams.clear();

    return closed;
  }
}

module.exports = {
  DEFAULTS,
  JITTER,
  MAX_EVENT_ID,
  MAX_TOPIC,
  Registry,
  Stream,
  dataLines,
  duration,
  field,
  frame,
  lastEventId,
  settings,
  topicOf,
  writable,
};
