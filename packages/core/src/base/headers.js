const crypto = require('crypto');
const helmet = require('helmet');

/**
 * Secure headers (helmet), API versioning and JSON content negotiation.
 */
const HAL = 'application/hal+json';

/**
 * `Permissions-Policy`: the powerful browser features, denied.
 *
 * helmet sets no such header, and a header that is absent is a permission
 * granted: any script the page runs, its own or an embedded one, may ask for
 * the camera or the location, and the person is asked to allow it. Denying
 * them by default costs an application that wants one a single line
 * (`{ "helmet": { "permissionsPolicy": "geolocation=(self)" } }`), and costs
 * every other application nothing.
 *
 * The list is the features a browser can be asked for that a server-rendered
 * application does not use without asking. `false` sends no header at all.
 */
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=(self)',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');
const JSON_TYPE = 'application/json';
const VERSION_TYPE = /application\/vnd\.henri\.(v?\d+)\+json/i;

/**
 * The nonce: 16 bytes (128 bits) of the system CSPRNG, base64url without
 * padding.
 *
 * base64url rather than base64 so the value is 22 characters of
 * `[A-Za-z0-9_-]`: the CSP grammar accepts them (`base64-value` names `-`
 * and `_`, and the padding is optional) and nothing in the alphabet is
 * escaped by Handlebars, by an HTML attribute or by JSON, so the value the
 * header names and the value the markup carries are the same string
 * wherever it is written.
 *
 * The bytes are drawn from a pool rather than one `randomBytes(16)` per
 * response: `crypto.randomFillSync` over 4kb costs a single trip and the
 * slices come out of it at 49ns instead of 780ns, which is the difference
 * between a nonce being free and a nonce being the most expensive thing a
 * static page does. The pool is CSPRNG output either way -- it is refilled,
 * never derived, and a slice is handed out once.
 */
const NONCE_BYTES = 16;
const NONCE_POOL = 4096;
const pool = { buffer: Buffer.allocUnsafe(NONCE_POOL), offset: NONCE_POOL };

/**
 * A fresh nonce for one response
 *
 * @returns {string} 22 characters of base64url
 */
function createNonce() {
  if (pool.offset + NONCE_BYTES > NONCE_POOL) {
    crypto.randomFillSync(pool.buffer);
    pool.offset = 0;
  }

  const value = pool.buffer.toString(
    'base64url',
    pool.offset,
    pool.offset + NONCE_BYTES
  );

  pool.offset += NONCE_BYTES;

  return value;
}

/**
 * Does this configuration ask for a nonce?
 *
 * @param {object} config `henri.config`
 * @returns {boolean} `csp.nonce` is on
 */
function nonceEnabled(config) {
  const csp = config && config.has('csp') ? config.get('csp') : null;

  return Boolean(csp && csp.nonce === true);
}

/**
 * The string the cached header is split on: a nonce that cannot occur
 */
const NONCE_SENTINEL = 'henri.csp.nonce.placeholder';

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
 * Helmet's defaults, plus `blob:` images and without the `https:` wildcards
 * helmet leaves in `style-src` and `font-src`: `https:` is every host on the
 * internet, which is not a policy, and a stylesheet or a font from somewhere
 * else is a decision an application makes by naming the origin. In
 * development, inline and eval'd scripts (Next dev, Turbopack, Vite HMR,
 * React refresh), websockets and blob workers are allowed.
 *
 * `upgrade-insecure-requests` is only sent to a request that already arrived
 * over https. On a plain http answer it would rewrite every later request of
 * that page to https, including the redirect a controller answers after a
 * POST, and the browser then fails with a network error against a server that
 * speaks http: the record is written but the page never follows. Apps served
 * over http (a production build checked locally, an internal deployment) stay
 * usable, and apps served over https keep the directive.
 *
 * `nonce` is a source expression to add to `script-src` (`'nonce-<value>'`,
 * or a `(req, res)` function helmet calls per request). **henri takes
 * `'unsafe-inline'` out of `script-src` itself when one is given**, rather
 * than leaving it to the application, because the browser does that anyway:
 * a `script-src` that names a nonce or a hash ignores `'unsafe-inline'`
 * (CSP2 and CSP3 both say so). Leaving it in would make the header claim a
 * fallback the browser does not honour, and the only readers that would take
 * it up are the ones from before 2016 that ignore nonces entirely -- so the
 * header says what the browser does, and there is no configuration for it.
 * `'unsafe-eval'` is untouched: a nonce is not an answer to `eval`, and the
 * development bundlers still need it.
 *
 * `style-src` keeps `'unsafe-inline'` and never gets the nonce, on purpose.
 * A `style=""` attribute cannot carry a nonce -- only `style-src-attr` can
 * allow one -- and React, Inertia and Vite all set them, so naming a nonce
 * in `style-src` would make the browser ignore `'unsafe-inline'` and break
 * every inline style in the application. Tightening that is an application's
 * decision (`style-src-attr` plus its own `style-src`), not henri's.
 *
 * @param {object} [options={}] options
 * @param {boolean} [options.isDev=false] development mode
 * @param {(string|function|null)} [options.nonce=null] the nonce source expression
 * @param {boolean} [options.secure=false] the request arrived over https
 * @returns {object} directives, helmet style
 */
