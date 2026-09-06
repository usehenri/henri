const util = require('util');

const { currentRequestId } = require('./request-id');
const { filterParameters, redact, redactUrl } = require('./redact');

/**
 * The runtime surface: what a booted application can be asked about itself.
 *
 * Everything else an agent has of a henri application is static analysis of
 * the files (`henri routes`, `henri doctor`, the MCP tools built on them).
 * This is the process: the last errors with the request that caused them,
 * the lines `pen` wrote, the routes the router really registered, a
 * read-only query and one record read through its model. `@usehenri/mcp`
 * calls it over the loopback interface and turns it into tools.
 *
 * ## The rules this module enforces
 *
 * 1. **Development only, with no opt-in.** `5.router.js` mounts the router
 *    only when henri is not in production, and `recorder()` answers nothing
 *    in production either: no ring buffer, no endpoint, no flag that turns
 *    one on. An agent pointed at a production application is told
 *    `PRODUCTION` and gets nothing else, rather than a partial answer it
 *    could mistake for the whole one.
 * 2. **This machine, and no browser.** `loopbackOnly()` (see `http.js`)
 *    refuses anything that did not come from the loopback interface.
 *    `X-Henri-Runtime: 1` is required on top of it: a page cannot send that
 *    header cross-origin without a preflight this router never answers. A
 *    request carrying `Origin` or `Sec-Fetch-Site` -- headers every browser
 *    attaches and no command line sends -- is refused outright, so a tab the
 *    developer happens to have open cannot reach the database through here.
 * 3. **Read only, and proved so.** `readOnly()` accepts one statement, of
 *    one of SELECT, WITH ... SELECT, EXPLAIN, SHOW and DESCRIBE, once its
 *    strings and comments are removed, and refuses it if a single word that
 *    writes, locks, waits or reaches the file system survives that removal.
 *    A refusal names the rule and the word that broke it. Values travel as
 *    parameters, never spliced into the text. No endpoint here writes
 *    anything, so there is nothing to opt into: `DELETE FROM users` is not
 *    discouraged, it is refused.
 * 4. **Nothing leaves unredacted.** Log lines are redacted as they are
 *    recorded, not as they are read (`config.filterParameters`, so
 *    `password`, `token`, `secret` and `authorization` unless the
 *    application says otherwise), urls lose the values of their filtered
 *    query parameters, and rows -- from a query or from a model -- are
 *    redacted on the way out with `password` masked whatever the
 *    configuration says.
 * 5. **Every answer is bounded, and says by how much.** `LIMITS` holds the
 *    caps: 500 log lines, 25 errors, 100 rows, 25 records, 2000 characters
 *    per line, 40 stack frames. Anything cut carries `truncated: true` and
 *    the limit that cut it.
 */

/** Where the router is mounted */
const PATH = '/_henri/runtime';

/** The header a caller must send (and a browser cannot forge cross-origin) */
const HEADER = 'x-henri-runtime';

/**
 * Headers a browser attaches and a command line does not. `Sec-Fetch-Mode`
 * is deliberately absent: node's own `fetch` sets it (`cors`), and it is
 * the client every agent uses to reach these endpoints.
 */
const BROWSER = ['origin', 'sec-fetch-site'];

/** Everything this module bounds */
const LIMITS = Object.freeze({
  /** Kept errors */
  errors: 25,
  /** Kept log lines */
  logs: 500,
  /** Characters of one recorded line or message */
  message: 2000,
  /** Records one page of a model may hold */
  perPage: 25,
  /** Rows one query may answer */
  rows: 100,
  /** Characters of a query */
  sql: 4000,
  /** Frames of a stack */
  stack: 40,
});

/** The statements a query may start with */
const ALLOWED = ['select', 'with', 'explain', 'show', 'describe', 'desc'];

/**
 * The words that make a statement something other than a read: they write,
 * change the schema, change the session, lock, wait or reach outside the
 * database. Any of them surviving the removal of the strings and the
 * comments refuses the query.
 */
