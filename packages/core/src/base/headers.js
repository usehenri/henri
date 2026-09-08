const crypto = require('crypto');
const helmet = require('helmet');

const { assetOrigin, assetPrefix } = require('./assets');
const { fail } = require('./errors');

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
 * The directives an asset prefix's origin is added to: everything a
 * compiled application loads from where its bundles live. `default-src` is
 * not one of them (see `cspDirectives`).
 */
const ASSET_DIRECTIVES = [
  'script-src',
  'style-src',
  'font-src',
  'img-src',
  'connect-src',
  'worker-src',
  'media-src',
];

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
 * ---------------------------------------------------------------------------
 * Composing a policy: `config.helmet` replaces, `config.csp` adds
 * ---------------------------------------------------------------------------
 *
 * `config.helmet` is merged over henri's own options and `merge()` replaces
 * arrays. For every other helmet option that is right -- `referrerPolicy:
 * { policy: 'no-referrer' }` is one value, and an application writing it
 * means it. For the Content Security Policy it was a trap, and the trap was
 * measured on a booted application rather than assumed. This:
 *
 *     "assets": { "prefix": "https://cdn.example.com" },
 *     "csp": { "nonce": true },
 *     "helmet": { "contentSecurityPolicy": { "directives": {
 *       "script-src": ["'self'", "https://plausible.io"] } } }
 *
 * used to answer `script-src 'self' https://plausible.io`, where henri had
 * built `script-src 'self' https://cdn.example.com 'nonce-h7Qk...'`. Three
 * things left with the array and none of them was named in the answer: the
 * origin of `config.assets.prefix`, so every script the build wrote is
 * refused and the application boots, answers 200 and paints nothing; the
 * nonce, so `csp.nonce: true` was on and named nowhere while the renderer
 * kept stamping it on the tags; and, in development, `'unsafe-inline'` and
 * `'unsafe-eval'`, which is the hot reload. The header stayed well formed
 * throughout, which is why nothing said anything.
 *
 * A fourth was worse. helmet accepts both spellings of a directive name and
 * dashifies them, so `scriptSrc` and `script-src` are one directive to it --
 * but two keys to a deep merge, and helmet then **refused the pair**:
 * `Content-Security-Policy received a duplicate directive "script-src"`,
 * thrown out of `secureHeaders()` at boot, naming a directive the
 * application never wrote.
 *
 * Three things changed:
 *
 * **The two spellings are folded before the merge** (`canonicalDirectives`).
 * `scriptSrc` now overrides `script-src`, which is what it obviously meant,
 * and the boot no longer fails on a spelling helmet itself accepts. An
 * application spelling *one* directive twice in its *own* object is still
 * refused (`HENRI_CONFIG_CSP_DUPLICATE_DIRECTIVE`), because there is no
 * reading of that which is not a mistake and picking a winner by JSON key
 * order would be henri guessing.
 *
 * **`config.csp.add` composes.** An application adding one origin -- an
 * analytics script, a font host, a Sentry ingest -- is not making a
 * statement about the rest of the directive, and it should not have to
 * repeat what henri put there to keep it. `{ "csp": { "add": {
 * "script-src": ["https://plausible.io"] } } }` adds the source and leaves
 * the asset origin, the nonce and the development sources where they were.
 * It runs *after* `config.helmet`, so the two compose in one direction and
 * one order: helmet replaces, `csp.add` adds.
 *
 * **The nonce is applied last, after both.** It is the one thing an
 * override cannot be making a statement about: the value is drawn per
 * response, so there is no way to write it in a `config/*.json` array, and
 * `csp.nonce: true` is already the application asking for it. So the nonce
 * goes into whatever `script-src` ends up being -- and henri's rule about
 * `'unsafe-inline'` next to a nonce (see `cspDirectives`) applies to that
 * final array too, an application's own included, because it is a statement
 * about what the browser does and not about taste.
 *
 * And what an override *did* take out is said out loud: `cspLosses()` walks
 * henri's own directives against the ones the application will actually
 * send, and `secureHeaders()` names every source that is gone in one boot
 * line, the asset origin called out for what it is.
 *
 * Two candidates were rejected:
 *
 * - **Unioning the arrays of `config.helmet` itself.** It reads well until
 *   an application wants henri's `'unsafe-inline'` out of `style-src`, or
 *   `data:` out of `img-src` -- legitimate things to want, and a union
 *   makes them unsayable without a second `replace` spelling next to the
 *   first. `config.helmet` is the raw helmet option bag and means exactly
 *   what helmet means; the composing verb belongs in a key of henri's own.
 * - **Refusing the boot when an override drops the asset origin.** henri
 *   cannot know that it is wrong: an application may serve its fonts and
 *   images from the CDN and its scripts from here, and a `script-src`
 *   without the origin is then correct. A refusal on a guess is worse than
 *   a warning that names the guess, which is the position
 *   `base/embeds.js` already takes on a relation that overran its bound.
 */

