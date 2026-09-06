/**
 * Call logs: the request an application answered, and the requests it made
 * because of it.
 *
 * Two records joined by the request id `base/request-id.js` already threads
 * through everything:
 *
 * - **inbound**, one row per call the application answered -- the method,
 *   the path, the route, the status, how long it took, the person when one
 *   is known, and the bodies henri can read;
 * - **outbound**, one row per call the application made -- the same, plus
 *   the service it went to.
 *
 * They are one table with a `direction` column rather than two tables, and
 * that is the feature rather than an economy: the question worth keeping
 * either of them for is "what happened during request `X`", and the answer
 * is one `SELECT ... WHERE request_id = ? ORDER BY at` instead of two reads
 * and a merge. One table also means one sweep, one partition scheme and one
 * set of indexes to keep honest.
 *
 * ## This is not the access trail, and the difference is the point
 *
 * `base/trail.js` records field *names*, counts, public identifiers and
 * digests, and it **refuses** a value (`HENRI_TRAIL_VALUE_REFUSED`). It is
 * evidence: hash-chained, append-only, kept for a year, and the thing you
 * hand a regulator.
 *
 * A call log is the opposite by design. It holds **values** -- the body
 * that came in, the body that went out -- because a call log that does not
 * is a slower version of the web server's access log. It is a debugging
 * instrument: kept for days rather than years, sampled rather than
 * complete, and never evidence of anything, because nothing stops a writer
 * from editing a row.
 *
 * So: **the trail answers "who saw this record", the call log answers "what
 * did this request do".** An application that reaches for the wrong one
 * either gets a second copy of its personal data (the trail's failure mode,
 * which the trail refuses) or a record that proves nothing (this one's).
 * Neither substitutes for the other and neither should be turned on to do
 * the other's job.
 *
 * ## Four decisions, because the naive version is a denial of service
 *
 * A table that grows without bound, written on the hot path, holding the
 * one copy of every payload an attacker can make large, is an outage
 * waiting for traffic. Each of these is a decision rather than a default:
 *
 * 1. **Off unless configured.** No `config.calls`, no table, no middleware,
 *    no allocation: `2.server.js` reads the configuration before it builds
 *    the middleware chain and mounts nothing. An application that says
 *    nothing pays nothing, and the cost of being wrong here is paid by
 *    every application rather than by the ones that asked.
 * 2. **The write never blocks the answer.** A finished call is pushed onto
 *    a bounded in-memory buffer and the response goes out; a timer (and a
 *    full buffer) flushes with one multi-row `INSERT`. A flush that fails
 *    is logged once and dropped -- a call log that can fail a request is a
 *    liability that turns a database hiccup into an outage. The buffer is
 *    bounded too (`calls.buffer`), and what it drops is counted and
 *    reported by `henri.calls.stats()` rather than lost quietly.
 * 3. **The payload is bounded before it is stored.** A body is captured up
 *    to `calls.maxBody` (8kb) and marked truncated; only a body henri can
 *    *walk* is captured at all, because only a walked body can be redacted
 *    (see below). Everything else is a size and a content type.
 * 4. **The number of rows a client can cause is bounded twice, and the two
 *    bounds answer different failures.** `calls.sample` is a fraction and
 *    bounds the steady state proportionally to traffic. It is not enough on
 *    its own: one percent of a million requests a second is still ten
 *    thousand rows a second, so `calls.maxPerSecond` is an absolute
 *    per-process ceiling that a burst cannot argue with. Sampling keeps the
 *    table the size the application chose; the ceiling keeps a spike from
 *    turning the log into the outage.
 *
 * ### Why the sampling decision is keyed with the secret
 *
 * The decision has to be the *same* for the inbound call and every outbound
 * call it caused, in every process, without carrying state -- otherwise a
 * sampled request shows up with half its outbound calls missing, which is
 * worse than not sampling it. So it is a hash of the request id rather than
 * a coin flip.
 *
 * And the request id is **attacker-controlled**: `base/request-id.js` takes
 * it from the `X-Request-Id` header when it looks sane, because a proxy
 * sets one. A plain hash would let a client pick ids that land in the
 * sampled bucket and defeat `calls.sample` entirely. The hash is therefore
 * seeded with `config.secret`, so which ids are sampled is not something a
 * client can work out. `calls.maxPerSecond` is the backstop that holds even
 * if it could.
 *
 * ## What the redaction refuses
 *
 * This is the most dangerous table henri writes, so the rule is written
 * here and has a test of its own (`__tests__/calls.spec.js`):
 *
 * - everything stored goes through `redactor(henri)` -- `filterParameters`
 *   as substrings, the fields the models marked `personal` matched exactly,
 *   and the always-masked set (`encryption`) that no configuration lifts --
 *   at every depth, headers and bodies alike;
 * - `DENIED` headers are masked whatever the configuration says:
 *   `authorization`, `proxy-authorization`, `cookie`, `set-cookie`,
 *   `x-csrf-token`, `x-api-key` and the webhook signature. They are the
 *   credentials of the exchange and no `filterParameters` list has to
 *   remember them;
 * - the url keeps its path and loses the filtered query values
 *   (`urlRedactor`), and an outbound url loses its userinfo entirely --
 *   `https://user:pass@host/` is stored as `https://host/`;
 * - **only a body henri can walk is stored.** A plain object or an array is
 *   redacted key by key and kept; a string, a buffer, a stream or an HTML
 *   page is *not*, because there is no key to match and no way to redact
 *   inside it. Its size and its content type are kept instead. This is why
 *   the inbound response body is taken from `res.json(value)` -- the value,
 *   before it is serialized -- rather than by tapping the socket;
 * - the person is the `externalId` and nothing else. Not the primary key,
 *   not the email address: `publicUser()` already decided what a person
 *   looks like when they leave the server and this follows it;
 * - **the client's address is three columns of its own, never a header.**
 *   What henri believes, when it refuses to believe anything, and why the
 *   forwarding headers are masked out of the stored blob is the header of
 *   `base/address.js`. The short version: `X-Forwarded-For` is believed
 *   through `config.trustProxy` and a named header through
 *   `calls.address.from`, and a blanket `trustProxy: true` in front of a
 *   forwarded request records no client address at all.
 *
 * ## How it is swept
 *
 * `calls.keep` (30 days) with the retention sweep pruning it, the way
 * `config.trail.keep` is pruned -- and, where the dialect has it,
 * **partitions instead of rows**. `base/call-store.js` has the mechanics;
 * the short version is that dropping a partition is a metadata operation
 * and deleting ten million rows is not, which is the difference between a
 * sweep that works at scale and one that times out.
 *
 * @module base/calls
 */

