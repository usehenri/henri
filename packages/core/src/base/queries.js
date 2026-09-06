/**
 * The query seam: every adapter says what it ran, and the N+1 that follows.
 *
 * henri has `include()` and a guide that says to use it, and nothing that
 * *tells* you when you did not. The reason nobody outside henri could write
 * that check either is more basic: **no adapter emitted anything when it ran
 * a query**, so there was nothing to listen to. This file is the seam first
 * and the detector second, because that is the order the dependency runs in.
 *
 * ## The seam is at the model call, and that is the whole design
 *
 * There were two levels to choose between and they are not close, once the
 * adapters are measured rather than imagined:
 *
 * - **The statement.** What the driver ran. `sequelize.query()`, drizzle's
 *   `session.prepareQuery()`, the MongoDB command. Precise, and the number a
 *   `EXPLAIN` would agree with.
 * - **The model call.** What the application asked for. `Proposal.findById`,
 *   `Track.where(...)`, `User.paginate()`.
 *
 * henri emits the **model call**, for three reasons that all point the same
 * way.
 *
 * First, it is the only level at which henri can give *advice*, which is the
 * entire value of this feature. A driver instrumentation can already tell an
 * application that forty statements ran -- `@opentelemetry/instrumentation-pg`
 * does it better than henri would. Only henri knows that those forty
 * statements were forty `Proposal.findById` calls in one request and that one
 * `Proposal.find({ id: [...] })` replaces them. A count is a complaint; a
 * count naming the call and the line is a fix.
 *
 * Second, the statement count is not the number the developer can act on.
 * `paginate()` is two statements and one decision. On MySQL an insert is two
 * statements and one decision, because the dialect has no `RETURNING`. A
 * threshold counting statements would report those as repetition and would
 * make the dialect visible in a warning about the application's code.
 *
 * Third -- and this is the measurement that settled it -- **the classic Rails
 * N+1 does not exist on the Drizzle adapter.** `include()` compiles to a
 * single correlated json subquery, not to a lazy association that a loop can
 * trip over. A detector written to `bullet`'s mental model would walk a
 * Drizzle application, find no lazy association anywhere, and report success.
 * What is left, and what is worth detecting on all three adapters, is a loop
 * issuing separate `find`/`findById` calls for records it could have loaded
 * together. That is a count of model calls. There is no statement-level
 * reading of it.
 *
 * So, stated once and plainly, because a person reading "40 queries" will
 * assume the other thing: **the threshold counts model calls, never
 * statements.** `henri.queries` is a log of what the application asked for.
 *
 * ## What this is not: it is not tracing, and it does not become tracing
 *
 * `base/telemetry.js` says a model call is not one of its boundaries and
 * points at `@opentelemetry/instrumentation-pg` or the ORM's own package
 * instead. That sentence stands, and this seam does not overturn it. The line
 * is:
 *
 * - **Statements are the driver's instrumentation to trace.** henri
 *   re-implementing it would double-count against an application that
 *   installed one, and henri would be the worse of the two.
 * - **`adapter.query()` is henri's own call**, and `3.model.js` gives it a
 *   span. It also emits an event here, with `operation: 'raw'`, because a
 *   seam that says what the adapter ran cannot leave out the one call henri
 *   makes itself. Those are not a double count: one span goes to a trace
 *   backend, one event goes to the detector, and **telemetry does not consume
 *   this seam** -- there is no path where a model call becomes a span.
 * - **Model calls are henri's to count**, for the detector, in development.
 *
 * ## What the event carries, and what it deliberately does not
 *
 *     { at, store, adapter, dialect, model, operation, method, keys,
 *       shape, duration, rows, requestId, source, callsite }
 *
 * `operation` is one closed vocabulary across the three adapters
 * (`OPERATIONS`), so `select` means the same thing on MongoDB and on
 * PostgreSQL. `method` is the adapter's own word -- `findOne`, `paginate`,
 * `BULKUPDATE` -- because that is the word the developer will search their
 * own code for. Both are names.
 *
 * **The event does not carry the SQL, and at this level there is no SQL to
 * carry.** That is the happy half of the decision: the level that gives the
 * useful advice is also the level at which the dangerous field does not
 * exist. A model call has a model, an operation and a filter; the statement
 * is compiled after henri has already emitted.
 *
 * The unhappy half is why it would have been refused anyway, and it is worth
 * recording because the next person will be tempted. **Sequelize's query
 * generator interpolates values into the text it runs.**
 * `Model.findAll({ where: { name: 'ada' } })` reaches the driver as
 * `SELECT ... WHERE "U"."name" = 'ada'`, with the value inside the string;
 * that is the ordinary path, not an edge case. Drizzle's statements are
 * parameterized and Mongoose has no statement at all. So a `sql` field would
 * have been safe on two adapters and a copy of the row on the third -- which
 * is worse than no field, because it is the leak nobody would think to look
 * for. henri has spent this month keeping values out of the trail, the logs,
 * the reporter and the spans; a query event is not where that stops.
 *
 * `keys` is the same rule's safe half: **column names, never values.**
 * `base/trail.js` established that a field name is schema -- it is in the
 * model file and in the documentation -- while a field value is personal
 * data. Every adapter hands over the keys of the filter it was given and
 * drops what they were compared against, before an event exists. Where an
 * adapter cannot produce them cheaply, `keys` is empty rather than guessed.
 *
 * Not on the event, on any adapter: the filter values, the bound parameters,
 * the rows that came back, the attributes written, the person, the url, the
 * path, the headers, the session.
 *
 * ## `callsite`, which is code and not data
 *
 * bullet's value was never that it counted queries. It is that it says *this*
 * page ran the same query forty times **and names the line**.
 *
 * So an event carries one frame: the first frame belonging to the
 * application's own files -- not `node_modules`, not henri, not node
 * internals. A stack frame is source the developer wrote, the one class of
 * context here that cannot turn out to be data.
 *
 * It is not free, so it is not always taken. Capturing costs an `Error`
 * allocation per model call; V8 only formats the string when `.stack` is
 * read, which this file defers until a shape is actually reported.
 * `queries.callsites` follows the detector by default and can be turned off
 * on its own.
 *
 * ## The join is the request id, and there is only one
 *
 * An event carries `requestId` from `base/request-id.js` -- the same
 * AsyncLocalStorage the call log keys its rows by and the same id a span
 * carries as `henri.request_id`. That is the whole join, on purpose: a query
 * event, a call-log row, a `pen` line and a span all answer to one
 * identifier, so "what did request X do" is one filter in four places rather
 * than four questions.
 *
 * It carries **no trace id**. `base/telemetry.js` argues the direction
 * already -- a trace usually spans several requests, so a trace id is not
 * unique per request -- and the converse would be a second identifier to keep
 * in step for nothing.
 *
 * ## What "off" costs, and why it is zero rather than cheap
 *
 * Off means nothing is installed, the way `base/calls.js` and
 * `base/telemetry.js` mean it: `henri.queries.enabled` is read **once**, by
 * each adapter, at the moment it builds its models. A disabled seam leaves
 * Sequelize's hooks unregistered, drizzle's model class unwrapped, no
 * Mongoose middleware added, no middleware in the express stack and no object
 * allocated per query. There is no flag tested on the hot path, because there
 * is no hot path to test it on.
 *
 * Enabled, it is on by default in development and in test and off in
 * production, which is `bullet`'s bargain and the right one: production
 * traffic should not pay to tell a developer something the developer is not
 * there to read. An application that wants it in production says so.
 *
 * ## The detector: a shape, not a string
 *
 * "The same query" cannot be a string comparison, because the values differ
 * -- forty lookups of forty different ids are the N+1, and forty *identical*
 * lookups would be a caching bug instead. So the detector groups by `shape`:
 * a digest of (adapter, model, operation, the filter's key names). Forty
 * `Track.findById` are one shape with a count of forty; a page's own `find`
 * and its `count` are two shapes with a count of one each and are never
 * reported.
 *
 * The shape is deliberately **not** salted and **not** given the callsite.
 * Unsalted, because a shape in a log line is only useful if it means the same
 * thing in the next process and in a developer's grep, and it hashes only
 * names so there is nothing to salt against. Without the callsite, because
 * the same logical N+1 called from two lines is one problem, and a shape that
 * split it would report it twice; the callsite of the *first* occurrence is
 * carried on the finding instead, which is what names the line.
 *
 * A shape is counted **within one request** and nowhere else. The bucket
 * hangs off the request-id store, so it is born and collected with the
 * request, and a background job's queries are never pooled with a page's.
 * Outside a request -- a job, a console, the boot -- events are emitted and
 * nothing is counted, because "the same request" is the whole predicate and
 * there is no honest substitute for it.
 *
 * @module base/queries
 */

