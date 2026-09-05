const crypto = require('crypto');

/**
 * Double-submit CSRF protection.
 *
 * A random token is stored in a cookie readable by the browser (`henri.csrf`,
 * not httpOnly) and exposed to the views as `req._henri.csrf`. Unsafe requests
 * (POST, PUT, PATCH, DELETE) carrying a session cookie must send it back in
 * the `X-CSRF-Token` (or `X-XSRF-TOKEN`) header or the `_csrf` body field; a
 * third-party site can trigger the request but cannot read the cookie.
 * Requests authenticated with a bearer token (JWT) have no ambient
 * credentials and are exempt.
 */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOKEN_BYTES = 24;
const TOKEN_FORMAT = /^[a-f0-9]{48}$/;

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
 * Reads the token sent with the request
 *
 * @param {Express.Request} req the request
 * @returns {?string} the token or null
 */
function sentToken(req) {
  for (const name of HEADERS) {
    const header =
      typeof req.get === 'function'
        ? req.get(name)
        : req.headers && req.headers[name];

    if (typeof header === 'string' && header.length > 0) {
      return header;
    }
  }

  if (req.body && typeof req.body._csrf === 'string') {
    return req.body._csrf;
  }

  return null;
}

/**
 * Express middleware
 *
 * @param {object} [options={}] options
 * @param {string} [options.cookie='henri.csrf'] name of the token cookie
 * @param {string} [options.sessionCookie='henri.sid'] name of the session cookie
 * @param {boolean} [options.secure=false] mark the cookie as secure
 * @param {number} [options.maxAge] cookie lifetime in ms (browser session when omitted)
 * @returns {function} middleware
 */
function csrf({
  cookie = 'henri.csrf',
  sessionCookie = 'henri.sid',
  secure = false,
  maxAge = undefined,
} = {}) {
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

    const authorization =
      (typeof req.get === 'function'
        ? req.get('authorization')
        : req.headers && req.headers.authorization) || '';

    if (/^bearer\s+\S/i.test(authorization)) {
      return next();
    }

    if (safeEqual(sentToken(req), token)) {
      return next();
    }

    if (res.boom && typeof res.boom.forbidden === 'function') {
      return res.boom.forbidden('Invalid CSRF token');
    }

    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid CSRF token',
      statusCode: 403,
    });
  };
}

module.exports = csrf;
module.exports.generateToken = generateToken;
module.exports.safeEqual = safeEqual;
