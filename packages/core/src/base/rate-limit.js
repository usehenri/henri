const {
  MemoryStore,
  ipKeyGenerator,
  rateLimit,
} = require('express-rate-limit');
const debug = require('debug')('henri:rate-limit');

/**
 * Rate limiting (express-rate-limit) with the standard `RateLimit` and
 * `RateLimit-Policy` headers (draft 7) and `Retry-After`; limited requests
 * get a 429 through `res.boom.tooManyRequests()`.
 *
 * Requests are counted per user id when logged in, per ip otherwise
 * (`req.ip`, which honours `config.trustProxy`; IPv6 addresses are grouped
 * by /56).
 */
const DEFAULTS = Object.freeze({ max: 600, windowMs: 60 * 1000 });
const AUTH_DEFAULTS = Object.freeze({ max: 10, windowMs: 60 * 1000 });
const AUTH_PATHS = Object.freeze([
  '/register',
  '/signup',
  '/password',
  '/forgot-password',
  '/reset-password',
]);

/**
 * The key a request is counted under
 *
 * @param {Express.Request} req the request
 * @returns {string} `user:<id>` or `ip:<address>`
 */
function keyFor(req) {
  const { user } = req;
  const id =
    user &&
    (typeof user.id !== 'undefined' && user.id !== null ? user.id : user._id);

  if (id !== null && typeof id !== 'undefined') {
    return `user:${String(id)}`;
  }

  return `ip:${req.ip ? ipKeyGenerator(req.ip) : 'unknown'}`;
}

/**
 * Seconds until a limit resets
 *
 * @param {Express.Request} req the request (`req.rateLimit` is set by the library)
 * @param {number} windowMs the window
 * @returns {number} seconds
 */
function retryAfter(req, windowMs) {
  const info = req.rateLimit;
  const reset = info && info.resetTime instanceof Date ? info.resetTime : null;
  const seconds = reset
    ? Math.ceil((reset.getTime() - Date.now()) / 1000)
    : Math.ceil(windowMs / 1000);

  return Math.max(1, seconds);
}

/**
 * A limiter
 *
 * @param {Henri} henri the henri instance
 * @param {object} [options={}] options
 * @param {number} [options.max=600] requests per window (`limit` is accepted too)
 * @param {number} [options.windowMs=60000] the window (ms)
 * @param {string} [options.name='global'] name (logs, store prefix)
 * @param {function} [options.skip] skip a request (express-rate-limit `skip`)
 * @param {object} [options.store] an express-rate-limit store (memory by default)
 * @returns {function} the middleware (with `store` and `limiterName` attached)
 */
function limiter(henri, options = {}) {
  const windowMs =
    Number(options.windowMs) > 0 ? Number(options.windowMs) : DEFAULTS.windowMs;
  const requested =
    typeof options.limit === 'undefined' ? options.max : options.limit;
  const limit = Number(requested) > 0 ? Number(requested) : DEFAULTS.max;
  const name = options.name || 'global';
  const store = options.store || new MemoryStore();

  const middleware = rateLimit({
    handler: (req, res, next, settings) => {
      const seconds = retryAfter(req, windowMs);

      henri.pen.warn('api', 'rate limited', name, keyFor(req));
      debug(
        '%s limited %s (%d per %dms)',
        name,
        keyFor(req),
        settings.limit,
        windowMs
      );

      return res.boom.tooManyRequests('Too many requests, retry later', {
        limit: settings.limit,
        retryAfter: seconds,
        windowMs,
      });
    },
    keyGenerator: (req) => keyFor(req),
    legacyHeaders: false,
    limit,
    skip: options.skip,
    standardHeaders: 'draft-7',
    store,
    // `trust proxy` is henri's business (config.trustProxy); the library
    // would otherwise print an error at the first request
    validate: { trustProxy: false, xForwardedForHeader: false },
    windowMs,
  });

  middleware.limiterName = name;
  middleware.store = store;
  middleware.settings = { limit, windowMs };

  return middleware;
}

/**
 * The limiter of the authentication endpoints (10 per minute per ip by
 * default): `POST` to the login path and the register-style paths
 *
 * @param {Henri} henri the henri instance
 * @param {object} [options={}] options
 * @param {number} [options.max=10] requests per window
 * @param {number} [options.windowMs=60000] the window (ms)
 * @param {Array<string>} [options.paths] paths to protect (defaults to
 *   `config.user.loginPath` and the register-style paths)
 * @param {Array<string>} [options.prefixes] prefixes under which *every*
 *   request is counted, whatever its method: the identity endpoints, whose
 *   callback is a `GET` that makes henri dial a provider
 * @param {string} [options.loginPath='/login'] the login path
 * @param {object} [options.store] an express-rate-limit store
 * @returns {function} the middleware
 */
function authLimiter(henri, options = {}) {
  const paths = new Set(
    Array.isArray(options.paths)
      ? options.paths
      : [options.loginPath || '/login', ...AUTH_PATHS]
  );
  const prefixes = (
    Array.isArray(options.prefixes) ? options.prefixes : []
  ).filter((prefix) => typeof prefix === 'string' && prefix.length > 0);

  /**
   * Is this request one of the authentication endpoints?
   *
   * A prefix is compared with `startsWith` rather than a pattern: the path
   * comes from the request, and a value that reaches a regular expression
   * from a request is walked, not matched.
   *
   * @param {Express.Request} req the request
   * @returns {boolean} counted or not
   */
  const counted = (req) => {
    if (req.method === 'POST' && paths.has(req.path)) {
      return true;
    }

    return prefixes.some((prefix) => req.path.startsWith(prefix));
  };

  return limiter(henri, {
    max: typeof options.max === 'undefined' ? AUTH_DEFAULTS.max : options.max,
    name: 'auth',
    skip: (req) => !counted(req),
    store: options.store,
    windowMs:
      typeof options.windowMs === 'undefined'
        ? AUTH_DEFAULTS.windowMs
        : options.windowMs,
  });
}

/**
 * Releases the store of a limiter (timers)
 *
 * @param {function} middleware a limiter built by limiter()
 * @returns {boolean} whether a store was shut down
 */
function shutdown(middleware) {
  const store = middleware && middleware.store;

  if (store && typeof store.shutdown === 'function') {
    store.shutdown();

    return true;
  }

  return false;
}

module.exports = {
  AUTH_DEFAULTS,
  AUTH_PATHS,
  DEFAULTS,
  authLimiter,
  keyFor,
  limiter,
  retryAfter,
  shutdown,
};