const { EXTERNAL_ID } = require('./external-id');
const {
  FORWARDING,
  MAX,
  SOURCES,
  addressConfig,
  addressOf,
} = require('./address');
const { currentRequestId } = require('./request-id');
const { isFiltered, redactor, urlRedactor } = require('./redact');
const { fail } = require('./errors');
const { period } = require('./retention');

/** The table the calls are written to, unless the configuration says */
const DEFAULT_TABLE = 'henri_calls';

/** How long a row is kept, unless the configuration says */
const DEFAULT_KEEP = '30d';

/** How much of a body is stored, unless the configuration says */
const DEFAULT_BODY = 8192;

/** What `calls.always` accepts: the outcomes sampling never drops */
const ALWAYS = ['aborted', 'client-error', 'error'];

/** What `calls.partition` accepts */
const PARTITIONS = ['day', 'month'];

/** The dialects that can partition a table by range */
const PARTITIONABLE = ['mysql', 'postgres'];

/**
 * The headers whose value is never stored, whatever `filterParameters`
 * says. They are the credentials of the exchange, and a list an
 * application has to remember to write down is a list it forgets.
 *
 * The forwarding headers (`base/address.js`) are in it for a different
 * reason: they carry addresses, an address is personal data, and the stored
 * headers are one blob the erasure cannot reach inside. Masking them here
 * is what keeps the address in the columns that *can* be truncated,
 * exported and erased, rather than in two places with one of them out of
 * reach.
 */
const DENIED = Object.freeze([
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'webhook-signature',
  'x-api-key',
  'x-csrf-token',
  ...FORWARDING,
]);