function cspDirectives({ isDev = false, nonce = null, secure = false } = {}) {
  const directives = helmet.contentSecurityPolicy.getDefaultDirectives();

  directives['img-src'] = ["'self'", 'data:', 'blob:'];
  directives['font-src'] = ["'self'", 'data:'];
  // 'unsafe-inline' stays: React, Inertia and Vite all set style attributes
  directives['style-src'] = ["'self'", "'unsafe-inline'"];

  if (isDev) {
    directives['script-src'] = ["'self'", "'unsafe-inline'", "'unsafe-eval'"];
    directives['connect-src'] = ["'self'", 'ws:', 'wss:'];
    directives['worker-src'] = ["'self'", 'blob:'];
  }

  if (nonce) {
    directives['script-src'] = directives['script-src']
      .filter((source) => source !== "'unsafe-inline'")
      .concat(nonce);
  }

  if (!secure) {
    delete directives['upgrade-insecure-requests'];
  }

  return directives;
}

/**
 * The Content-Security-Policy header of a set of options, serialized once,
 * split around the nonce
 *
 * helmet joins the header from the directives on every request as soon as
 * one of their elements is a function, and it re-validates each element
 * while it does: 869ns a request, where the all-strings header it precomputes
 * at boot costs 15ns. Nothing about the header changes from one request to
 * the next except 22 characters, so it is built here once with a sentinel in
 * the nonce's place and cut in two: what is left is `prefix + nonce + suffix`
 * per request, 6ns.
 *
 * The middleware is run against a stub response to read the value, so what
 * is cached is helmet's own serialization of the application's own options,
 * whatever they are. Anything that does not serialize to one string holding
 * exactly one sentinel -- an application that passed a function of its own,
 * a helmet that answered an error -- returns null, and the caller falls back
 * to helmet computing the header per request.
 *
 * @param {object} options the `contentSecurityPolicy` options helmet is given
 * @returns {?{name: string, prefix: string, suffix: string}} the split header
 */
function cachedCsp(options) {
  let name = null;
  let value = null;
  let failed = null;

  try {
    helmet.contentSecurityPolicy(options)(
      {},
      {
        locals: {},
        setHeader: (header, headerValue) => {
          name = header;
          value = String(headerValue);
        },
      },
      (error) => {
        failed = error || null;
      }
    );
  } catch (error) {
    return null;
  }

  if (failed || !name || !value) {
    return null;
  }

  const parts = value.split(NONCE_SENTINEL);

  return parts.length === 2
    ? { name, prefix: parts[0], suffix: parts[1] }
    : null;
}