/**
 * helmet's other spelling of a directive name: `scriptSrc` is `script-src`.
 * Its own `dashify`, so the two are one directive here as well.
 *
 * @param {string} name a directive name, in either spelling
 * @returns {string} the canonical, hyphenated name
 */
const dashify = (name) =>
  name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);

/**
 * The list a directive holds. helmet takes an array or a bare string; a
 * `null` (delete), a Set or its disable symbol are none of those.
 *
 * @param {*} value what a directive holds
 * @returns {?Array<*>} the sources, or null when it is not a list
 */
function sourcesOf(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === 'string' ? [value] : null;
}

/**
 * An override's directives, every name in helmet's canonical spelling
 *
 * @param {object} directives what `config.helmet` wrote
 * @returns {object} the same directives, hyphenated
 * @throws {Error} HENRI_CONFIG_CSP_DUPLICATE_DIRECTIVE on two spellings of one
 */
function canonicalDirectives(directives) {
  const result = {};
  const seen = new Map();

  for (const name of Object.keys(directives)) {
    const canonical = dashify(name);

    if (seen.has(canonical)) {
      throw fail(
        'HENRI_CONFIG_CSP_DUPLICATE_DIRECTIVE',
        `config.helmet.contentSecurityPolicy.directives names ${canonical} twice, as "${seen.get(canonical)}" and as "${name}"`
      );
    }

    seen.set(canonical, name);
    result[canonical] = directives[name];
  }

  return result;
}

/**
 * `config.helmet`, ready to merge: `permissionsPolicy` taken out (henri's
 * own, and helmet refuses a key it does not know) and the directive names
 * of the policy folded to one spelling.
 *
 * @param {object} custom what `config.helmet` holds
 * @returns {object} the options helmet is given
 */
function helmetOptions(custom) {
  const options = Object.assign({}, custom);

  delete options.permissionsPolicy;

  const policy = options.contentSecurityPolicy;

  if (isPlainObject(policy) && isPlainObject(policy.directives)) {
    options.contentSecurityPolicy = Object.assign({}, policy, {
      directives: canonicalDirectives(policy.directives),
    });
  }

  return options;
}

/**
 * The sources `config.csp.add` asks for, by canonical directive name.
 *
 * Two spellings of one directive are concatenated rather than refused: both
 * are additions, so there is no ambiguity about what was meant.
 *
 * @param {object} config `henri.config`
 * @returns {?object} `{ '<directive>': ['<source>'] }`, or null for none
 */