/** What a row says when a body was longer than `calls.maxBody` */
const TRUNCATED = '…[truncated]';

/** The paths henri never records: its own probes, which run every second */
const PROBES = Object.freeze([
  '/_henri/health',
  '/healthz',
  '/livez',
  '/readyz',
]);

/** The two directions of a call */
const DIRECTIONS = ['in', 'out'];

/** The outcomes a row carries */
const OUTCOMES = ['aborted', 'failed', 'ok'];

/** How many buckets the sampling fraction is measured in */
const BUCKETS = 10000;

/** The offset basis of the 32 bit FNV-1a used by the sampling */
const FNV_BASIS = 2166136261;

/** Its prime */
const FNV_PRIME = 16777619;

/**
 * A 32 bit FNV-1a, seeded.
 *
 * Not a cryptographic hash and not pretending to be one: what it has to do
 * is spread ids evenly and be unpredictable without the seed, and it is
 * called once per request, which rules out an HMAC.
 *
 * @param {string} value what to hash
 * @param {number} [seed=FNV_BASIS] the starting state
 * @returns {number} a 32 bit unsigned integer
 */
function hash32(value, seed = FNV_BASIS) {
  let state = seed >>> 0;

  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index);
    state = Math.imul(state, FNV_PRIME) >>> 0;
  }

  return state >>> 0;
}

/**
 * A size, as a number of bytes or as `'8kb'`
 *
 * @param {*} value what the configuration said
 * @param {number} fallbackTo what to use when it said nothing
 * @returns {number} a number of bytes, or 0 for "store no body"
 */
function bytes(value, fallbackTo) {
  if (value === false) {
    return 0;
  }

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value !== 'string') {
    return fallbackTo;
  }

  const found = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/iu.exec(value);

  if (!found) {
    return fallbackTo;
  }

  const scale = { gb: 1073741824, kb: 1024, mb: 1048576 };
  const unit = (found[2] || '').toLowerCase();

  return Math.floor(Number(found[1]) * (scale[unit] || 1));
}

/**
 * A whole number from the configuration, or the default
 *
 * @param {*} value what the configuration said
 * @param {number} fallbackTo what to use when it said nothing
 * @param {number} [least=1] the smallest accepted value
 * @returns {number} the number
 */
function whole(value, fallbackTo, least = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallbackTo;
  }

  return Math.max(Math.floor(value), least);
}

/**
 * `config.calls`, normalized.
 *
 * Off is the absence of the key, `false`, or an object saying so: a
 * disabled call log creates no table, mounts no middleware and allocates
 * nothing.
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {object} the settings
 */
function callsConfig(config) {
  const has = config && typeof config.has === 'function' && config.has('calls');
  const raw = has ? config.get('calls') : false;

  if (raw === false || raw === null || typeof raw === 'undefined') {
    return {
      address: null,
      always: [],
      batch: 500,
      buffer: 1000,
      enabled: false,
      flush: 1000,
      ignore: [],
      inbound: false,
      keep: null,
      maxBody: 0,
      maxPerSecond: 0,
      outbound: false,
      partition: false,
      partitionsAhead: 0,
      sample: 0,
      store: 'default',
      sweep: 5000,
      table: DEFAULT_TABLE,
    };
  }

  const settings = raw && typeof raw === 'object' ? raw : {};
  const sample =
    typeof settings.sample === 'number' && Number.isFinite(settings.sample)
      ? Math.min(Math.max(settings.sample, 0), 1)
      : 1;

  return {
    address: addressConfig(settings.address),
    always: Array.isArray(settings.always)
      ? settings.always.filter((name) => ALWAYS.includes(name))
      : ['error'],
    batch: whole(settings.batch, 500),
    buffer: whole(settings.buffer, 1000),
    enabled: true,
    flush: whole(settings.flush, 1000),
    ignore: Array.isArray(settings.ignore)
      ? settings.ignore.filter((one) => typeof one === 'string' && one !== '')
      : [],
    inbound: settings.inbound !== false,
    keep:
      settings.keep === false ? null : period(settings.keep || DEFAULT_KEEP),
    maxBody:
      settings.bodies === false ? 0 : bytes(settings.maxBody, DEFAULT_BODY),
    maxPerSecond:
      settings.maxPerSecond === false
        ? Infinity
        : whole(settings.maxPerSecond, 100),
    outbound: settings.outbound !== false,
    partition: PARTITIONS.includes(settings.partition)
      ? settings.partition
      : false,
    partitionsAhead: whole(settings.partitionsAhead, 7),
    sample,
    store: settings.store || 'default',
    sweep: whole(settings.sweep, 5000),
    table:
      typeof settings.table === 'string' && settings.table !== ''
        ? settings.table
        : DEFAULT_TABLE,
  };
}