const KEYWORDS = [
  'alter',
  'analyze',
  'attach',
  'begin',
  'benchmark',
  'call',
  'commit',
  'copy',
  'create',
  'dbms_pipe',
  'delete',
  'detach',
  'do',
  'drop',
  'dumpfile',
  'exec',
  'execute',
  'grant',
  'insert',
  'into',
  'load_file',
  'lock',
  'lo_export',
  'lo_import',
  'merge',
  'openrowset',
  'outfile',
  'pg_read_file',
  'pg_sleep',
  'pg_write',
  'pragma',
  'reindex',
  'rename',
  'replace',
  'revoke',
  'rollback',
  'savepoint',
  'set',
  'shutdown',
  'sleep',
  'truncate',
  'update',
  'upsert',
  'vacuum',
  'waitfor',
  'xp_cmdshell',
];

/** A field name a `where` may carry */
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Strings and comments, in the order they must be removed */
const NOISE =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\//g;

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** Request headers worth keeping with an error */
const KEPT_HEADERS = [
  'accept',
  'content-type',
  'referer',
  'user-agent',
  'x-request-id',
];

/**
 * A value bounded to `LIMITS.message` characters, saying so when it was cut
 *
 * @param {string} text the text
 * @param {number} [max=LIMITS.message] the cap
 * @returns {string} the text, at most `max` characters
 */
function bound(text, max = LIMITS.message) {
  const value = String(text);

  return value.length > max
    ? `${value.slice(0, max)}... [${value.length - max} more characters]`
    : value;
}

/**
 * A copy of a value with the filtered keys masked and `password` masked
 * whatever the configuration says
 *
 * @param {*} value anything
 * @param {{filters: Array<string>, keys: Set<string>}} redaction what to mask
 * @returns {*} the redacted copy
 */
function scrub(value, { filters, keys }) {
  const all = filters.includes('password')
    ? filters
    : filters.concat(['password']);

  return redact(value, all, { keys });
}

/**
 * The filters of an instance (`config.filterParameters`, before the config
 * module exists too: pen writes lines during the boot)
 *
 * @param {Henri} henri the henri instance
 * @returns {Array<string>} the filters
 */
function filtersOf(henri) {
  return filterParameters(henri && henri.config);
}

/**
 * What an instance masks: the substring filters of the configuration, and
 * the fields its models marked personal, matched exactly
 * (`base/privacy.js`)
 *
 * @param {Henri} henri the henri instance
 * @returns {{filters: Array<string>, keys: Set<string>}} what to mask
 */
function redactionOf(henri) {
  return {
    filters: filtersOf(henri),
    keys: (henri && henri.privacy && henri.privacy.keys) || new Set(),
  };
}

/**
 * One argument of a log line, as text: objects are inspected once redacted,
 * strings lose their colours and their filtered query values
 *
 * @param {*} value the argument
 * @param {{filters: Array<string>, keys: Set<string>}} redaction what to mask
 * @returns {string} the text
 */
function line(value, redaction) {
  if (value instanceof Error) {
    return value.message;
  }

  if (typeof value === 'string') {
    return redactUrl(
      value.replace(ANSI, ''),
      redaction.filters,
      redaction.keys
    );
  }

  if (value === null || typeof value !== 'object') {
    return String(value);
  }

  return util.inspect(scrub(value, redaction), {
    breakLength: Infinity,
    colors: false,
    depth: 3,
  });
}

/**
 * A stack, bounded to `LIMITS.stack` frames
 *
 * @param {Error} error the error
 * @returns {string} the stack
 */
function frames(error) {
  const stack = String((error && error.stack) || '').split('\n');

  return stack.length > LIMITS.stack
    ? `${stack.slice(0, LIMITS.stack).join('\n')}\n    ... ${
        stack.length - LIMITS.stack
      } more frames`
    : stack.join('\n');
}

/**
 * What is worth keeping of the request an error happened in
 *
 * @param {Express.Request} req the request
 * @param {{filters: Array<string>, keys: Set<string>}} redaction what to mask
 * @returns {?object} the request, redacted
 */