/**
 * The helmet middleware for a henri instance
 *
 * `config.helmet` is merged into the options (`false` disables helmet
 * entirely, `{ contentSecurityPolicy: false }` only the CSP, ...). HSTS is
 * off in development and Cross-Origin-Resource-Policy opens up when CORS is
 * enabled. `permissionsPolicy` is henri's own, not one of helmet's, so it is
 * taken out before the options reach helmet, which refuses a key it does not
 * know. Two middlewares are built so that `upgrade-insecure-requests` follows
 * the protocol the request came in on (`req.secure`, which honours
 * `config.trustProxy` and `X-Forwarded-Proto`).
 *
 * With `csp.nonce` on, every response also gets a fresh nonce
 * (`res.locals.cspNonce`) that `script-src` names, and the header it just
 * sent is written onto `req.headers`: that is where Next's pages router
 * reads a nonce from (`getScriptNonceFromHeader`), and it is the only
 * channel henri has into it. A `Content-Security-Policy` a client sent is
 * always replaced -- or removed, with nonces off -- so nothing downstream
 * ever stamps the markup with a nonce this server did not choose.
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
  const options = isPlainObject(custom) ? Object.assign({}, custom) : {};
  const requested = options.permissionsPolicy;

  delete options.permissionsPolicy;

  /**
   * The `Permissions-Policy` value to send, or null for none
   *
   * @returns {?string} the policy
   */
  const policy = () => {
    if (requested === false) {
      return null;
    }

    return typeof requested === 'string' && requested.length > 0
      ? requested
      : PERMISSIONS_POLICY;
  };

  const permissions = policy();
  const nonces = nonceEnabled(config);

  /**
   * The helmet options for one protocol and one nonce source
   *
   * @param {boolean} secure the request arrived over https
   * @param {(string|function|null)} nonce the nonce source expression
   * @returns {object} the options helmet is given
   */
  const optionsFor = (secure, nonce) => {
    const defaults = {
      contentSecurityPolicy: {
        directives: cspDirectives({ isDev: henri.isDev, nonce, secure }),
        useDefaults: false,
      },
    };

    if (cors) {
      defaults.crossOriginResourcePolicy = { policy: 'cross-origin' };
    }

    if (henri.isDev) {
      defaults.strictTransportSecurity = false;
    }

    return merge(defaults, options);
  };

  /**
   * The helmet middleware for one protocol, and the header henri sends
   * itself when it could serialize it once (see cachedCsp)
   *
   * @param {boolean} secure the request arrived over https
   * @returns {{csp: ?object, handler: function}} the middleware
   */
  const build = (secure) => {
    if (!nonces) {
      return { csp: null, handler: helmet(optionsFor(secure, null)) };
    }

    const sentinel = optionsFor(secure, `'nonce-${NONCE_SENTINEL}'`);
    const csp =
      sentinel.contentSecurityPolicy === false
        ? null
        : cachedCsp(sentinel.contentSecurityPolicy);

    if (csp) {
      // Henri sends the Content-Security-Policy, helmet the rest
      return {
        csp,
        handler: helmet(merge(sentinel, { contentSecurityPolicy: false })),
      };
    }

    // Whatever this application did to the policy, helmet can still join it
    return {
      csp: null,
      handler: helmet(
        optionsFor(
          secure,
          (request, response) => `'nonce-${response.locals.cspNonce}'`
        )
      ),
    };
  };

  const plain = build(false);
  const encrypted = build(true);

  /**
   * Forget a `Content-Security-Policy` a client sent: it is a response
   * header, nothing sends it on a request, and what reads it downstream
   * (Next) would take a nonce out of it
   *
   * @param {Express.Request} req the request
   * @returns {void}
   */
  const forgetSent = (req) => {
    if (typeof req.headers['content-security-policy'] !== 'undefined') {
      delete req.headers['content-security-policy'];
    }

    if (
      typeof req.headers['content-security-policy-report-only'] !== 'undefined'
    ) {
      delete req.headers['content-security-policy-report-only'];
    }
  };

  return function henriSecureHeaders(req, res, next) {
    if (permissions) {
      res.setHeader('Permissions-Policy', permissions);
    }

    const { csp, handler } = req.secure ? encrypted : plain;

    if (!nonces) {
      forgetSent(req);

      return handler(req, res, next);
    }

    const nonce = createNonce();

    res.locals = res.locals || {};
    res.locals.cspNonce = nonce;
    forgetSent(req);

    if (csp) {
      const value = csp.prefix + nonce + csp.suffix;

      res.setHeader(csp.name, value);
      req.headers['content-security-policy'] = value;

      return handler(req, res, next);
    }

    // Helmet joined the header itself: mirror what it actually sent
    return handler(req, res, (error) => {
      const sent =
        res.getHeader('Content-Security-Policy') ||
        res.getHeader('Content-Security-Policy-Report-Only');

      req.headers['content-security-policy'] = sent
        ? String(sent)
        : `script-src 'nonce-${nonce}'`;

      return next(error);
    });
  };
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

/**
 * Is this answer an Inertia page object rather than an API answer?
 *
 * The Inertia view engine answers a visit with `{ component, props, url,
 * version }`, a protocol of its own with no room for `_links`, and marks it
 * with the `X-Inertia` header. Such an answer is a rendered page, not JSON
 * the HAL guard or the answer gate has anything to say about -- its props
 * went through the gate as `data` when the router built them.
 *
 * @param {Express.Request} req the request
 * @param {Express.Response} res the response
 * @returns {boolean} true for an Inertia page object
 */
function isInertiaPage(req, res) {
  return Boolean(
    (typeof res.getHeader === 'function' && res.getHeader('X-Inertia')) ||
    (typeof req.get === 'function' && req.get('x-inertia'))
  );
}

/**
 * Marks a body henri built itself, so the answer gate lets it through.
 *
 * `res.resource()`, `res.collection()`, `res.render()`'s JSON and the boom
 * envelope are henri's own answers: the ones carrying records went through
 * the publish and the strip already, and the ones that do not are an
 * envelope with a shape of its own. Doing it twice would cost a copy per
 * answer and, on an error body, would drop a field *name* that is a message
 * rather than a value. The mark lives here, with no dependency of its own,
 * because everything that writes an answer can reach it and nothing that
 * writes an answer may import the gate (see base/answers.js).
 *
 * @param {Express.Response} res the response
 * @returns {Express.Response} the response
 */
function seal(res) {
  if (res) {
    res._sealed = true;
  }

  return res;
}

/**
 * Was this body sealed? Reading it clears the mark: it describes one answer
 *
 * @param {Express.Response} res the response
 * @returns {boolean} sealed or not
 */
function sealed(res) {
  if (!res || res._sealed !== true) {
    return false;
  }

  res._sealed = false;

  return true;
}

module.exports = {
  HAL,
  JSON_TYPE,
  NONCE_SENTINEL,
  PERMISSIONS_POLICY,
  VERSION_TYPE,
  apiVersion,
  cachedCsp,
  createNonce,
  cspDirectives,
  isInertiaPage,
  jsonType,
  jsonTypes,
  merge,
  noStore,
  nonceEnabled,
  normalizeVersion,
  seal,
  sealed,
  secureHeaders,
  versionGuard,
};
