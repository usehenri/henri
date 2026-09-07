/**
 * The inbox: the mail an application was asked to send during a test.
 *
 * Reading the message back is what a Rails test does constantly -- how many
 * went out, to whom, with what subject, saying what -- and until now a henri
 * test had to reach into nodemailer or into the queue to do it. The inbox is
 * a plain array, oldest first, and the test asserts on it with whatever
 * `expect` it already has:
 *
 *   const { inbox } = require('@usehenri/testing');
 *
 *   await request().post('/signup').send({ email: 'ada@example.com', ... });
 *
 *   const [mail] = inbox();
 *
 *   expect(inbox()).toHaveLength(1);
 *   expect(mail.to).toContain('ada@example.com');
 *   expect(mail.subject).toBe('Confirm your address');
 *   expect(mail.html).toContain('/confirm/');
 *
 * A plain value rather than a matcher, deliberately: the application's suite
 * is its own Vitest, and an array composes with `toHaveLength`, `find`,
 * `filter` and every assertion the developer already knows. A matcher would
 * have to be registered, would only work in one runner, and would answer
 * fewer questions.
 *
 * ## Where it lives, and how you know it is per-application
 *
 * On the henri instance, under a symbol (`henri[INBOX]`), never in a module
 * variable. A test worker boots an application of its own (`setup()`, one
 * MongoDB per file with `@usehenri/disk`), so "whose mail is this" has to be
 * decided by *which application you booted*, not by which copy of this
 * module got loaded. Two instances in one process -- a suite that boots a
 * second application, a `teardown()` followed by a `setup()` -- get two
 * arrays, and the second one starts empty because the property went with the
 * instance that is gone.
 *
 * The capture sites are per-instance for the same reason: `henri.mail.send`,
 * `henri.mailers.enqueue` and `henri.mailers.message` are bound in their
 * modules' constructors, so they are own properties of that instance's
 * modules. Nothing on a prototype is touched, so nothing another application
 * in the same process would see is touched either.
 *
 * ## Why both seams, and not one
 *
 * A message leaves through one of two doors and an inbox that watches one of
 * them is a trap:
 *
 * - `deliver()` renders and hands the payload to `henri.mail.send()`, the
 *   transport (nodemailer's JSON transport under `NODE_ENV=test`);
 * - `deliverLater()` renders and hands it to `henri.mailers.enqueue()`,
 *   which is the delivery handler `@usehenri/jobs` registers -- a queue row,
 *   sent later by a runner that a test never starts. Without the queue the
 *   same call sends out of band, through the transport.
 *
 * So the inbox watches both, and every entry says which door it went
 * through (`deferred`). An application that installs the queue and one that
 * does not both see the mail their code asked for, which is the point: the
 * assertion is about the application, not about its dependencies.
 *
 * The one thing that must not happen is counting a message twice, and it is
 * exactly the case where both doors are involved: without a queue,
 * `enqueue()` hands the very same payload object to the transport. The
 * enqueue hook marks that object before it calls through, and the transport
 * hook skips a payload that carries the mark. A queued message is a
 * different story -- the runner rehydrates it from JSON, so performing the
 * `henri/mail` job in a test really does add a second entry, `deferred:
 * false` this time, because two things really did happen.
 *
 * @module @usehenri/testing/mail
 */

const { notRunning, stamp } = require('./errors');

/**
 * Where an application's inbox hangs off its henri instance.
 *
 * `Symbol.for`, so two copies of this package (the application's and a
 * linked one) still agree on where the inbox is.
 */
const INBOX = Symbol.for('@usehenri/testing.inbox');

/** What `inbox({ ... })` filters on */
const FILTERS = ['action', 'deferred', 'mailer', 'subject', 'to'];

/**
 * The running instance, or a failure naming what is missing
 *
 * @returns {object} the henri instance
 * @throws when nothing booted the application
 */
const running = () => {
  // Lazily, so this module and index.js may require each other
  const { henri } = require('./index.js');

  if (!henri) {
    throw notRunning();
  }

  return henri;
};

/**
 * The addresses of a header, in the order they were written.
 *
 * A comma separates them, unless it sits inside a quoted display name
 * (`"Doe, Ada" <ada@example.com>`) or inside the angle brackets.
 *
 * @param {string} value the header
 * @returns {Array<string>} the parts, still addressed
 */
const parts = (value) => {
  const found = [];
  let current = '';
  let quoted = false;
  let angled = false;

  for (const char of value) {
    if (char === ',' && !quoted && !angled) {
      found.push(current);
      current = '';
    } else {
      char === '"' && !angled && (quoted = !quoted);
      char === '<' && !quoted && (angled = true);
      char === '>' && !quoted && (angled = false);
      current += char;
    }
  }

  found.push(current);

  return found;
};

/**
 * The addresses of a recipient header, whatever shape nodemailer was given:
 * a string, `'Ada <ada@example.com>'`, a comma separated list, an
 * `{ address, name }` object, or an array of any of those.
 *
 * @param {*} value what the message carried
 * @param {Array<string>} [found=[]] what has been collected so far
 * @returns {Array<string>} the addresses
 */