function requested(req, redaction) {
  if (!req) {
    return null;
  }

  const headers = {};

  for (const name of KEPT_HEADERS) {
    const value = typeof req.get === 'function' ? req.get(name) : null;

    if (value) {
      headers[name] = bound(value, 200);
    }
  }

  const route = req.res && req.res.locals && req.res.locals.route;
  const user = req.user;

  return {
    body: scrub(req.body || {}, redaction),
    controller:
      (route && route.controller && `${route.controller}#${route.action}`) ||
      null,
    headers,
    method: req.method,
    params: scrub(req.params || {}, redaction),
    query: scrub(req.query || {}, redaction),
    url: redactUrl(
      req.originalUrl || req.url || '',
      redaction.filters,
      redaction.keys
    ),
    user: user
      ? { id: String(user.id || user._id || ''), roles: user.roles || null }
      : null,
  };
}

/**
 * The ring buffers of one henri instance: the lines pen wrote and the
 * errors the http stack answered with, both already redacted
 *
 * @class Recorder
 */
class Recorder {
  /**
   * @param {Henri} henri the instance it belongs to
   * @memberof Recorder
   */
  constructor(henri) {
    this.henri = henri;
    this.logs = [];
    this.errors = [];
    this.seen = { errors: 0, logs: 0 };
  }

  /**
   * Record one log line, redacted
   *
   * @param {string} name the module that wrote it
   * @param {string} level error, warn, info, verbose, debug or silly
   * @param {Array<*>} args what pen was given
   * @returns {object} the recorded line
   * @memberof Recorder
   */
  log(name, level, args) {
    const redaction = redactionOf(this.henri);
    const entry = {
      at: new Date().toISOString(),
      level,
      // ` => ` is pen's own separator: a recorded line reads like the
      // printed one, minus the colours
      message: bound(args.map((arg) => line(arg, redaction)).join(' => ')),
      name: String(name).trim(),
      requestId: currentRequestId(),
    };

    this.seen.logs++;
    this.logs.push(entry);

    if (this.logs.length > LIMITS.logs) {
      this.logs.splice(0, this.logs.length - LIMITS.logs);
    }

    return entry;
  }

  /**
   * Record one error and the request that caused it, redacted
   *
   * @param {Error} error the error
   * @param {object} [context={}] `{ req, status }`
   * @returns {object} the recorded error
   * @memberof Recorder
   */
  error(error, { req = null, status = 500 } = {}) {
    const redaction = redactionOf(this.henri);
    const entry = {
      at: new Date().toISOString(),
      message: bound(String((error && error.message) || error)),
      name: (error && error.name) || 'Error',
      request: requested(req, redaction),
      requestId: (req && req.id) || currentRequestId(),
      stack: frames(error),
      status,
    };

    this.seen.errors++;
    this.errors.push(entry);

    if (this.errors.length > LIMITS.errors) {
      this.errors.splice(0, this.errors.length - LIMITS.errors);
    }

    return entry;
  }
}

/**
 * The recorder of an instance, created on first use
 *
 * Production has none: nothing is kept in memory, so there is nothing to
 * answer with and nothing to leak.
 *
 * @param {Henri} henri the henri instance
 * @returns {?Recorder} the recorder, or null in production
 */
function recorder(henri) {
  if (!henri || henri.isProduction) {
    return null;
  }

  if (!henri._runtime) {
    Object.defineProperty(henri, '_runtime', {
      configurable: true,
      value: new Recorder(henri),
      writable: true,
    });
  }

  return henri._runtime;
}

/**
 * Is a statement a read this module will run?
 *
 * The strings and the comments are removed first, so nothing hides in them,
 * and the answer names the rule that refused it.
 *
 * @param {string} sql the statement
 * @returns {{ok: boolean, code: ?string, reason: ?string}} the verdict
 */