/**
 * Is this a value the redactor can walk, key by key?
 *
 * The whole capture rule in one predicate: a plain object or an array can
 * be redacted and is kept, anything else cannot and is not.
 *
 * @param {*} value a body
 * @returns {boolean} whether it can be stored
 */
function walkable(value) {
  if (Array.isArray(value)) {
    return true;
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  if (Buffer.isBuffer(value) || value instanceof Date) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/**
 * A body, redacted, serialized and capped.
 *
 * Anything that is not walkable answers `{ body: null, kind }`, which is
 * how the row says "there was a payload and it is not in here".
 *
 * @param {*} value the body
 * @param {object} options `redact` (the instance's redactor) and `max`
 * @returns {{body: ?string, truncated: boolean, kind: ?string}} the capture
 */
function capture(value, { max, redact }) {
  if (typeof value === 'undefined' || value === null || max === 0) {
    return { body: null, kind: null, truncated: false };
  }

  if (!walkable(value)) {
    return {
      body: null,
      kind: Buffer.isBuffer(value) ? 'buffer' : typeof value,
      truncated: false,
    };
  }

  let text;

  try {
    text = JSON.stringify(redact(value));
  } catch (error) {
    return { body: null, kind: 'unserializable', truncated: false };
  }

  if (typeof text !== 'string') {
    return { body: null, kind: 'unserializable', truncated: false };
  }

  if (text.length <= max) {
    return { body: text, kind: 'json', truncated: false };
  }

  return {
    body: text.slice(0, max) + TRUNCATED,
    kind: 'json',
    truncated: true,
  };
}

/**
 * The headers of a call, masked.
 *
 * `DENIED` first and unconditionally, then the application's own filters
 * and the personal field names, so a header called `x-customer-email` in an
 * application that marked `email` personal is masked like everything else.
 *
 * @param {object} source the headers
 * @param {object} options `filters`, `keys` and `max`
 * @returns {?object} the headers, or null when there are none
 */
function headers(source, { filters, keys, max }) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const result = {};
  let count = 0;

  for (const name of Object.keys(source)) {
    if (count >= max) {
      break;
    }

    const lower = name.toLowerCase();

    count += 1;
    result[name] =
      DENIED.includes(lower) || isFiltered(name, filters, keys)
        ? '[FILTERED]'
        : String(source[name]).slice(0, 200);
  }

  return count > 0 ? result : null;
}

/**
 * A url with its userinfo removed and its filtered query values masked.
 *
 * The userinfo goes first and unconditionally: `https://key:secret@host/`
 * is a credential in a field no `filterParameters` list covers.
 *
 * @param {string} url a url or a path
 * @param {function} mask the instance's url redactor
 * @returns {?string} the url, or null
 */
function safeUrl(url, mask) {
  if (typeof url !== 'string' || url === '') {
    return null;
  }

  let text = url;

  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(text)) {
    try {
      const parsed = new URL(text);

      parsed.username = '';
      parsed.password = '';
      text = parsed.toString();
    } catch (error) {
      return null;
    }
  }

  return mask(text).slice(0, 2000);
}

/**
 * The outcome of a finished call
 *
 * @param {object} call what was recorded
 * @returns {string} one of OUTCOMES
 */
function outcomeOf(call) {
  if (call.aborted) {
    return 'aborted';
  }

  return call.error || !call.status || call.status >= 500 ? 'failed' : 'ok';
}

/**
 * Does this call match one of the `calls.always` conditions?
 *
 * These are the calls sampling does not get to drop. They are recorded
 * without their bodies -- the decision not to capture was made before the
 * status was known and there is nothing to go back for, which is honest and
 * costs nothing.
 *
 * @param {object} row a row about to be written
 * @param {Array<string>} list `calls.always`
 * @returns {boolean} whether it is kept anyway
 */
