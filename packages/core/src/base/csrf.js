const crypto = require('crypto');
const debug = require('debug')('henri:csrf');

/**
 * Double-submit CSRF protection, with an origin check.
 *
 * A random token is stored in a cookie readable by the browser (`henri.csrf`,
 * not httpOnly) and exposed to the views as `req._henri.csrf`. Unsafe requests
 * (POST, PUT, PATCH, DELETE) carrying a session cookie must send it back in
 * the `X-CSRF-Token` (or `X-XSRF-TOKEN`) header or the `_csrf` body field; a
 * third-party site can trigger the request but cannot read the cookie.
 *
 * The token alone does not survive everything: a sibling subdomain, or
 * anything that can write a cookie on the parent domain, can plant a token it
 * knows and submit it. So the request must *also* come from somewhere this
 * application recognizes, which is what browsers state in `Sec-Fetch-Site`
 * and `Origin`. Both checks must pass.
 *
 * Neither applies to requests without ambient credentials: no session cookie,
 * or a bearer token (JWT). A cross-origin API client that never sends a
 * cookie is untouched by any of this.
 */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOKEN_BYTES = 24;
const TOKEN_FORMAT = /^[a-f0-9]{48}$/;

/**
 * `Sec-Fetch-Site` values that need no `Origin` check.
 *
 * `same-origin` is this application talking to itself. `none` is a request
 * the person started themselves: typing the address, a bookmark, a launched
 * app. `same-site` is deliberately absent: a sibling subdomain is the case
 * the token does not cover.
 */
const TRUSTED_FETCH_SITES = new Set(['same-origin', 'none']);

/**
 * Generates a new token
 *
 * @returns {string} 48 hex characters
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Constant-time string comparison
 *
 * @param {*} given the value sent by the client
 * @param {string} expected the value from the cookie
 * @returns {boolean} equal or not
 */