function readOnly(sql) {
  const refused = (code, reason) => ({ code, ok: false, reason });
  const text = typeof sql === 'string' ? sql.trim() : '';

  if (text === '') {
    return refused('EMPTY', 'there is no statement to run');
  }

  if (text.length > LIMITS.sql) {
    return refused(
      'TOO_LONG',
      `a statement is at most ${LIMITS.sql} characters, this one is ${text.length}`
    );
  }

  // Strings become a placeholder carrying no quote of its own, so what is
  // left is the shape of the statement and nothing a value could hide in
  const stripped = text.replace(NOISE, (match) =>
    match[0] === '-' || match[0] === '/' ? ' ' : ' ? '
  );

  if (/['"`]/.test(stripped)) {
    return refused(
      'UNTERMINATED',
      'the statement carries a quote that is never closed, so what it hides cannot be checked'
    );
  }

  const statements = stripped
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

  if (statements.length > 1) {
    return refused(
      'MULTIPLE',
      `one statement at a time: ${statements.length} were given`
    );
  }

  // Nothing but comments, semicolons or a bare string
  if (statements.length === 0) {
    return refused('EMPTY', 'there is no statement to run');
  }

  const [statement] = statements;
  const first = (statement.match(/[A-Za-z_]+/) || [''])[0].toLowerCase();

  if (!ALLOWED.includes(first)) {
    return refused(
      'NOT_A_READ',
      `only ${ALLOWED.join(', ').toUpperCase()} are allowed, this one starts with ${first.toUpperCase() || 'nothing readable'}`
    );
  }

  const found = KEYWORDS.find((word) =>
    new RegExp(`\\b${word}\\b`, 'i').test(statement)
  );

  if (found) {
    return refused(
      'WRITES',
      `the statement carries "${found.toUpperCase()}", which does not read: this endpoint runs reads only`
    );
  }

  if (first === 'with' && !/\bselect\b/i.test(statement)) {
    return refused('NOT_A_READ', 'a WITH must end in a SELECT');
  }

  return { code: null, ok: true, reason: null };
}

/**
 * The rows of a query, whatever the adapter answered with (Sequelize hands
 * back `[rows, metadata]`, Drizzle the rows)
 *
 * @param {*} answer what `adapter.query()` resolved with
 * @returns {Array<object>} the rows
 */
function rowsOf(answer) {
  if (!Array.isArray(answer)) {
    return answer && typeof answer === 'object' ? [answer] : [];
  }

  return Array.isArray(answer[0]) ? answer[0] : answer;
}

/**
 * A record as a plain object, redacted, without its password
 *
 * @param {*} record a model instance
 * @param {{filters: Array<string>, keys: Set<string>}} redaction what to mask
 * @returns {?object} the record
 */
function plain(record, redaction) {
  if (record === null || typeof record === 'undefined') {
    return null;
  }

  const value =
    typeof record.toJSON === 'function'
      ? record.toJSON()
      : Object.assign({}, record);

  return scrub(value, redaction);
}

/**
 * A `where` an agent may hand to a model: a flat object of equalities on
 * real field names. Operators (`$ne`, `$where`, Sequelize's symbols) and
 * nested objects are refused, so nothing is smuggled into the query.
 *
 * @param {*} where what the caller sent
 * @returns {{ok: boolean, reason: ?string, value: object}} the verdict
 */
function condition(where) {
  if (where === null || typeof where === 'undefined') {
    return { ok: true, reason: null, value: {} };
  }

  if (typeof where !== 'object' || Array.isArray(where)) {
    return {
      ok: false,
      reason: 'where must be an object of field: value',
      value: {},
    };
  }

  for (const [field, value] of Object.entries(where)) {
    if (!FIELD.test(field)) {
      return {
        ok: false,
        reason: `"${field}" is not a field name: only plain equalities are allowed here, no operators`,
        value: {},
      };
    }

    if (value !== null && ['object', 'function'].includes(typeof value)) {
      return {
        ok: false,
        reason: `the value of "${field}" must be a string, a number, a boolean or null`,
        value: {},
      };
    }
  }

  return { ok: true, reason: null, value: where };
}

/**
 * A positive integer, bounded
 *
 * @param {*} value anything
 * @param {number} fallback used when the value is not a positive integer
 * @param {number} max the cap
 * @returns {number} the number
 */
function count(value, fallback, max) {
  const number = parseInt(value, 10);

  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }

  return Math.min(number, max);
}