const crypto = require('crypto');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const { fail } = require('./errors');
const { context, currentRequestId } = require('./request-id');

/**
 * Whether a model call is already being measured.
 *
 * The three adapters all have layers: `Model.findById()` calls
 * `Model.relation().first()`, `paginate()` runs a page and a count, and a
 * Sequelize `findByPk` is a `findOne` is a `findAll`. Instrumenting every
 * layer would count one decision three times and would report `toArray` where
 * the developer wrote `findById`.
 *
 * So the **outermost call wins**: the first wrapper to run opens this
 * context, every wrapper inside it does nothing but call through, and the
 * event carries the name the application actually used. It is an
 * AsyncLocalStorage rather than a counter because the inner call is often
 * awaited rather than nested on the stack.
 *
 * The known cost, said out loud: a model call made from inside a model hook
 * -- an `afterFind` that loads something -- is part of the outer call and
 * gets no event of its own.
 */
const nesting = new AsyncLocalStorage();

/**
 * The one vocabulary the three adapters answer in.
 *
 * `raw` is `adapter.query()` and anything an application ran itself; `other`
 * is a call henri recognises but that is none of the five verbs (a MongoDB
 * aggregation, a `distinct`).
 */
const OPERATIONS = Object.freeze([
  'count',
  'delete',
  'insert',
  'other',
  'raw',
  'select',
  'update',
]);