function safeEqual(given, expected) {
  if (
    typeof given !== 'string' ||
    typeof expected !== 'string' ||
    given.length !== expected.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// `X-XSRF-TOKEN` is the axios/Inertia/Laravel convention (the client echoes
// an `XSRF-TOKEN` cookie holding the same token)
const HEADERS = ['x-csrf-token', 'x-xsrf-token'];

/**
 * Reads a header, whether or not the request went through Express
 *
 * @param {Express.Request} req the request
 * @param {string} name the header name, lowercased
 * @returns {?string} the value or null
 */
function header(req, name) {
  const value =
    typeof req.get === 'function'
      ? req.get(name)
      : req.headers && req.headers[name];

  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads the token sent with the request
 *
 * @param {Express.Request} req the request
 * @returns {?string} the token or null
 */
function sentToken(req) {
  for (const name of HEADERS) {
    const value = header(req, name);

    if (value) {
      return value;
    }
  }

  if (req.body && typeof req.body._csrf === 'string') {
    return req.body._csrf;
  }

  return null;
}

/**
 * The origin this request was addressed to (`https://app.example.com`).
 *
 * `req.host` and `req.protocol` are what the browser saw: behind a reverse
 * proxy they come from `X-Forwarded-Host` and `X-Forwarded-Proto` when
 * `config.trustProxy` allows it, rather than from the internal `Host` the
 * proxy rewrote.
 *
 * @param {Express.Request} req the request
 * @returns {?string} the origin, or null when there is no host
 */
function ownOrigin(req) {
  const host = req.host || header(req, 'host');

  if (!host) {
    return null;
  }

  return `${req.protocol || 'http'}://${host}`;
}

/**
 * Normalizes an origin for comparison (no trailing slash, lowercased)
 *
 * @param {*} origin an origin
 * @returns {?string} the normalized origin or null
 */
function normalizeOrigin(origin) {
  if (typeof origin !== 'string' || origin.length === 0) {
    return null;
  }

  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Whether the request states an origin this application recognizes.
 *
 * Answers `null` when the request says nothing at all about where it came
 * from, which is every non-browser client: those fall through to the token.
 *
 * @param {Express.Request} req the request
 * @param {Set<string>} trusted extra origins allowed to post here
 * @returns {?boolean} true (recognized), false (refused) or null (silent)
 */
function originAllowed(req, trusted) {
  const site = header(req, 'sec-fetch-site');

  if (site && TRUSTED_FETCH_SITES.has(site.toLowerCase())) {
    return true;
  }

  const origin = normalizeOrigin(header(req, 'origin'));

  if (!origin) {
    // A browser that sent `Sec-Fetch-Site: cross-site` (or `same-site`)
    // without an `Origin` is not something to trust
    return site ? false : null;
  }

  if (trusted.has(origin)) {
    return true;
  }

  const own = normalizeOrigin(ownOrigin(req));

  return own !== null && origin === own;
}

/**
 * The origins `config.cors` already lets send credentials.
 *
 * An application that deliberately opened itself to another origin should
 * not have to say so twice.
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {Array<string>} the origins
 */
function corsOrigins(config) {
  if (!config || typeof config.has !== 'function' || !config.has('cors')) {
    return [];
  }

  const cors = config.get('cors');

  if (!cors || typeof cors !== 'object' || !cors.origin) {
    return [];
  }

  return [].concat(cors.origin).filter((origin) => typeof origin === 'string');
}

/**
 * Normalizes `config.csrf`.
 *
 * `false` disables the protection entirely (handled by the caller). An
 * object takes `origin` (`false` keeps the token check alone) and
 * `trustedOrigins`, which defaults to whatever `config.cors` allows.
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {{checkOrigin: boolean, trustedOrigins: Array<string>}} the settings
 * @throws {TypeError} when `config.csrf` is neither a boolean nor an object
 */
function csrfConfig(config) {
  const settings = { checkOrigin: true, trustedOrigins: corsOrigins(config) };

  if (!config || typeof config.has !== 'function' || !config.has('csrf')) {
    return settings;
  }

  const raw = config.get('csrf');

  if (typeof raw === 'boolean') {
    return settings;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(
      'config.csrf must be a boolean or an object ({ origin, trustedOrigins })'
    );
  }

  if (raw.origin === false) {
    settings.checkOrigin = false;
  }

  if (Array.isArray(raw.trustedOrigins)) {
    settings.trustedOrigins = settings.trustedOrigins.concat(
      raw.trustedOrigins.filter((origin) => typeof origin === 'string')
    );
  }

  return settings;
}

/**
 * Express middleware
 *
 * @param {object} [options={}] options
 * @param {string} [options.cookie='henri.csrf'] name of the token cookie
 * @param {string} [options.sessionCookie='henri.sid'] name of the session cookie
 * @param {boolean} [options.secure=false] mark the cookie as secure
 * @param {number} [options.maxAge] cookie lifetime in ms (browser session when omitted)
 * @param {boolean} [options.checkOrigin=true] also verify `Sec-Fetch-Site` and `Origin`
 * @param {Array<string>} [options.trustedOrigins=[]] other origins allowed to post here
 * @returns {function} middleware
 */
function csrf({
  cookie = 'henri.csrf',
  sessionCookie = 'henri.sid',
  secure = false,
  maxAge = undefined,
  checkOrigin = true,
  trustedOrigins = [],
} = {}) {
  const trusted = new Set(
    trustedOrigins.map(normalizeOrigin).filter((origin) => origin !== null)
  );

  /**
   * Refuses the request
   *
   * @param {Express.Response} res the response
   * @param {string} message why
   * @returns {*} the response
   */
  const refuse = (res, message) => {
    if (res.boom && typeof res.boom.forbidden === 'function') {
      return res.boom.forbidden(message);
    }

    return res.status(403).json({
      error: 'Forbidden',
      message,
      statusCode: 403,
    });
  };

  return (req, res, next) => {
    const cookies = req.cookies || {};
    let token = cookies[cookie];

    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) {
      token = generateToken();
      res.cookie(cookie, token, {
        httpOnly: false,
        maxAge,
        path: '/',
        sameSite: 'lax',
        secure,
      });
    }

    req.csrfToken = token;

    if (!UNSAFE_METHODS.has(req.method)) {
      return next();
    }

    // No session cookie: nothing a third-party site could ride on
    if (!cookies[sessionCookie]) {
      return next();
    }

    if (/^bearer\s+\S/i.test(header(req, 'authorization') || '')) {
      return next();
    }

    if (checkOrigin && originAllowed(req, trusted) === false) {
      debug(
        'refused %s %s from %s (%s)',
        req.method,
        req.originalUrl || req.url,
        header(req, 'origin'),
        header(req, 'sec-fetch-site')
      );

      return refuse(res, 'Cross-origin request refused');
    }

    if (safeEqual(sentToken(req), token)) {
      return next();
    }

    return refuse(res, 'Invalid CSRF token');
  };
}

module.exports = csrf;
module.exports.csrfConfig = csrfConfig;
module.exports.generateToken = generateToken;
module.exports.originAllowed = originAllowed;
module.exports.safeEqual = safeEqual;