function always(row, list) {
  if (list.length === 0) {
    return false;
  }

  if (row.outcome === 'aborted') {
    return list.includes('aborted');
  }

  if (row.status >= 500 || row.outcome === 'failed') {
    return list.includes('error');
  }

  return row.status >= 400 && list.includes('client-error');
}

/**
 * The `externalId` of whoever the request belonged to, and nothing else
 *
 * @param {*} user `req.user`, or nothing
 * @returns {?string} the public identifier, or null
 */
function actorOf(user) {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const external = user[EXTERNAL_ID];

  return typeof external === 'string' && external !== '' ? external : null;
}

/**
 * Should this path be recorded at all?
 *
 * The health probes never are: they run every second, they answer nothing
 * interesting and they would be most of the table.
 *
 * @param {string} path the request path
 * @param {Array<string>} ignore `calls.ignore`
 * @returns {boolean} whether to skip it
 */
function ignored(path, ignore) {
  if (PROBES.includes(path)) {
    return true;
  }

  return ignore.some((prefix) => path === prefix || path.startsWith(prefix));
}

/**
 * A bounded, per-second token bucket.
 *
 * The absolute ceiling of decision 4. It is per process, deliberately:
 * henri cannot know how many processes run (`base/shared.js` says so about
 * the rate limit), and a ceiling that needs a round trip to a shared store
 * to decide whether to write a debugging row would cost more than the row.
 *
 * @class Ceiling
 */
class Ceiling {
  /**
   * Creates an instance of Ceiling.
   *
   * @param {number} perSecond how many rows a second are allowed
   * @memberof Ceiling
   */
  constructor(perSecond) {
    this.perSecond = perSecond;
    this.second = 0;
    this.used = 0;
  }

  /**
   * Takes one, if there is one
   *
   * @param {number} [now=Date.now()] the moment
   * @returns {boolean} whether the row may be written
   * @memberof Ceiling
   */
  take(now = Date.now()) {
    if (this.perSecond === Infinity) {
      return true;
    }

    const second = Math.floor(now / 1000);

    if (second !== this.second) {
      this.second = second;
      this.used = 0;
    }

    if (this.used >= this.perSecond) {
      return false;
    }

    this.used += 1;

    return true;
  }
}

/**
 * The middleware that records the inbound half.
 *
 * Mounted by `2.server.js` right after `requestId()` and only when
 * `config.calls` asked for it, so it is the outermost thing in the chain
 * that has an id to join on. That position is the point: a request refused
 * by the rate limit, by the body parser or by the CSRF check is exactly the
 * one worth having in the log, and a middleware mounted further down would
 * never see it.
 *
 * @param {object} henri the instance
 * @returns {function} express middleware
 */
function inbound(henri) {
  return (req, res, next) => {
    const calls = henri.calls;

    if (!calls || !calls.enabled || !calls.settings.inbound) {
      next();

      return;
    }

    if (ignored(req.path, calls.settings.ignore)) {
      next();

      return;
    }

    const at = Date.now();
    const started = process.hrtime.bigint();
    const keep = calls.samples(req.id);
    // The address is read here rather than at `close`: an aborted request
    // has no `remoteAddress` left by the time the socket has gone, and an
    // aborted request is exactly what `calls.always` keeps
    const state = {
      address: addressOf(req, calls.settings.address),
      body: undefined,
      keep,
    };

    // The response body is taken as a *value* from `res.json`, never off
    // the socket: a value can be walked and redacted, bytes cannot. Only a
    // sampled request pays for the wrapper
    if (keep && calls.settings.maxBody > 0) {
      const json = res.json;

      res.json = function wrapped(value) {
        state.body = value;

        return json.call(this, value);
      };
    }

    let done = false;

    res.on('close', () => {
      if (done) {
        return;
      }

      done = true;
      calls.finished(req, res, { at, started, ...state });
    });

    next();
  };
}