/** Who asked: henri on its own behalf, or the application */
const SOURCES = Object.freeze(['application', 'henri']);

/** How many characters of the digest an event carries */
const SHAPE = 12;

/** How deep a stack is walked looking for the application's own frame */
const FRAMES = 12;

/** What the detector treats as "the same call, again" unless told otherwise */
const THRESHOLD = 5;

/** How many filter keys reach an event; a filter is a shape, not a document */
const KEYS = 12;

/**
 * The normalized configuration of a seam nobody configured.
 *
 * `enabled` is absent on purpose: only `queriesConfig()` knows the
 * environment, and a default that reads `NODE_ENV` at require time is a
 * default that is wrong in a test.
 */
const DEFAULTS = Object.freeze({
  callsites: true,
  detect: Object.freeze({
    header: true,
    ignore: Object.freeze([]),
    log: true,
    raise: false,
    threshold: THRESHOLD,
  }),
});

/**
 * Normalizes `config.queries`.
 *
 * The default is on in development and in test and off in production, so an
 * application that says nothing gets the detector where a developer is
 * watching and pays nothing where nobody is. `false` is off everywhere and
 * `{ "enabled": true }` is the production opt-in.
 *
 * @param {?object} config The henri configuration module, or null
 * @param {boolean} [production=false] Whether this is a production boot
 * @returns {object} `{ enabled, callsites, detect }`
 */