/**
 * Only this machine, and never a browser
 *
 * @returns {function} express middleware
 */
function guard() {
  return (req, res, next) => {
    const browser = BROWSER.find((name) => req.get(name));

    if (browser) {
      return res.status(403).json({
        error: {
          code: 'BROWSER',
          message: `the runtime endpoints refuse a request carrying "${browser}": they answer command line tools only`,
        },
      });
    }

    if (req.get(HEADER) !== '1') {
      return res.status(403).json({
        error: {
          code: 'HEADER',
          message: `send "${HEADER}: 1" to reach the runtime endpoints`,
        },
      });
    }

    res.set('Cache-Control', 'no-store');

    return next();
  };
}

/**
 * What the application is, and what it can be asked
 *
 * @param {Henri} henri the henri instance
 * @returns {object} the identity
 */
function identity(henri) {
  const { model, server } = henri;
  const stores = (model && model.stores) || {};
  const rec = recorder(henri);

  return {
    app: {
      cwd: henri.cwd(),
      env: henri.env || 'dev',
      node: process.version,
      pid: process.pid,
      port: (server && server.port) || null,
      release: henri.release,
      runlevel: henri.runlevel,
      uptime: Math.round(process.uptime()),
      url: (server && server.url) || null,
    },
    filterParameters: filtersOf(henri),
    limits: LIMITS,
    models: ((model && model.models) || []).map((entry) => ({
      identity: entry.identity,
      name: entry.globalId,
      store: entry.store || 'default',
    })),
    recorded: rec ? rec.seen : { errors: 0, logs: 0 },
    renderer: (henri.view && henri.view.renderer) || null,
    stores: Object.fromEntries(
      Object.keys(stores).map((name) => [
        name,
        {
          adapter: stores[name].adapterName || null,
          queryable: typeof stores[name].query === 'function',
        },
      ])
    ),
  };
}

/**
 * The routes the router registered, which is not always what the file says:
 * a route whose controller or action is missing is `active: false`, the
 * hooks that run ahead of it are counted, and the endpoints henri mounts
 * itself are listed apart.
 *
 * @param {Henri} henri the henri instance
 * @returns {object} the table
 */
function routes(henri) {
  const router = henri.router || {};
  const table = router.routes || {};
  const active = router.activeRoutes || new Map();
  const helpers = router._paths || {};
  const named = {};

  for (const [helper, entry] of Object.entries(helpers)) {
    named[`${entry.method} ${entry.route}`] = helper;
  }

  const all = Object.keys(table).map((key) => {
    const route = table[key];
    const state = active.get(key) || {};
    const [controller, action] = String(route.controller || '').split('#');
    const hooks =
      henri.controllers && typeof henri.controllers.hooks === 'function'
        ? henri.controllers.hooks(route.controller).length
        : 0;

    return {
      action: action || null,
      active: state.active === true,
      controller: controller || null,
      helper: named[key] || null,
      hooks,
      idempotent: state.idempotent !== false,
      resource: state.resource === true,
      roles: route.roles ? [].concat(route.roles) : null,
      route: route.route,
      verb: route.verb,
      version: state.version || null,
    };
  });

  const internal = ['GET /_henri/health', `GET ${PATH}`];

  if (henri.isDev) {
    internal.push('GET /_routes', 'GET /_controllers');

    if (henri.mailers && henri.mailers.previewable) {
      internal.push('GET /_mailers');
    }
  }

  if (henri.graphql && henri.config.has('graphql')) {
    internal.push(`ALL ${henri.config.get('graphql')}`);
  }

  return {
    count: all.length,
    inactive: all.filter((route) => !route.active).length,
    internal,
    routes: all,
  };
}