function cspAdditions(config) {
  const csp = config && config.has('csp') ? config.get('csp') : null;
  const add = csp && isPlainObject(csp.add) ? csp.add : null;

  if (!add) {
    return null;
  }

  const result = {};

  for (const name of Object.keys(add)) {
    const sources = Array.isArray(add[name]) ? add[name].map(String) : [];

    if (sources.length > 0) {
      const canonical = dashify(name);

      result[canonical] = (result[canonical] || []).concat(sources);
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * `config.csp.add` applied to the directives an application will send.
 *
 * A directive the policy does not carry is seeded from `default-src`, which
 * is what the browser was falling back to for it: adding one source to
 * `frame-src` must not be a way of quietly taking `'self'` away from it.
 * A directive the application deleted (`null`) stays deleted -- the
 * fallback it chose is what it asked for.
 *
 * @param {object} directives the directives so far
 * @param {?object} add what `config.csp.add` holds
 * @returns {object} the directives, with the additions
 */
function withAdditions(directives, add) {
  if (!add) {
    return directives;
  }

  const result = Object.assign({}, directives);

  for (const name of Object.keys(add)) {
    const current = result[name];

    if (typeof current !== 'undefined' && !sourcesOf(current)) {
      continue;
    }

    const base = sourcesOf(current) || sourcesOf(result['default-src']) || [];

    result[name] = base.concat(
      add[name].filter((source) => !base.includes(source))
    );
  }

  return result;
}

/**
 * The nonce, and henri's rule about `'unsafe-inline'` next to one, applied
 * to whatever `script-src` ended up being.
 *
 * Last of the three passes on purpose (see the block above): the value is
 * drawn per response, so no configuration file can name it, and an override
 * replacing `script-src` is therefore never a statement about it.
 *
 * @param {object} directives the directives so far
 * @param {(string|function|null)} nonce the nonce source expression
 * @returns {object} the directives, with the nonce
 */
function withNonce(directives, nonce) {
  const sources = sourcesOf(directives['script-src']);

  if (!nonce || !sources) {
    return directives;
  }

  return Object.assign({}, directives, {
    'script-src': sources
      .filter((source) => source !== "'unsafe-inline'")
      .concat(nonce),
  });
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
 * `origin` is the host `config.assets.prefix` names, when it names another
 * one. **A policy that does not know about it is what turns an asset prefix
 * into a blank page**: every script of the document is refused, the
 * application answers 200 and the only trace is in the browser console. So
 * the origin is added to the directives that carry what a build produced --
 * the entry module and its chunks (`script-src`, which also governs
 * `modulepreload`), the stylesheets (`style-src`), the fonts and images
 * their css names (`font-src`, `img-src`), the lazy fetches and the source
 * maps (`connect-src`), the workers (`worker-src`) and the media
 * (`media-src`).
 *
 * `default-src` is not one of them, deliberately: widening it would let the
 * asset host be framed and embedded too, and the only thing that falls back
 * to it here is `<link rel="prefetch">` -- a refused prefetch costs a warm
 * cache, never a page.
 *
 * @param {object} [options={}] options
 * @param {boolean} [options.isDev=false] development mode
 * @param {(string|function|null)} [options.nonce=null] the nonce source expression
 * @param {?string} [options.origin=null] the origin serving the assets
 * @param {boolean} [options.secure=false] the request arrived over https
 * @returns {object} directives, helmet style
 */
function cspDirectives({
  isDev = false,
  nonce = null,
  origin = null,
  secure = false,
} = {}) {
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

  if (origin) {
    for (const directive of ASSET_DIRECTIVES) {
      const sources = directives[directive] || ["'self'"];

      directives[directive] = sources.includes(origin)
        ? sources
        : sources.concat(origin);
    }
  }

  if (!secure) {
    delete directives['upgrade-insecure-requests'];
  }

  // `withNonce` is where the rule lives; `secureHeaders` applies it after
  // the merge instead, so an override cannot drop the nonce
  return withNonce(directives, nonce);
}

/**
 * The directives an application actually sends: henri's own, replaced key
 * by key by `config.helmet`, added to by `config.csp.add`, and the nonce
 * last. One function, so what the boot warns about and what the middleware
 * sends cannot drift.
 *
 * @param {Henri} henri the henri instance
 * @param {object} [options={}] options
 * @param {(string|function|null)} [options.nonce=null] the nonce source expression
 * @param {boolean} [options.secure=false] the request arrived over https
 * @returns {?object} the directives, or null when the policy is off
 */
function directivesFor(henri, { nonce = null, secure = false } = {}) {
  const { config } = henri;
  const custom = config.has('helmet') ? config.get('helmet') : {};
  const origin = assetOrigin(assetPrefix(config));
  const mine = cspDirectives({ isDev: henri.isDev, origin, secure });
  const policy = isPlainObject(custom)
    ? helmetOptions(custom).contentSecurityPolicy
    : null;

  if (policy === false) {
    return null;
  }

  const replaced =
    isPlainObject(policy) && isPlainObject(policy.directives)
      ? merge(mine, policy.directives)
      : mine;

  return withNonce(withAdditions(replaced, cspAdditions(config)), nonce);
}

/**
 * Henri's own directives as it would have sent them, the nonce's effect on
 * `script-src` included but not the nonce itself.
 *
 * A loss is measured against this rather than against the raw defaults:
 * with `csp.nonce` on henri takes `'unsafe-inline'` out of `script-src`
 * itself, so reporting it as something an override dropped would name a
 * source that was never going to be sent.
 *
 * @param {Henri} henri the henri instance
 * @returns {object} the directives
 */
function ownDirectives(henri) {
  const { config } = henri;
  const origin = assetOrigin(assetPrefix(config));
  const mine = cspDirectives({ isDev: henri.isDev, origin });

  if (!nonceEnabled(config)) {
    return mine;
  }

  const sources = sourcesOf(mine['script-src']) || [];

  return Object.assign({}, mine, {
    'script-src': sources.filter((source) => source !== "'unsafe-inline'"),
  });
}

/**
 * The sources of henri's own policy that an application no longer sends,
 * by directive.
 *
 * This is the whole of "nothing henri does is silent": `config.helmet`
 * replaces an array, which is what it has always meant and what it keeps
 * meaning, and this is what says which of henri's sources went with it --
 * the asset origin, the development sources, `'none'` on a directive that
 * was closed. An application that meant it reads one line at boot; one that
 * did not reads the reason its page is blank.
 *
 * @param {Henri} henri the henri instance
 * @returns {object} `{ '<directive>': ['<source>'] }`, empty when nothing was lost
 */
function cspLosses(henri) {
  const { config } = henri;
  const custom = config.has('helmet') ? config.get('helmet') : {};

  if (custom === false) {
    return {};
  }

  const sent = directivesFor(henri);

  if (!sent) {
    // `contentSecurityPolicy: false` is not a loss, it is a decision
    return {};
  }

  const mine = ownDirectives(henri);
  const lost = {};

  for (const name of Object.keys(mine)) {
    const sources = sourcesOf(mine[name]) || [];
    const kept = sourcesOf(sent[name]) || [];
    const missing = sources.filter((source) => !kept.includes(source));

    if (missing.length > 0) {
      lost[name] = missing;
    }
  }

  return lost;
}

/**
 * Does any directive carry a function?
 *
 * @param {*} directives the directives
 * @returns {boolean} true when one source is a function
 */
function hasFunctionSource(directives) {
  if (!isPlainObject(directives)) {
    return false;
  }

  for (const name of Object.keys(directives)) {
    const sources = sourcesOf(directives[name]);

    if (sources && sources.some((source) => typeof source === 'function')) {
      return true;
    }
  }

  return false;
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
 * A directive carrying a function of its own is never cached, whatever it
 * serializes to: helmet calls it per request and this reads it once, so a
 * cached header would freeze whatever it answered against the stub.
 *
 * @param {object} options the `contentSecurityPolicy` options helmet is given
 * @returns {?{name: string, prefix: string, suffix: string}} the split header
 */
function cachedCsp(options) {
  let name = null;
  let value = null;
  let failed = null;

  if (hasFunctionSource(options && options.directives)) {
    return null;
  }

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
 * Say, once at boot, what an override took out of henri's own policy.
 *
 * The asset origin gets a line of its own: it is the one source in the list
 * that henri put there on the application's behalf rather than out of an
 * opinion, and losing it is the difference between a page and a blank one.
 *
 * @param {Henri} henri the henri instance
 * @param {?string} origin the origin serving the assets
 * @returns {Array<string>} the lines said, for the tests
 */
function announceLosses(henri, origin) {
  const { config } = henri;

  // `csp.nonce` with no policy to name it: a value drawn per response, put
  // on every script tag by the renderer, and allowed by nothing
  if (nonceEnabled(config) && !directivesFor(henri)) {
    const line =
      '=> config.csp.nonce is on and config.helmet turned the policy off: the nonce is generated, written into the markup and named by nothing';

    if (henri.pen && typeof henri.pen.warn === 'function') {
      henri.pen.warn('server', 'the content security policy is off', line);
    }

    return [line];
  }

  const lost = cspLosses(henri);
  const names = Object.keys(lost);

  if (names.length === 0) {
    return [];
  }

  const lines = names.map(
    (name) => `=> ${name} no longer names ${lost[name].join(' ')}`
  );

  if (origin && names.some((name) => lost[name].includes(origin))) {
    lines.push(
      `=> ${origin} is the origin of config.assets.prefix: a browser refuses every file the build wrote from a directive that does not name it`
    );
  }

  lines.push(
    '=> config.csp.add adds a source and keeps the rest: { "csp": { "add": { "script-src": ["https://plausible.io"] } } }'
  );

  if (henri.pen && typeof henri.pen.warn === 'function') {
    henri.pen.warn(
      'server',
      `config.helmet replaced ${names.length} content security policy directive${names.length > 1 ? 's' : ''}`,
      ...lines
    );
  }

  return lines;
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
 * The `directives` of the policy are the one thing that does not simply
 * merge: `directivesFor()` composes them (`config.helmet` replaces,
 * `config.csp.add` adds, the nonce goes last) and what an override took out
 * of henri's own is warned about once, here, at boot -- see the block above
 * `dashify`.
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
  const requested = isPlainObject(custom)
    ? custom.permissionsPolicy
    : undefined;
  const options = isPlainObject(custom) ? helmetOptions(custom) : {};

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
  // The policy names the asset origin in every environment, not only where
  // the production build uses the prefix. It costs a request nothing, and it
  // means a production configuration is never one directive away from a
  // document whose every script the browser refuses
  const origin = assetOrigin(assetPrefix(config));

  announceLosses(henri, origin);

  /**
   * The helmet options for one protocol and one nonce source
   *
   * @param {boolean} secure the request arrived over https
   * @param {(string|function|null)} nonce the nonce source expression
   * @returns {object} the options helmet is given
   */
  const optionsFor = (secure, nonce) => {
    const defaults = {
      contentSecurityPolicy: { directives: {}, useDefaults: false },
    };

    if (cors) {
      defaults.crossOriginResourcePolicy = { policy: 'cross-origin' };
    }

    if (henri.isDev) {
      defaults.strictTransportSecurity = false;
    }

    const merged = merge(defaults, options);

    // The directives do not merge, they compose: helmet replaces, csp.add
    // adds, the nonce goes last. Everything else of `contentSecurityPolicy`
    // -- reportOnly, useDefaults, false -- merges as it always did
    if (isPlainObject(merged.contentSecurityPolicy)) {
      merged.contentSecurityPolicy.directives = directivesFor(henri, {
        nonce,
        secure,
      });
    }

    return merged;
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
  ASSET_DIRECTIVES,
  HAL,
  JSON_TYPE,
  NONCE_SENTINEL,
  PERMISSIONS_POLICY,
  VERSION_TYPE,
  announceLosses,
  apiVersion,
  cachedCsp,
  createNonce,
  cspAdditions,
  cspDirectives,
  cspLosses,
  directivesFor,
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