function queriesConfig(config, production = false) {
  const given =
    config && typeof config.get === 'function' && config.has('queries')
      ? config.get('queries')
      : undefined;

  if (given === false) {
    return { callsites: false, detect: false, enabled: false };
  }

  const settings = given && typeof given === 'object' ? given : {};
  const enabled =
    typeof settings.enabled === 'boolean' ? settings.enabled : !production;
  const wanted =
    settings.detect === false
      ? false
      : { ...DEFAULTS.detect, ...(settings.detect || {}) };
  const detect = enabled ? checkDetect(wanted) : false;

  return {
    callsites:
      typeof settings.callsites === 'boolean'
        ? settings.callsites && enabled
        : Boolean(detect),
    detect,
    enabled,
  };
}

// `Model`, `Model.operation` or `*.operation`
const IGNORE = new RegExp(
  `^(?:\\*|[A-Za-z_][A-Za-z0-9_]*)(?:\\.(?:${OPERATIONS.join('|')}))?$`,
  'u'
);

/**
 * Refuses a detector the configuration asked for and henri cannot run.
 *
 * The schema (`base/config-schema.js`) already refuses a threshold that is
 * not a whole number of at least two and an `ignore` that is not a list of
 * strings. What it cannot express is the *grammar* of an entry, so that is
 * here, and it fails the boot the way an impossible retention rule does --
 * an `ignore` line with a typo in it would otherwise silence nothing and say
 * nothing, which is the worst of both.
 *
 * @param {*} detect The normalized `queries.detect`
 * @returns {*} The same value
 * @throws {Error} `HENRI_QUERIES_INVALID_DETECT`
 */
function checkDetect(detect) {
  if (!detect) {
    return detect;
  }

  if (!Number.isInteger(detect.threshold) || detect.threshold < 2) {
    throw fail(
      'HENRI_QUERIES_INVALID_DETECT',
      `queries.detect.threshold must be a whole number of at least 2, not ${JSON.stringify(
        detect.threshold
      )}: a call that ran once is not a repetition`
    );
  }

  for (const entry of detect.ignore || []) {
    if (typeof entry !== 'string' || !IGNORE.test(entry)) {
      throw fail(
        'HENRI_QUERIES_INVALID_DETECT',
        `queries.detect.ignore takes Model, Model.operation or *.operation, not ${JSON.stringify(
          entry
        )} (an operation is one of ${OPERATIONS.join(', ')})`
      );
    }
  }

  return detect;
}

/**
 * The key names of a filter, and never what they were compared against.
 *
 * Every adapter hands its filter here before an event exists, so this is the
 * one place the values are dropped. It walks the boolean combinators the
 * three query languages share (`$and`/`$or` on Mongoose, `Op.and`/`Op.or` on
 * Sequelize) and keeps the leaf names; anything else contributes its own key
 * and nothing below it.
 *
 * A key whose name begins with `$` is an operator, not a column, and is
 * dropped: `{ age: { $gt: 30 } }` is `['age']`.
 *
 * @param {*} filter The filter as the model was given it
 * @param {number} [limit=KEYS] How many names to keep
 * @returns {Array<string>} The names, sorted and deduplicated
 */
function keysOf(filter, limit = KEYS) {
  const found = new Set();

  /**
   * Walks one level of a filter
   *
   * @param {*} value What to walk
   * @param {number} depth How deep we already are
   * @returns {void}
   */
  const walk = (value, depth) => {
    if (
      !value ||
      typeof value !== 'object' ||
      depth > 4 ||
      found.size >= limit
    ) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, depth + 1);
      }

      return;
    }

    // Symbol keys are Sequelize's operators (Op.and, Op.or): they name no
    // column, so only what is under them counts
    for (const key of Object.getOwnPropertySymbols(value)) {
      walk(value[key], depth + 1);
    }

    for (const key of Object.keys(value)) {
      if (found.size >= limit) {
        return;
      }

      if (key.startsWith('$')) {
        walk(value[key], depth + 1);

        continue;
      }

      found.add(key);
    }
  };

  walk(filter, 0);

  return [...found].sort();
}

