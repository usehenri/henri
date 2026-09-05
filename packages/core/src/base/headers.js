const helmet = require('helmet');

/**
 * Secure headers (helmet), API versioning and JSON content negotiation.
 */
const HAL = 'application/hal+json';
const JSON_TYPE = 'application/json';
const VERSION_TYPE = /application\/vnd\.henri\.(v?\d+)\+json/i;

/**
 * Is a value a plain object?
 *
 * @param {*} value anything
 * @returns {boolean} plain object or not
 */
const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Deep merge of plain objects (arrays and scalars are replaced)
 *
 * @param {*} base the defaults
 * @param {*} extra the overrides
 * @returns {*} the merged value
 */
function merge(base, extra) {
  if (typeof extra === 'undefined') {
    return base;
  }

  if (!isPlainObject(base) || !isPlainObject(extra)) {
    return extra;
  }

  const result = Object.assign({}, base);

  for (const key of Object.keys(extra)) {
    result[key] = merge(base[key], extra[key]);
  }

  return result;
}

/**
 * The Content-Security-Policy directives
 *
 * Helmet's defaults, plus `blob:` images. In development, inline and eval'd
 * scripts (Next dev, Turbopack, Vite HMR, React refresh), websockets and
 * blob workers are allowed and `upgrade-insecure-requests` is dropped.
 *
 * @param {object} [options={}] options
 * @param {boolean} [options.isDev=false] development mode
 * @returns {object} directives, helmet style
 */
function cspDirectives({ isDev = false } = {}) {
  const directives = helmet.contentSecurityPolicy.getDefaultDirectives();

  directives['img-src'] = ["'self'", 'data:', 'blob:'];

  if (isDev) {
    directives['script-src'] = ["'self'", "'unsafe-inline'", "'unsafe-eval'"];
    directives['connect-src'] = ["'self'", 'ws:', 'wss:'];
    directives['worker-src'] = ["'self'", 'blob:'];
    delete directives['upgrade-insecure-requests'];
  }

  return directives;
}

/**
 * The helmet middleware for a henri instance
 *
 * `config.helmet` is merged into the options (`false` disables helmet
 * entirely, `{ contentSecurityPolicy: false }` only the CSP, ...). HSTS is
 * off in development and Cross-Origin-Resource-Policy opens up when CORS is
 * enabled.
 *
 * @param {Henri} henri the henri instance
 * @returns {?function} the middleware, or null when disabled
 */
function secureHeaders(henri) {
  const { config } = henri;
  const custom = config.has('helmet') ? config.get('helmet') : {};

  if (custom === false) {
    return null;
  }

  const cors = Boolean(config.has('cors') && config.get('cors'));
  const defaults = {
    contentSecurityPolicy: {
      directives: cspDirectives({ isDev: henri.isDev }),
      useDefaults: false,
    },
  };

  if (cors) {
    defaults.crossOriginResourcePolicy = { policy: 'cross-origin' };
  }

  if (henri.isDev) {
    defaults.strictTransportSecurity = false;
  }

  return helmet(merge(defaults, isPlainObject(custom) ? custom : {}));
}

/**
 * Normalizes a version (`1`, `'1'`, `'V1'`) to `v1`
 *
 * @param {*} value the version
 * @returns {?string} `v<n>` or null when invalid
 */
function normalizeVersion(value) {
  const match = /^v?(\d+)$/i.exec(String(value).trim());

  return match ? `v${match[1]}` : null;
}

/**
 * Express middleware reading the API version asked through the Accept
 * header (`application/vnd.henri.v1+json`) into `req.apiVersion`
 *
 * @returns {function} middleware
 */
function apiVersion() {
  return (req, res, next) => {
    const match = VERSION_TYPE.exec(req.get('accept') || '');

    req.apiVersion = match ? normalizeVersion(match[1]) : null;

    next();
  };
}

/**
 * Per-route middleware for the `version` route option: a client asking for
 * another version gets a 406, one asking for none gets the route's version
 *
 * @param {*} version the version served by the route
 * @returns {function} middleware
 */
function versionGuard(version) {
  const served = normalizeVersion(version);

  return (req, res, next) => {
    if (served && req.apiVersion && req.apiVersion !== served) {
      return res.status(406).json({
        data: { requested: req.apiVersion, served },
        error: 'Not Acceptable',
        message: `API version ${req.apiVersion} is not served by this route (${served})`,
        statusCode: 406,
      });
    }

    if (served && !req.apiVersion) {
      req.apiVersion = served;
    }

    return next();
  };
}

/**
 * The JSON media type a client prefers: HAL when asked for, plain otherwise
 *
 * @param {Express.Request} req the request
 * @returns {string} `application/hal+json` or `application/json`
 */
function jsonType(req) {
  const preferred =
    typeof req.accepts === 'function' ? req.accepts([JSON_TYPE, HAL]) : false;

  return preferred === HAL ? HAL : JSON_TYPE;
}

/**
 * The media types `res.format()` should route to the JSON handler: plain,
 * HAL and the versioned vendor type the client asked for
 *
 * @param {Express.Request} req the request
 * @returns {Array<string>} media types
 */
function jsonTypes(req) {
  const types = [JSON_TYPE, HAL];

  if (req.apiVersion) {
    types.push(`application/vnd.henri.${req.apiVersion}+json`);
  }

  return types;
}

/**
 * Authenticated JSON must not be cached by proxies or browsers
 *
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @returns {boolean} whether the header was set
 */
function noStore(req, res) {
  if (req.user) {
    res.set('Cache-Control', 'no-store');

    return true;
  }

  return false;
}

module.exports = {
  HAL,
  JSON_TYPE,
  VERSION_TYPE,
  apiVersion,
  cspDirectives,
  jsonType,
  jsonTypes,
  merge,
  noStore,
  normalizeVersion,
  secureHeaders,
  versionGuard,
};