const addresses = (value, found = []) => {
  if (!value) {
    return found;
  }

  if (Array.isArray(value)) {
    for (const one of value) {
      addresses(one, found);
    }

    return found;
  }

  if (typeof value === 'object') {
    typeof value.address === 'string' && found.push(value.address.trim());

    return found;
  }

  if (typeof value !== 'string') {
    return found;
  }

  for (const part of parts(value)) {
    const angled = /<([^>]*)>/u.exec(part);
    const address = (angled ? angled[1] : part).trim();

    address && found.push(address);
  }

  return found;
};

/**
 * One entry of the inbox: what henri rendered, with the parts a test asserts
 * on lifted out of the nodemailer payload
 *
 * @param {object} capture the capture record of the application
 * @param {object} payload the rendered message
 * @param {object} options `{ deferred, options }`
 * @returns {object} the entry
 */
const entry = (capture, payload, { deferred, options = {} }) => {
  const from = capture.from.get(payload) || {};

  return {
    /** The mailer action that produced it (`confirm`), when one did */
    action: from.action || null,
    bcc: addresses(payload.bcc),
    cc: addresses(payload.cc),
    /** True when it went through `deliverLater()` */
    deferred: Boolean(deferred),
    from: addresses(payload.from)[0] || null,
    html: typeof payload.html === 'string' ? payload.html : null,
    /** The mailer that produced it (`welcome`), when one did */
    mailer: from.mailer || null,
    /** The nodemailer payload itself: attachments, headers, everything */
    message: payload,
    /** What `deliverLater()` was called with (`wait`, `at`, `queue`) */
    options: options || {},
    subject: typeof payload.subject === 'string' ? payload.subject : null,
    text: typeof payload.text === 'string' ? payload.text : null,
    to: addresses(payload.to),
  };
};

/**
 * Put a message in the inbox
 *
 * @param {object} capture the capture record of the application
 * @param {object} payload the rendered message
 * @param {object} options `{ deferred, options }`
 * @returns {?object} the entry, or null when there was nothing to record
 */
const record = (capture, payload, options) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const recorded = entry(capture, payload, options);

  capture.messages.push(recorded);

  return recorded;
};

/**
 * Remember which mailer action rendered a payload.
 *
 * The rendered message is nodemailer's shape and carries no such thing, so
 * the answer is kept next to it in a WeakMap: nothing is written on the
 * object that goes to the transport, or into a queue row.
 *
 * @param {object} capture the capture record of the application
 * @param {object} message the Message the mailer action built
 * @returns {object} the same message
 */
const attribute = (capture, message) => {
  if (!message || typeof message.render !== 'function') {
    return message;
  }

  const render = message.render;

  message.render = async (...args) => {
    const payload = await render(...args);

    payload &&
      typeof payload === 'object' &&
      capture.from.set(payload, {
        action: message.action,
        mailer: message.mailer,
      });

    return payload;
  };

  return message;
};

/**
 * Watch the transport: every message that reaches `henri.mail.send()`,
 * whether a mailer rendered it or the application wrote it by hand
 *
 * @param {object} henri the running instance
 * @param {object} capture the capture record of the application
 * @returns {boolean} whether the hook went in
 */
const watchTransport = (henri, capture) => {
  const { mail } = henri;

  if (!mail || typeof mail.send !== 'function') {
    return false;
  }

  const send = mail.send;

  mail.send = async (payload, ...rest) => {
    const answer = await send(payload, ...rest);

    // Read after the send, not before: the inline fallback of
    // `deliverLater()` hands this very object to the transport, and the
    // enqueue hook has marked it by the time this resolves
    capture.recorded.has(payload) ||
      record(capture, payload, { deferred: false });

    return answer;
  };

  capture.restore.push(() => {
    mail.send = send;
  });

  return true;
};

/**
 * Watch the mailers: what `deliverLater()` hands to the delivery handler,
 * and which action rendered each message
 *
 * @param {object} henri the running instance
 * @param {object} capture the capture record of the application
 * @returns {boolean} whether the hooks went in
 */
const watchMailers = (henri, capture) => {
  const { mailers } = henri;

  if (!mailers || typeof mailers.enqueue !== 'function') {
    return false;
  }

  const enqueue = mailers.enqueue;

  mailers.enqueue = async (payload, options = {}) => {
    // Marked before the call, not after: without `@usehenri/jobs` the
    // original sends this very object out of band, and the transport hook
    // must not record it a second time
    payload && typeof payload === 'object' && capture.recorded.add(payload);

    const answer = await enqueue(payload, options);

    record(capture, payload, { deferred: true, options });

    return answer;
  };

  capture.restore.push(() => {
    mailers.enqueue = enqueue;
  });

  if (typeof mailers.message === 'function') {
    const message = mailers.message;

    mailers.message = (...args) => attribute(capture, message(...args));

    capture.restore.push(() => {
      mailers.message = message;
    });
  }

  return true;
};