/**
 * The digest that says two model calls are the same call.
 *
 * A plain sha256 over names, with no salt: there is nothing in it a client
 * chose, and a shape is only useful in a log line if it means the same thing
 * in the next process.
 *
 * @param {object} parts `{ adapter, model, operation, keys }`
 * @returns {string} A short hex digest
 */
function shapeOf({ adapter, keys, model, operation }) {
  return crypto
    .createHash('sha256')
    .update(
      [
        adapter || '',
        model || '',
        operation || '',
        (keys || []).join(','),
      ].join(' ')
    )
    .digest('hex')
    .slice(0, SHAPE);
}

// Frames henri never blames: its own packages, the dependencies, node itself
const FOREIGN =
  /[\\/]node_modules[\\/]|^node:|[\\/]packages[\\/](?:core|drizzle|mongoose|sequelize|disk|jobs|webhooks|testing)[\\/]/u;
const FRAME = /\(?([^()\s]+):(\d+):(\d+)\)?$/u;

/**
 * The first frame that belongs to the application.
 *
 * Called with an Error whose stack has not been read yet: reading `.stack` is
 * where V8 formats the trace, which is the expensive half, so the adapters
 * capture the Error and this is what decides to pay for it.
 *
 * @param {?Error} error An Error captured where the call was made
 * @param {string} [cwd=''] The application directory, so the file is relative
 * @returns {?object} `{ file, line, column }`, or null
 */
function callsiteOf(error, cwd = '') {
  if (!error || typeof error.stack !== 'string') {
    return null;
  }

  for (const line of error.stack.split('\n').slice(1, FRAMES + 1)) {
    const match = FRAME.exec(line.trim());

    if (!match || FOREIGN.test(match[1])) {
      continue;
    }

    const file = cwd ? path.relative(cwd, match[1]) : match[1];

    // A relative path that climbed out of the application is somebody else's
    // file after all
    if (file.startsWith('..')) {
      continue;
    }

    return { column: Number(match[3]), file, line: Number(match[2]) };
  }

  return null;
}

/**
 * The bucket of the request being handled, made on the first query.
 *
 * It hangs off the store `base/request-id.js` already put in the
 * AsyncLocalStorage, next to the id and the actor: the reason those two
 * travel together applies here too, and it means a query five calls deep in a
 * service is counted against the request that caused it without anything in
 * between carrying a handle.
 *
 * @param {boolean} [make=true] Whether to create the bucket when absent
 * @returns {?Map} The shapes seen so far, or null outside a request
 */
function bucketOf(make = true) {
  const store = context.getStore();

  if (!store) {
    return null;
  }

  if (!store.queries && make) {
    store.queries = new Map();
  }

  return store.queries || null;
}

/**
 * Counts shapes within one request and says which ones repeated.
 *
 * One instance per henri, with no state of its own between requests:
 * everything it counts lives in the request's own bucket and dies with it.
 *
 * @class Detector
 */
class Detector {
  /**
   * Creates an instance of Detector.
   *
   * @param {object} [settings={}] `threshold` and `ignore`
   * @memberof Detector
   */
  constructor(settings = {}) {
    this.threshold = Number.isInteger(settings.threshold)
      ? settings.threshold
      : THRESHOLD;
    this.ignore = new Set(settings.ignore || []);
  }

  /**
   * Is this event's model and operation one the application asked to ignore?
   *
   * `Model`, `Model.operation` and `*.operation` all match, so an application
   * can silence a whole model or one verb of it.
   *
   * @param {object} event The query event
   * @returns {boolean} true when nothing should be counted
   * @memberof Detector
   */
  ignores(event) {
    if (this.ignore.size === 0) {
      return false;
    }

    const model = event.model || '*';

    return (
      this.ignore.has(model) ||
      this.ignore.has(`${model}.${event.operation}`) ||
      this.ignore.has(`*.${event.operation}`)
    );
  }

