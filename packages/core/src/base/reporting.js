/**
 * The error reporting seam: one place an application hears about every
 * failure henri catches.
 *
 * henri answers failures well and tells nobody: a module that throws fails
 * the boot and prints a stack, a request that throws gets a 500 and a log
 * line, a rejection nobody handled reaches `pen.fatal`. An application that
 * wants those in Sentry, in Bugsnag or in a log drain has had nowhere to
 * plug in, so it wraps its own controllers and still misses the boot and
 * the middlewares.
 *
 *     // app/modules/reporting.js
 *     const Module = require('@usehenri/core/module');
 *
 *     module.exports = class Reporting extends Module {
 *       constructor() {
 *         super();
 *         this.name = 'reporting';
 *         this.runlevel = 0;
 *       }
 *
 *       init() {
 *         this.henri.reporter.onError(({ code, error, request, requestId }) =>
 *           Sentry.captureException(error, { tags: { code, requestId } })
 *         );
 *
 *         return this.name;
 *       }
 *     };
 *
 * It follows `henri.mailers.onDeliverLater()`: one handler, registered by a
 * call, replaced by another call and removed with `null`. One rather than a
 * list, for the same reason -- two handlers means an order, an order means
 * a contract about it, and an application that wants two calls both from
 * one function.
 *
 * ## What the handler is given, and what it is never given
 *
 *     { at, code, error, meta, request, requestId, source }
 *
 * The rule, and it is the point of the module: **everything henri adds is
 * either henri's own or an identifier that means nothing on its own.** The
 * method and the *route pattern* (`GET /artworks/:id`) are what the
 * application declared and henri matched; the status is henri's answer; the
 * code is out of `error-codes.json`; the request id is a uuid. Nothing that
 * came from the client and nothing about a person is in it: no url, no
 * query string, no body, no params, no headers, no cookies, no session and
 * no user. The path is left out with the rest, because `/users/ada@example.com`
 * is a path in some applications and a personal field in all of them.
 *
 * The two exceptions are named on purpose:
 *
 * - `error` is handed over as it is. A reporter exists for the stack, and a
 *   framework that rewrote the application's own Error would be reporting
 *   something that never happened. What an error carries is the
 *   application's business; what henri *adds* is what this rule governs.
 * - `meta` is whatever `report()` was called with, and it goes through the
 *   same masking as a log line (`base/redact.js`: `filterParameters` as
 *   substrings, the personal marks exactly, at every depth), so an
 *   application that hands us a request body still does not send one out.
 *
 * ## Where a report comes from
 *
 * Three places, once each, and they are the three places henri answers a
 * failure instead of the application:
 *
 * - `boot` -- `henri.init()` rejected. Reported before the rejection, and
 *   awaited (bounded, see below) so an asynchronous reporter gets its
 *   flush in before the process exits.
 * - `request` -- `base/http.js` answered 5xx. Not awaited: a request is
 *   never held for a reporter. A 4xx is not reported at all; it is an
 *   answer, not a failure.
 * - `rejection` -- the `unhandledRejection` handler of `base/henri.js`.
 *
 * `pen.fatal()` deliberately does not report. It returns an Error for the
 * caller to throw, and whoever throws it is the one who knows whether it
 * ends a boot, a request or nothing at all; reporting there would double
 * every failure that also fails the boot. `report()` is public, so an
 * application reports its own (`source: 'application'`).
 *
 * The request timeout (`base/timeout.js`) does not report. It answers 503
 * from its own middleware because a deadline passed, and there is no error
 * to hand anybody: the handler is still running, and henri fabricating an
 * Error to report would be reporting something that did not happen. The log
 * line and the status are the whole story. What would change it is a
 * timeout that carried a real failure, which is a different feature.
 *
 * A dead job does not report either. `@usehenri/jobs` buries a job in its
 * own dead letter queue, with the arguments, every attempt and the error:
 * that row is durable, `henri jobs:dead` and `jobs:show` read it back, and
 * a second copy in a reporter would be one more thing to keep in step. What
 * would change it is one call in the queue where it buries a row -- the
 * payload of a job is application data, so what of it may leave the process
 * is that package's decision to make, in its own tranche.
 *
 * ## A handler is not trusted
 *
 * It is somebody else's network call in the middle of a failure, so:
 * `report()` never throws and never rejects, a handler that throws is
 * logged and forgotten, and a handler that hangs is left running while
 * `report()` resolves after `GRACE`. The request was never waiting for it
 * and the boot waits at most that long. The same Error object is reported
 * once -- a WeakSet remembers it -- so a failure that travels through two
 * of the three paths is one report.
 *
 * Without a handler, `report()` builds no payload, masks nothing and
 * resolves false.
 *
 * @module base/reporting
 */

const { coded } = require('./errors');
const { currentRequestId } = require('./request-id');
const { redactor } = require('./redact');

/** How long `report()` waits on a handler before giving up on it (ms) */
const GRACE = 2000;

/** Where a failure was caught */
const SOURCES = Object.freeze(['application', 'boot', 'rejection', 'request']);

/**
 * Anything, as an Error
 * A rejection carries whatever it was rejected with.
 *
 * @param {*} value what was thrown
 * @returns {Error} an error
 */