/**
 * The seam an application's own HTTP client goes through.
 *
 * henri wraps nobody's client: there is no interceptor to install and no
 * patched `fetch`. An application that wants its outbound calls in the log
 * calls this around whatever it already uses, which is two lines and works
 * with every client there is.
 *
 * @param {object} calls the module
 * @param {object} details `service`, `method`, `url`, `headers`, `body`
 * @returns {function} `finish({ status, headers, body, error })`
 */
function track(calls, details) {
  if (!calls || !calls.enabled || !calls.settings.outbound) {
    return () => null;
  }

  const at = Date.now();
  const started = process.hrtime.bigint();
  const requestId =
    details.requestId === null ? null : details.requestId || currentRequestId();
  let done = false;

  return (answer = {}) => {
    if (done) {
      return null;
    }

    done = true;

    return calls.write({
      at,
      duration: Number((process.hrtime.bigint() - started) / 1000000n),
      error: answer.error || null,
      meta: { ...details.meta, ...answer.meta },
      method: details.method,
      request: details.request || null,
      requestId,
      response: { body: answer.body, headers: answer.headers },
      service: details.service,
      status: answer.status,
      url: answer.url || details.url,
    });
  };
}

/**
 * The row a call becomes, redacted and bounded.
 *
 * One function for both directions, which is what keeps the redaction from
 * having two implementations that agree today.
 *
 * @param {object} call the call
 * @param {object} context `filters`, `keys`, `redact`, `mask`, `settings`
 * @returns {object} the row, in database shape
 */
function toRow(call, context) {
  const { mask, redact, settings } = context;
  const max = settings.maxBody;
  const head = { filters: context.filters, keys: context.keys, max: 50 };
  const request = capture(call.request && call.request.body, { max, redact });
  const response = capture(call.response && call.response.body, {
    max,
    redact,
  });
  const truncated = [
    request.truncated ? 'request' : null,
    response.truncated ? 'response' : null,
  ].filter(Boolean);

  const address = call.address || {};

  return {
    actor: call.actor || null,
    at: call.at,
    client_ip: text(address.client, MAX),
    direction: DIRECTIONS.includes(call.direction) ? call.direction : 'out',
    duration: Number.isFinite(call.duration) ? Math.round(call.duration) : null,
    error: call.error ? String(call.error).slice(0, 190) : null,
    id: call.id,
    ip_source: SOURCES.includes(address.source) ? address.source || null : null,
    meta: metaOf(call, { request, response }, redact),
    method: String(call.method || 'GET')
      .toUpperCase()
      .slice(0, 12),
    outcome: OUTCOMES.includes(call.outcome) ? call.outcome : outcomeOf(call),
    peer_ip: text(address.peer, MAX),
    request_body: request.body,
    request_headers: jsonOf(
      headers(call.request && call.request.headers, head)
    ),
    request_id: call.requestId ? String(call.requestId).slice(0, 64) : null,
    response_body: response.body,
    response_headers: jsonOf(
      headers(call.response && call.response.headers, head)
    ),
    route: call.route ? String(call.route).slice(0, 190) : null,
    service: call.service ? String(call.service).slice(0, 120) : null,
    status: Number.isFinite(call.status) ? Math.round(call.status) : null,
    truncated: truncated.length > 0 ? truncated.join(',') : null,
    url: safeUrl(call.url, mask),
  };
}

/**
 * A string column, bounded, or null
 *
 * @param {*} value anything
 * @param {number} max the longest the column takes
 * @returns {?string} the value, or null
 */
function text(value, max) {
  return typeof value === 'string' && value !== '' ? value.slice(0, max) : null;
}

/**
 * A value as JSON, or null
 *
 * @param {*} value anything already redacted
 * @returns {?string} the JSON, or null
 */
function jsonOf(value) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return null;
  }
}

/**
 * The `meta` of a row: what the capture could not keep, and whatever the
 * caller added
 *
 * @param {object} call the call
 * @param {object} captured the two captures
 * @param {function} redact the instance's redactor
 * @returns {?string} the JSON, or null
 */