/**
 * Read a page of a model, or one record, through the model itself: the
 * adapter's own protections hold, so a hidden password stays hidden and a
 * soft deleted row stays deleted
 *
 * @param {Henri} henri the henri instance
 * @param {object} body `{ model, id, where, page, perPage }`
 * @returns {Promise<object>} the answer, or `{ error }`
 */
async function records(henri, body = {}) {
  const { model } = henri;
  const wanted = String(body.model || '');
  const definition = ((model && model.models) || []).find(
    (entry) =>
      entry.globalId === wanted ||
      String(entry.identity).toLowerCase() === wanted.toLowerCase()
  );

  if (!definition) {
    return {
      error: {
        code: 'UNKNOWN_MODEL',
        known: ((model && model.models) || []).map((entry) => entry.globalId),
        message: `there is no model named "${wanted}" in this application`,
      },
    };
  }

  const store = (model.stores || {})[definition.store || 'default'];
  const Model =
    (store && store.getModels && store.getModels()[definition.globalId]) ||
    global[definition.globalId];

  if (!Model) {
    return {
      error: {
        code: 'NOT_STARTED',
        message: `${definition.globalId} is declared but its store did not start`,
      },
    };
  }

  const redaction = redactionOf(henri);

  if (typeof body.id !== 'undefined' && body.id !== null) {
    const found = await Model.findById(body.id);

    return {
      model: definition.globalId,
      record: plain(found, redaction),
      store: definition.store || 'default',
    };
  }

  const where = condition(body.where);

  if (!where.ok) {
    return { error: { code: 'REFUSED', message: where.reason } };
  }

  const page = count(body.page, 1, Number.MAX_SAFE_INTEGER);
  const perPage = count(body.perPage, LIMITS.perPage, LIMITS.perPage);
  const answer = await Model.paginate({
    page,
    perPage,
    where: where.value,
  });

  return {
    model: definition.globalId,
    page: answer.page,
    pages: answer.pages,
    perPage: answer.perPage,
    records: (answer.records || []).map((record) => plain(record, redaction)),
    store: definition.store || 'default',
    total: answer.total,
    truncated: (answer.records || []).length < answer.total,
  };
}

/**
 * Run one read through a store's adapter
 *
 * @param {Henri} henri the henri instance
 * @param {object} body `{ store, sql, params, limit }`
 * @returns {Promise<object>} the rows, or `{ error }`
 */
async function query(henri, body = {}) {
  // What the statement is comes first: a write is refused whether or not
  // the store it named exists, so the answer is always about the rule
  const verdict = readOnly(body.sql);

  if (!verdict.ok) {
    return {
      error: {
        code: 'REFUSED',
        message: `refused: ${verdict.reason}`,
        refused: bound(String(body.sql || ''), 400),
        rule: verdict.code,
      },
    };
  }

  const name = String(body.store || 'default');
  const store = ((henri.model && henri.model.stores) || {})[name];

  if (!store) {
    return {
      error: {
        code: 'UNKNOWN_STORE',
        known: Object.keys((henri.model && henri.model.stores) || {}),
        message: `there is no store named "${name}" in this application`,
      },
    };
  }

  if (typeof store.query !== 'function') {
    return {
      error: {
        code: 'NO_QUERY',
        message: `the ${store.adapterName} adapter has no query(): it is not a SQL store, read it through its models instead`,
      },
    };
  }

  const params = Array.isArray(body.params) ? body.params : [];
  const bad = params.find(
    (value) => value !== null && ['object', 'function'].includes(typeof value)
  );

  if (typeof bad !== 'undefined') {
    return {
      error: {
        code: 'REFUSED',
        message:
          'every parameter must be a string, a number, a boolean or null',
        rule: 'PARAMS',
      },
    };
  }

  const limit = count(body.limit, LIMITS.rows, LIMITS.rows);
  const started = Date.now();
  let answered;

  try {
    answered = await store.query(body.sql, params, { type: 'SELECT' });
  } catch (error) {
    return {
      error: {
        code: 'FAILED',
        message: bound(error.message),
        rule: null,
      },
    };
  }

  const found = rowsOf(answered);
  const redaction = redactionOf(henri);

  return {
    adapter: store.adapterName,
    count: Math.min(found.length, limit),
    limit,
    ms: Date.now() - started,
    rows: found.slice(0, limit).map((row) => scrub(row, redaction)),
    store: name,
    truncated: found.length > limit,
  };
}