  /**
   * Counts one event against the request it happened in
   *
   * @param {object} event The query event
   * @returns {?object} The bucket entry, or null when nothing was counted
   * @memberof Detector
   */
  count(event) {
    const bucket = bucketOf();

    if (!bucket || this.ignores(event)) {
      return null;
    }

    const seen = bucket.get(event.shape);

    if (seen) {
      seen.count += 1;
      seen.duration += event.duration;

      return seen;
    }

    const entry = {
      // The first occurrence's line: the same N+1 called from two places is
      // one problem, and the first one to run is the one worth naming
      callsite: event.callsite,
      count: 1,
      duration: event.duration,
      keys: event.keys,
      method: event.method,
      model: event.model,
      operation: event.operation,
      shape: event.shape,
    };

    bucket.set(event.shape, entry);

    return entry;
  }

  /**
   * What repeated during this request, worst first
   *
   * @param {?Map} bucket The request's bucket
   * @returns {Array<object>} The findings
   * @memberof Detector
   */
  findings(bucket) {
    if (!bucket || bucket.size === 0) {
      return [];
    }

    return [...bucket.values()]
      .filter((entry) => entry.count >= this.threshold)
      .sort((one, two) => two.count - one.count);
  }
}

/**
 * What to do about a finding, in the application's own words.
 *
 * The advice has to match what the adapters actually do, which is why it does
 * **not** say "add `include()`" for a repeated lookup: on the Drizzle adapter
 * an `include()` is already one statement and there was no lazy association
 * to eager-load. What is repeating is a lookup per record, and what replaces
 * it is one lookup for the set.
 *
 * @param {object} finding One entry of `findings()`
 * @returns {string} What to change
 */
function adviseOn(finding) {
  const model = finding.model || 'the model';
  const keys = (finding.keys || []).join(', ');

  if (finding.operation === 'select' || finding.operation === 'count') {
    return keys
      ? `load them together: one ${model}.find({ ${keys}: [...] }) for the whole set, or include('${model.toLowerCase()}') on the query that fetched the parents`
      : `load them together: one ${model} query for the whole set rather than one per record`;
  }

  return `write them together: one ${model} statement for the whole set rather than one per record`;
}

/**
 * A finding, as the one line a developer reads
 *
 * @param {object} finding One entry of `findings()`
 * @returns {string} The line
 */
function describe(finding) {
  const what = `${finding.model || 'a query'}.${
    finding.method || finding.operation
  }`;
  const where = finding.callsite
    ? ` at ${finding.callsite.file}:${finding.callsite.line}`
    : '';

  return `${what} ran ${finding.count} times${where} (${finding.duration.toFixed(
    1
  )}ms) -- ${adviseOn(finding)}`;
}

/**
 * How many rows an answer holds, for the shapes the three adapters return.
 *
 * A count, not the rows: nothing here looks inside a record, and the value is
 * never kept. An answer henri does not recognise is `null` rather than a
 * guess, because a wrong row count reads as a real measurement.
 *
 * @param {*} value What the model call answered
 * @returns {?number} The count, or null when it cannot be told
 */
function rowsOf(value) {
  if (value === null || typeof value === 'undefined') {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'object') {
    // `paginate()` answers `{ records, total, ... }` on all three adapters
    if (Array.isArray(value.records)) {
      return value.records.length;
    }

    return 1;
  }

  return null;
}

/**
 * Is a model call already being measured further out?
 *
 * @returns {boolean} true when this call is a layer of another one
 */
function nested() {
  return nesting.getStore() === true;
}

/**
 * Runs something as the outermost model call
 *
 * @param {function} fn What to run
 * @returns {*} Whatever it answered
 */
function outermost(fn) {
  return nesting.run(true, fn);
}

module.exports = {
  DEFAULTS,
  Detector,
  FRAMES,
  KEYS,
  OPERATIONS,
  SHAPE,
  SOURCES,
  THRESHOLD,
  adviseOn,
  bucketOf,
  callsiteOf,
  checkDetect,
  currentRequestId,
  describe,
  keysOf,
  nested,
  outermost,
  queriesConfig,
  rowsOf,
  shapeOf,
};