function toError(value) {
  if (value instanceof Error) {
    return value;
  }

  return new Error(typeof value === 'string' ? value : String(value));
}

/**
 * What of a request may be reported: the method, the route pattern and the
 * status, and that is the whole list
 *
 * @param {?object} req the express request
 * @param {?number} status the status henri answered with
 * @returns {?object} `{ method, route, status }`, or null
 */
function requestOf(req, status) {
  if (!req && !status) {
    return null;
  }

  const path =
    req && req.route && typeof req.route.path === 'string'
      ? `${req.baseUrl || ''}${req.route.path}`
      : null;

  return {
    method: (req && req.method) || null,
    route: path,
    status: status || null,
  };
}

/**
 * The error reporter of an instance (`henri.reporter`)
 *
 * Not a module: it is built with the instance, next to `pen`, because the
 * first failure worth reporting is a module that would not start, and a
 * module cannot be the seam for its own graph refusing to run.
 *
 * @class Reporter
 */
class Reporter {
  /**
   * Creates an instance of Reporter.
   *
   * @param {?Henri} [henri=null] the henri instance
   * @memberof Reporter
   */
  constructor(henri = null) {
    this.henri = henri;
    this.name = 'reporter';

    /** The handler `onError()` registered, if any */
    this._handler = null;
    /** The errors already reported, so nothing is reported twice */
    this._seen = new WeakSet();
  }

  /**
   * Is anything listening?
   *
   * @readonly
   * @returns {boolean} true when a handler is registered
   * @memberof Reporter
   */
  get enabled() {
    return typeof this._handler === 'function';
  }

  /**
   * Register the handler every failure henri catches is given to.
   *
   * One handler: registering another replaces it, `null` removes it. It is
   * called with the report and may answer anything; a promise is watched
   * but never waited on beyond `GRACE`.
   *
   * @param {?function} handler the handler, or null to remove it
   * @returns {boolean} success
   * @memberof Reporter
   */
  onError(handler) {
    if (handler !== null && typeof handler !== 'function') {
      this.log('error', 'the error handler must be a function');

      return false;
    }

    this._handler = handler;

    return true;
  }

  /**
   * Report a failure
   *
   * Never throws and never rejects, whatever the handler does. Callers that
   * can afford to wait (the boot) await it; the request path does not.
   *
   * @async
   * @param {*} error what failed
   * @param {object} [options={}] `source`, `req`, `status` and `meta`
   * @returns {Promise<boolean>} whether a handler was given it
   * @memberof Reporter
   */
  async report(error, options = {}) {
    const handler = this._handler;

    // The absence of a handler costs a property read: no payload is built,
    // nothing is masked and nothing is remembered
    if (typeof handler !== 'function' || !error) {
      return false;
    }

    if (typeof error === 'object') {
      if (this._seen.has(error)) {
        return false;
      }

      this._seen.add(error);
    }

    let payload;

    try {
      payload = this.payload(toError(error), options);
    } catch (failure) {
      this.failed(failure);

      return false;
    }

    try {
      const answer = handler(payload);

      if (answer && typeof answer.then === 'function') {
        await this.settle(answer);
      }
    } catch (failure) {
      this.failed(failure);
    }

    return true;
  }

  /**
   * What the handler is given
   *
   * @param {Error} error the error
   * @param {object} [options={}] `source`, `req`, `status` and `meta`
   * @returns {object} the report
   * @memberof Reporter
   */
  payload(error, options = {}) {
    const { meta = null, req = null, status = null } = options;
    const source = SOURCES.includes(options.source)
      ? options.source
      : 'application';
    const found = {
      at: new Date(),
      code: coded(error) || null,
      error,
      request: requestOf(req, status),
      requestId:
        (req && typeof req.id === 'string' && req.id) || currentRequestId(),
      source,
    };

    if (meta !== null && typeof meta === 'object') {
      found.meta = redactor(this.henri)(meta);
    }

    return found;
  }

  /**
   * Wait for a handler, but not for long
   *
   * @async
   * @param {Promise} answer what the handler returned
   * @returns {Promise<boolean>} whether it finished in time
   * @memberof Reporter
   */
  settle(answer) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.log(
          'warn',
          `the error handler is still running after ${GRACE}ms; nothing waited for it`
        );
        resolve(false);
      }, GRACE);

      // A slow handler must not be what keeps the process alive
      typeof timer.unref === 'function' && timer.unref();

      answer.then(
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        (failure) => {
          clearTimeout(timer);
          this.failed(failure);
          resolve(false);
        }
      );
    });
  }

  /**
   * A handler that failed: logged, and nothing else. It is never reported
   * -- a reporter reporting its own failure to itself is a loop.
   *
   * @param {*} failure what the handler threw
   * @returns {void}
   * @memberof Reporter
   */
  failed(failure) {
    const error = toError(failure);

    this.log('error', 'the error handler threw', error.message);
  }

  /**
   * One line, when there is a pen to write it with
   *
   * @param {string} level the level
   * @param {...any} args the line
   * @returns {void}
   * @memberof Reporter
   */
  log(level, ...args) {
    const pen = this.henri && this.henri.pen;

    if (pen && typeof pen[level] === 'function') {
      pen[level](this.name, ...args);
    }
  }
}

module.exports = { GRACE, Reporter, SOURCES, requestOf, toError };