/**
 * Answer what a handler resolved with: 422 when it refused, 200 when it did
 * the work, and the failure itself when it threw
 *
 * @param {Express.Response} res the response
 * @param {Promise<object>} work what the handler is doing
 * @returns {Promise<void>} resolves once answered
 */
async function answered(res, work) {
  let answer;

  try {
    answer = await work;
  } catch (error) {
    answer = { error: { code: 'FAILED', message: bound(error.message) } };
  }

  res.status(answer.error ? 422 : 200).json(answer);
}

/**
 * The runtime router, mounted on `/_henri/runtime` in development
 *
 * @param {Henri} henri the henri instance
 * @returns {Express.Router} the router
 */
function runtime(henri) {
  const router = henri.server.express.Router();

  router.use(guard());

  // `5.router.js` mounts this outside production only; if anything ever
  // mounts it there, it says what it will not do rather than half doing it
  router.use((req, res, next) =>
    recorder(henri)
      ? next()
      : res.status(404).json({
          error: {
            code: 'PRODUCTION',
            message:
              'the runtime endpoints do not exist in production: nothing is recorded and nothing is answered',
          },
        })
  );

  router.get('/', (req, res) => res.json(identity(henri)));

  router.get('/logs', (req, res) => {
    const rec = recorder(henri);
    const limit = count(req.query.limit, 100, LIMITS.logs);
    const levels = String(req.query.level || '')
      .split(',')
      .map((level) => level.trim().toLowerCase())
      .filter(Boolean);
    const contains = String(req.query.contains || '').toLowerCase();
    const requestId = String(req.query.requestId || '');
    const all = rec.logs.filter(
      (entry) =>
        (levels.length === 0 || levels.includes(entry.level)) &&
        (contains === '' || entry.message.toLowerCase().includes(contains)) &&
        (requestId === '' || entry.requestId === requestId)
    );

    return res.json({
      count: Math.min(all.length, limit),
      kept: LIMITS.logs,
      limit,
      lines: all.slice(-limit),
      matched: all.length,
      seen: rec.seen.logs,
      truncated: all.length > limit,
    });
  });

  router.get('/errors', (req, res) => {
    const rec = recorder(henri);
    const limit = count(req.query.limit, 5, LIMITS.errors);
    const requestId = String(req.query.requestId || '');
    const all = rec.errors.filter(
      (entry) => requestId === '' || entry.requestId === requestId
    );

    return res.json({
      count: Math.min(all.length, limit),
      errors: all.slice(-limit).reverse(),
      kept: LIMITS.errors,
      limit,
      matched: all.length,
      seen: rec.seen.errors,
      truncated: all.length > limit,
    });
  });

  router.get('/routes', (req, res) => res.json(routes(henri)));

  router.post('/query', (req, res) => answered(res, query(henri, req.body)));

  router.post('/records', (req, res) =>
    answered(res, records(henri, req.body))
  );

  return router;
}

module.exports = runtime;
module.exports.HEADER = HEADER;
module.exports.KEYWORDS = KEYWORDS;
module.exports.LIMITS = LIMITS;
module.exports.PATH = PATH;
module.exports.condition = condition;
module.exports.guard = guard;
module.exports.identity = identity;
module.exports.query = query;
module.exports.readOnly = readOnly;
module.exports.recorder = recorder;
module.exports.records = records;
module.exports.rowsOf = rowsOf;
module.exports.routes = routes;
module.exports.scrub = scrub;