function metaOf(call, captured, redact) {
  const meta = {};

  if (captured.request.kind && captured.request.kind !== 'json') {
    meta.requestBody = captured.request.kind;
  }

  if (captured.response.kind && captured.response.kind !== 'json') {
    meta.responseBody = captured.response.kind;
  }

  if (Number.isFinite(call.requestBytes)) {
    meta.requestBytes = call.requestBytes;
  }

  if (Number.isFinite(call.responseBytes)) {
    meta.responseBytes = call.responseBytes;
  }

  if (call.meta && typeof call.meta === 'object') {
    Object.assign(meta, redact(call.meta));
  }

  return Object.keys(meta).length > 0 ? jsonOf(meta) : null;
}

/**
 * A stored row, read back as a call
 *
 * @param {object} row a row from the store
 * @returns {object} the call
 */
function toCall(row) {
  const parse = (value) => {
    if (typeof value !== 'string' || value === '') {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      // A truncated body is not valid JSON any more, and saying so is
      // better than answering null: it is what was captured
      return value;
    }
  };

  const at = Number(row.at);

  return {
    actor: row.actor || null,
    address: {
      // `client` is null when the configuration could not support an
      // answer, and `source` says which of the two nulls this is
      client: row.client_ip || null,
      peer: row.peer_ip || null,
      source: row.ip_source || null,
    },
    at: Number.isFinite(at) ? new Date(at).toISOString() : null,
    direction: row.direction,
    duration: row.duration === null ? null : Number(row.duration),
    error: row.error || null,
    id: row.id,
    meta: parse(row.meta),
    method: row.method,
    outcome: row.outcome,
    request: {
      body: parse(row.request_body),
      headers: parse(row.request_headers),
    },
    requestId: row.request_id || null,
    response: {
      body: parse(row.response_body),
      headers: parse(row.response_headers),
    },
    route: row.route || null,
    service: row.service || null,
    status: row.status === null ? null : Number(row.status),
    truncated: row.truncated ? row.truncated.split(',') : [],
    url: row.url || null,
  };
}

/**
 * The redaction context of an instance, built once per flush rather than
 * once per row
 *
 * @param {object} henri the instance
 * @param {object} settings the normalized settings
 * @returns {object} `{ filters, keys, mask, redact, settings }`
 */
function contextOf(henri, settings) {
  const { config, privacy } = henri;
  const filters =
    config && config.has('filterParameters')
      ? config.get('filterParameters')
      : [];

  return {
    filters: Array.isArray(filters) ? filters : [],
    keys: (privacy && privacy.keys) || new Set(),
    mask: urlRedactor(henri),
    redact: redactor(henri),
    settings,
  };
}

/**
 * The seed the sampling hashes with: `config.secret`, folded once.
 *
 * @param {object} config the config module
 * @returns {number} the seed
 */
function seedOf(config) {
  const secret =
    config && config.has('secret') ? String(config.get('secret') || '') : '';

  return hash32(secret);
}

/**
 * Refuses a partition scheme the dialect cannot carry out
 *
 * @param {string} dialect the store's dialect
 * @param {string|boolean} partition `calls.partition`
 * @returns {boolean} true when there is nothing to refuse
 * @throws HENRI_CALLS_PARTITION_UNSUPPORTED when the dialect has no ranges
 */
function checkPartition(dialect, partition) {
  if (!partition || PARTITIONABLE.includes(dialect)) {
    return true;
  }

  const error = fail(
    'HENRI_CALLS_PARTITION_UNSUPPORTED',
    `calls.partition asked for "${partition}" partitions and a ${dialect} store has none`
  );

  error.hint =
    'PostgreSQL and MySQL partition by range; sqlite, SQL Server and MongoDB sweep by deleting rows. Leave calls.partition out on those.';

  throw error;
}

module.exports = {
  ALWAYS,
  BUCKETS,
  Ceiling,
  DEFAULT_BODY,
  DEFAULT_KEEP,
  DEFAULT_TABLE,
  DENIED,
  DIRECTIONS,
  OUTCOMES,
  PARTITIONABLE,
  PARTITIONS,
  PROBES,
  TRUNCATED,
  actorOf,
  always,
  bytes,
  callsConfig,
  capture,
  checkPartition,
  contextOf,
  hash32,
  headers,
  ignored,
  inbound,
  jsonOf,
  outcomeOf,
  safeUrl,
  seedOf,
  text,
  toCall,
  toRow,
  track,
  walkable,
};