/**
 * Start capturing the mail of an application.
 *
 * `setup()` calls it, and so does `inbox()` -- an application booted another
 * way still answers, from the first call on. Applying it twice is a no-op.
 *
 * @param {object} [henri] the instance (defaults to the running one)
 * @returns {object} the capture record `{ from, messages, recorded, restore }`
 * @throws when nothing booted the application
 */
const captureMail = (henri = running()) => {
  if (henri[INBOX]) {
    return henri[INBOX];
  }

  const capture = {
    /** Payload -> the mailer action that rendered it */
    from: new WeakMap(),
    /** The inbox itself */
    messages: [],
    /** The payloads the deferred door already recorded */
    recorded: new WeakSet(),
    /** How to put the instance back the way it was */
    restore: [],
  };

  watchTransport(henri, capture);
  watchMailers(henri, capture);

  Object.defineProperty(henri, INBOX, {
    configurable: true,
    value: capture,
    writable: true,
  });

  return capture;
};

/**
 * Stop capturing and put the instance back the way it was
 *
 * @param {object} henri the instance
 * @returns {boolean} whether there was anything to release
 */
const releaseMail = (henri) => {
  const capture = henri && henri[INBOX];

  if (!capture) {
    return false;
  }

  for (const restore of capture.restore.reverse()) {
    restore();
  }

  delete henri[INBOX];

  return true;
};

/**
 * Does a value answer what the filter asked for? A regular expression is
 * tested, a string compared, and an address compared without its case
 *
 * @param {*} value what the message holds
 * @param {*} wanted what the filter asked for
 * @returns {boolean} yes or no
 */
const same = (value, wanted) => {
  if (wanted instanceof RegExp) {
    return typeof value === 'string' && wanted.test(value);
  }

  if (typeof value === 'string' && typeof wanted === 'string') {
    return value.toLowerCase() === wanted.toLowerCase();
  }

  return value === wanted;
};

/**
 * What the caller wants out of the inbox
 *
 * @param {(object|Function)} [filter] the filter
 * @returns {Function} a predicate
 * @throws when the filter names something the inbox does not hold
 */
const matching = (filter) => {
  if (typeof filter === 'undefined' || filter === null) {
    return () => true;
  }

  if (typeof filter === 'function') {
    return filter;
  }

  if (typeof filter !== 'object') {
    throw stamp(
      new Error(
        `@usehenri/testing: inbox() takes a filter object or a function, not ${typeof filter}`
      ),
      'HENRI_ARGUMENT_INVALID'
    );
  }

  const unknown = Object.keys(filter).filter((key) => !FILTERS.includes(key));

  // Silently ignoring it would make the assertion pass for the wrong reason,
  // which is the one failure mode a test helper must not have
  if (unknown.length > 0) {
    throw stamp(
      new Error(
        `@usehenri/testing: inbox() does not filter on ${unknown.join(', ')} (it filters on ${FILTERS.join(', ')}); pass a function for anything else`
      ),
      'HENRI_ARGUMENT_INVALID'
    );
  }

  return (mail) =>
    FILTERS.every((key) => {
      if (!Object.prototype.hasOwnProperty.call(filter, key)) {
        return true;
      }

      const wanted = filter[key];

      return key === 'to'
        ? mail.to.some((address) => same(address, wanted))
        : same(mail[key], wanted);
    });
};

/**
 * The mail the application was asked to send, oldest first.
 *
 *     expect(inbox()).toHaveLength(1);
 *     expect(inbox({ to: user.email })).toHaveLength(1);
 *     expect(inbox({ mailer: 'welcome', deferred: true })).toHaveLength(1);
 *     expect(inbox((mail) => mail.text.includes('reset'))).toHaveLength(1);
 *
 * The filter takes `action`, `deferred`, `mailer`, `subject` and `to`; a
 * string is compared (an address without its case), a regular expression is
 * tested, and a function is the escape hatch for everything else.
 *
 * @param {(object|Function)} [filter] what to keep
 * @returns {Array<object>} the messages
 * @throws when nothing booted the application, or the filter names something
 *   the inbox does not hold
 */
const inbox = (filter) => captureMail().messages.filter(matching(filter));

/**
 * Empty the inbox.
 *
 * `@usehenri/testing/setup-file` calls it before every test, so nothing a
 * test asserts on can come from another one. A suite that boots henri
 * another way calls it in its own `beforeEach`.
 *
 * @returns {boolean} false when there was no application to empty
 */
const clearInbox = () => {
  // Not `running()`: emptying an inbox that does not exist is not a failure,
  // which is what makes this safe in a `beforeEach` that runs before the
  // first boot and after the last teardown
  const { henri } = require('./index.js');
  const capture = henri && henri[INBOX];

  if (!capture) {
    return false;
  }

  capture.messages.length = 0;

  return true;
};

module.exports = {
  FILTERS,
  INBOX,
  addresses,
  captureMail,
  clearInbox,
  inbox,
  releaseMail,
};
