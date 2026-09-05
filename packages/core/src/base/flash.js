/**
 * Flash messages: one-shot messages kept in the express session so they
 * survive exactly one redirect.
 *
 * ```js
 * req.flash('notice', 'Task saved');   // queue a message
 * res.redirect('/tasks');
 * // ... next request
 * req.flash('notice');                 // ['Task saved'], and the queue is empty
 * ```
 *
 * Reading clears what was read. Views get the whole bag through the view
 * options (`flash`), which reads it once per request (see `consume`).
 *
 * Without a user model an application has no session: `req.flash()` is then a
 * no-op answering an empty bag rather than throwing.
 */
const debug = require('debug')('henri:flash');

/** Where the messages live in the session */
const KEY = 'flash';

/**
 * The session of a request, when there is one
 *
 * @param {Express.Request} req the request
 * @returns {?object} `req.session` or null
 */
function sessionOf(req) {
  return req && req.session && typeof req.session === 'object'
    ? req.session
    : null;
}

/**
 * Everything queued, as a plain object of arrays
 *
 * @param {Express.Request} req the request
 * @returns {object} the messages by type (a copy)
 */
function pending(req) {
  const session = sessionOf(req);
  const bag = (session && session[KEY]) || {};
  const out = {};

  for (const type of Object.keys(bag)) {
    out[type] = [].concat(bag[type]);
  }

  return out;
}

/**
 * Queues one or many messages
 *
 * @param {Express.Request} req the request
 * @param {string} type the kind of message (`notice`, `alert`, ...)
 * @param {*} message the message (arrays are flattened)
 * @returns {Array} the messages of that type after the call
 */
function push(req, type, message) {
  const session = sessionOf(req);

  if (!session) {
    debug('no session: dropping the %s flash', type);

    return [];
  }

  const bag =
    session[KEY] && typeof session[KEY] === 'object' ? session[KEY] : {};
  const queue = [].concat(bag[type] || [], message);

  session[KEY] = Object.assign({}, bag, { [type]: queue });

  return [].concat(queue);
}

/**
 * Reads and clears
 *
 * @param {Express.Request} req the request
 * @param {?string} [type=null] one type, or null for everything
 * @returns {Array|object} the messages of that type, or the whole bag
 */
function take(req, type = null) {
  const session = sessionOf(req);
  const bag = pending(req);

  if (type === null) {
    if (session) {
      delete session[KEY];
    }

    return bag;
  }

  if (session && session[KEY]) {
    const rest = Object.assign({}, session[KEY]);

    delete rest[type];

    if (Object.keys(rest).length === 0) {
      delete session[KEY];
    } else {
      session[KEY] = rest;
    }
  }

  return bag[type] || [];
}

/**
 * The bag a view receives, read once per request: the first reader takes
 * everything queued before it, later readers get the same object so nothing
 * is lost when both `res.render()` and the view engine look at it.
 *
 * @param {Express.Request} req the request
 * @returns {object} the messages by type
 */
function consume(req) {
  if (!req._flash) {
    Object.defineProperty(req, '_flash', {
      configurable: true,
      enumerable: false,
      value: take(req),
      writable: true,
    });
  }

  return req._flash;
}

/**
 * Exposes the flash on an object as a lazily consumed, enumerable property,
 * so that reading `req._henri` (or copying it) takes the messages exactly
 * once, and a request that never renders leaves them in the session.
 *
 * @param {Express.Request} req the request
 * @param {object} target the object to decorate (`req._henri`)
 * @returns {object} the target
 */
function expose(req, target) {
  Object.defineProperty(target, 'flash', {
    configurable: true,
    enumerable: true,
    get: () => consume(req),
  });

  return target;
}

/**
 * Express middleware adding `req.flash()`
 *
 * `req.flash(type, message)` queues, `req.flash(type)` reads and clears one
 * type, `req.flash()` reads and clears everything.
 *
 * @returns {function} middleware
 */
function flashMiddleware() {
  return (req, res, next) => {
    req.flash = (type, message) => {
      if (typeof type === 'undefined') {
        return take(req);
      }

      if (typeof message === 'undefined') {
        return take(req, String(type));
      }

      return push(req, String(type), message);
    };

    next();
  };
}

module.exports = flashMiddleware;
module.exports.KEY = KEY;
module.exports.consume = consume;
module.exports.expose = expose;
module.exports.pending = pending;
module.exports.take = take;
