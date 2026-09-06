/**
 * What a public method may be called with.
 *
 * JavaScript is not strongly typed and TypeScript erases at runtime, so
 * henri checks its own inputs -- exhaustively at the boundaries, and it
 * trusts what is inside. Two of those boundaries were done first: the
 * configuration at boot (`config-schema.js`, `config-validate.js`) and the
 * request a controller answers (`params-schema.js`). This is the third and
 * the last one an application can reach: **every entry point it calls**.
 *
 * `henri.cache.fetch(42)`, `henri.jobs.perform(null)`, `res.collection('nope')`,
 * `henri.privacy.export()` with nobody named. Some of those already threw
 * something a person could act on; some threw a `TypeError` three frames
 * down, naming a variable of henri's rather than the mistake; and some did
 * nothing at all, so the application found out later, or never.
 *
 * ## The vocabulary, which is not a new one
 *
 * An argument is declared with the nodes of `config-schema.js`: `type`,
 * `oneOf`, `const`, `enum`, `pattern`, `min`/`max`, `integer`, `of`, `keys`,
 * `required`, `unknown`, `describe`, `hint`. `config-validate.js` walks
 * them, and `problems(node, value, key)` there is the same walk over a
 * single value -- one walker, two callers, and no second schema language.
 * The walker learned two kinds for this: `function` and `date`, which a
 * call can pass and a JSON file cannot.
 *
 * A signature is the arguments in order:
 *
 * ```js
 * 'henri.cache.set': [
 *   { by: 'HENRI_CACHE_KEY_INVALID', name: 'key' },
 *   { name: 'value', ...ANY },
 *   { name: 'options', optional: true, ...CACHE_OPTIONS },
 * ],
 * ```
 *
 * - a plain node is checked here;
 * - `optional: true` means the argument may be absent -- and `null` is not
 *   absent, which is the whole of the `options = {}` default that never
 *   applied to `null` and threw one line later;
 * - `by` names the code that already refuses it precisely, so the table
 *   stays a complete inventory of the surface without checking anything
 *   twice. `cacheKey()` says more about a bad cache key than this could.
 *
 * An options bag is declared `unknown: 'near'`: a key that is a near miss
 * of a declared one is refused and named (`{ stratgy }` -> `strategy`),
 * and anything else is left alone. That is the configuration's own answer
 * to an unknown key, for the same reason -- `{ utm_source }` is not an
 * attack -- and the near miss is the mistake people actually make.
 *
 * ## The inventory
 *
 * Roughly fifty entry points, and saying which of them already refuse well
 * is part of the work: those are in `UNCHECKED`, each with the reason, and
 * `src/__tests__/arguments.spec.js` fails when a public method is in
 * neither table.
 *
 * **Checked here.** `henri.policies` (`can`, `authorize`, `scope`, `links`,
 * `paths`), `henri.cache` (`get`, `set`, `delete`, `clear`, `scope`,
 * `fetch`), `henri.privacy` (`fields`, `strip`, `subject`, `export`,
 * `plan`, `erase`), `henri.retention` (`plan`, `sweep`), `henri.trail`
 * (`list`, `count`, `about`, `prune`), `henri.encryption` (`markOf`,
 * `encrypt`, `decrypt`, `candidates`, `tolerate`, `rotate`),
 * `henri.model.getStore`, `henri.mail.send`, `henri.reporter.report`,
 * `deliverLater`, and what a request gets: `res.resource`, `res.collection`,
 * `res.negotiate`, `res.render`, `res.hbs`, `res.boom.*`, `req.pagination`,
 * `req.permit`, `req.flash`.
 *
 * **Already refusing well, and left alone.** The cache's keys and values
 * (`HENRI_CACHE_KEY_INVALID`, `HENRI_CACHE_VALUE_UNSUPPORTED`,
 * `HENRI_CACHE_TTL_INVALID`), a trail event (`HENRI_TRAIL_INVALID_EVENT`
 * and the `meta` refusals), a mailer and its action
 * (`HENRI_MAIL_UNKNOWN_MAILER`, `HENRI_MAIL_UNKNOWN_ACTION`,
 * `HENRI_MAIL_INVALID_MESSAGE`), a model's fields, options, personal marks
 * and retention rules (they fail the boot, which is the right boundary for
 * a declaration), `henri.config.get` (`HENRI_CONFIG_UNKNOWN_KEY`),
 * `henri.reporter.onError` and `henri.mailers.onDeliverLater` (both answer
 * `false` and say so, which is their documented contract),
 * `henri.policies.get`/`has`/`rule`/`resolve` (documented to answer `null`),
 * `henri.model.errors` (documented to answer `null` for anything that is
 * not a validation failure), `henri.model.publish` (its contract *is*
 * anything: it is what `res.render` hands whatever a controller returned),
 * `henri.encryption.isEnvelope`/`keyIdIn` (total functions of `unknown`),
 * and `henri.pen.*` (a logger that throws is worse than a wrong log line).
 *
 * ## Where the check goes, and what it costs
 *
 * **Never inside a loop of henri's own.** `res.collection(records)` checks
 * that `records` is a list and stops there; the rows are the serializer's
 * business, and one assertion per row to catch a mistake the call itself
 * announces is the wrong trade. `henri.model.publish()` walks a tree and
 * checks nothing on the way down. The rule is about henri's loops, not the
 * application's: `encryption.encrypt()` is called once per row by the
 * adapters, and it is checked, because a check is bounded by the cost of
 * what it guards -- a `typeof` in front of an AES-GCM seal is free, and the
 * mistake it catches (`context` missing) writes ciphertext that will never
 * open again.
 *
 * **The checks always run, in production too.** Compiling them out would
 * need a build step core does not have -- the source is what ships -- and
 * it would mean the one place a wrong call is expensive behaves differently
 * from the place it was tested. The cost is a table lookup and a `typeof`
 * per argument, on entry points that are per-request or per-operation and
 * are followed by I/O; an argument declared `ANY` or `by` allocates
 * nothing at all. The single entry point where an allocation would have
 * been measurable is `henri.config.get`, called in tight loops, and it is
 * in `UNCHECKED` because it already refuses everything that is not a key.
 *
 * **A method henri also calls internally is checked once, here, at the
 * method the application names.** `henri.can()` and `req.can()` both funnel
 * into `henri.policies.can()`, so that is the one that checks; the wrappers
 * pass through it. Where henri calls a checked method itself -- `res.render`
 * calls `model.publish`, `privacy.export` calls `privacy.subject` -- the
 * check runs on a value henri produced, which is affordable only because
 * every one of them is O(1). None of them needed splitting into a checked
 * outer and an unchecked inner, and the day one does, that is the shape.
 *
 * ## Deliberately not here
 *
 * No dependency, no decorators, no wrapping of methods at registration time
 * (a stack trace should name the method that was called, not a proxy), and
 * no check of what an argument *means* where the table cannot say it: an
 * options bag is checked key by key, and the three places that need more
 * than a shape -- a person who is nobody, a message with no recipient, a
 * selector that names nothing -- say so themselves, in a sentence, next to
 * the code that knows.
 */

const { describe, problems, received } = require('./config-validate');
const { fail } = require('./errors');

/** The failure a call that henri cannot honour raises */
const CODE = 'HENRI_ARGUMENT_INVALID';

/** ... and the one a selector that names nothing raises */
const UNKNOWN = 'HENRI_ARGUMENT_UNKNOWN_TARGET';

// ---------------------------------------------------------------------------
// The nodes: the vocabulary of config-schema.js, nothing new
// ---------------------------------------------------------------------------

/** Anything: an argument this module does not judge */
const ANY = { type: 'any' };

/** True or false */
const BOOLEAN = { type: 'boolean' };

/** A function */
const FUNCTION = { type: 'function' };

/** A name: a string with something in it */
const NAME = { describe: 'a name', pattern: /\S/u, type: 'string' };

/** A plain object */
const OBJECT = { type: 'object' };

/** A whole number of items, at least one */
const COUNT = {
  above: 0,
  describe: 'a whole number above zero',
  integer: true,
  type: 'number',
};

/** The name of an action a policy has a rule for */
const ACTION = {
  describe: 'the name of an action',
  hint: "henri.can(user, 'update', record)",
  pattern: /\S/u,
  type: 'string',
};

/** Where an operation was asked from (`base/trail.js` owns the list) */
const SOURCE = { enum: ['app', 'cli', 'http', 'job'], type: 'string' };

/** What an erasure does with the records that reference the person */
const STRATEGY = {
  enum: ['anonymize', 'delete', 'orphan', 'retain'],
  type: 'string',
};

/**
 * A moment: a Date, epoch milliseconds, or an ISO-8601 string.
 *
 * The string branch is not "anything Date can read": `new Date('yesterday')`
 * is an Invalid Date, and an Invalid Date reaches a store as a `NaN` bound
 * that quietly matches nothing.
 */
const WHEN = {
  describe: 'a Date, epoch milliseconds, or an ISO-8601 date',
  oneOf: [
    { type: 'date' },
    { describe: 'epoch milliseconds', min: 0, type: 'number' },
    {
      describe: 'an ISO-8601 date',
      pattern: /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/u,
      type: 'string',
    },
  ],
};

/** A duration, the one `base/cache.js` reads */
const DURATION = {
  describe: "a duration: milliseconds, or '30s', '5m', '2h', '1d'",
  oneOf: [
    { const: null },
    { min: 0, type: 'number' },
    { pattern: /^\s*\d+(?:\.\d+)?\s*(?:ms|[smhdw])?\s*$/iu, type: 'string' },
  ],
};

/** The person an export, an erasure or a trail read is about */
const WHO = {
  describe: 'an email address, an external id, or the record itself',
  hint: "henri.privacy.export('someone@example.com')",
  oneOf: [{ pattern: /\S/u, type: 'string' }, OBJECT],
};

/**
 * An options bag: the keys it declares, and a near miss of one of them
 * refused by name. Everything else is left alone, the way the
 * configuration leaves an application's own keys alone.
 *
 * @param {object} keys the declared options
 * @param {object} [extra={}] anything else the node carries
 * @returns {object} the node
 */
const bag = (keys, extra = {}) => ({
  keys,
  type: 'object',
  unknown: 'near',
  ...extra,
});

/**
 * What every cache call takes.
 *
 * `ttl` is `ANY` here on purpose: `Cache#ttlOf` owns it and raises
 * `HENRI_CACHE_TTL_INVALID`, which says more about a duration than a node
 * could. What the bag adds is the key names around it, so `tll` and `forse`
 * are refused instead of silently meaning the default.
 */
const CACHE_OPTIONS = bag({ force: BOOLEAN, ttl: ANY });

/** What a policy question takes beside the user, the action and the record */
const POLICY_OPTIONS = {
  describe: 'a policy name, or { policy, type, req }',
  oneOf: [NAME, bag({ policy: NAME, req: OBJECT, type: NAME })],
};

/** ... and the same with the status a refusal answers with */
const AUTHORIZE_OPTIONS = {
  describe: 'a policy name, or { policy, type, req, status }',
  oneOf: [
    NAME,
    bag({
      policy: NAME,
      req: OBJECT,
      status: { integer: true, max: 599, min: 100, type: 'number' },
      type: NAME,
    }),
  ],
};

/** What the access trail is read back with */
const TRAIL_FILTER = bag({
  action: NAME,
  actor: NAME,
  digest: NAME,
  limit: COUNT,
  model: NAME,
  offset: { integer: true, min: 0, type: 'number' },
  outcome: { enum: ['failed', 'ok', 'refused'], type: 'string' },
  since: WHEN,
  subject: NAME,
  until: WHEN,
});

/** What an encrypted value is read and written with */
const ENCRYPTION_OPTIONS = bag({
  context: {
    ...NAME,
    describe: 'the "<Model>.<field>" the value belongs to',
    required: true,
  },
  deterministic: BOOLEAN,
});

/** The fields marked `expose: false` an answer is allowed to carry */
const INCLUDE = {
  describe: 'a list of field names',
  hint: 'They are the fields marked personal: { expose: false }',
  of: NAME,
  type: 'array',
};

/** An HTTP status */
const STATUS = {
  describe: 'an HTTP status',
  integer: true,
  max: 599,
  min: 100,
  type: 'number',
};

/** What `res.resource()` takes */
const RESOURCE_OPTIONS = bag({
  include: INCLUDE,
  links: OBJECT,
  status: STATUS,
  subject: ANY,
  type: NAME,
});

/** ... and what `res.collection()` adds to it */
const COLLECTION_OPTIONS = bag({
  include: INCLUDE,
  links: OBJECT,
  page: COUNT,
  perPage: COUNT,
  status: STATUS,
  subject: ANY,
  total: { integer: true, min: 0, type: 'number' },
  type: NAME,
});

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

/**
 * The signature of every entry point an application calls, in order.
 *
 * The name is the one a person writes and the one a message prints. It is
 * also what `src/__tests__/arguments.spec.js` walks: a name declared here
 * and never checked fails, and a public method in neither this table nor
 * `UNCHECKED` fails too.
 */
const SIGNATURES = {
  'henri.cache.clear': [],

  'henri.cache.delete': [{ by: 'HENRI_CACHE_KEY_INVALID', name: 'key' }],

  'henri.cache.fetch': [
    { by: 'HENRI_CACHE_KEY_INVALID', name: 'key' },
    { name: 'options', optional: true, ...CACHE_OPTIONS },
    {
      hint: 'henri.cache.fetch(key, [options], fn) runs fn on a miss and keeps what it answers',
      name: 'fn',
      ...FUNCTION,
    },
  ],

  'henri.cache.get': [{ by: 'HENRI_CACHE_KEY_INVALID', name: 'key' }],

  'henri.cache.scope': [{ by: 'HENRI_CACHE_KEY_INVALID', name: 'name' }],

  'henri.cache.set': [
    { by: 'HENRI_CACHE_KEY_INVALID', name: 'key' },
    { by: 'HENRI_CACHE_VALUE_UNSUPPORTED', name: 'value' },
    { name: 'options', optional: true, ...CACHE_OPTIONS },
  ],

  'henri.encryption.candidates': [
    {
      ...NAME,
      describe: 'the value to look up',
      name: 'value',
    },
    { name: 'options', ...ENCRYPTION_OPTIONS },
  ],

  'henri.encryption.markOf': [
    { name: 'model', ...NAME },
    { name: 'field', ...NAME },
  ],

  'henri.encryption.rotate': [
    {
      name: 'options',
      optional: true,
      ...bag({ dryRun: BOOLEAN, field: NAME, model: NAME }),
    },
  ],

  'henri.encryption.tolerate': [
    {
      hint: 'henri.encryption.tolerate(() => Model.find())',
      name: 'work',
      ...FUNCTION,
    },
  ],

  'henri.mail.send': [{ name: 'message', ...bag({}, { unknown: 'allow' }) }],

  'henri.model.getStore': [{ name: 'name', optional: true, ...NAME }],

  'henri.policies.authorize': [
    { name: 'user', ...ANY },
    { name: 'action', ...ACTION },
    { name: 'record', optional: true, ...ANY },
    { name: 'options', optional: true, ...AUTHORIZE_OPTIONS },
  ],

  'henri.policies.can': [
    { name: 'user', ...ANY },
    { name: 'action', ...ACTION },
    { name: 'record', optional: true, ...ANY },
    { name: 'options', optional: true, ...POLICY_OPTIONS },
  ],

  'henri.policies.links': [
    { name: 'user', ...ANY },
    { name: 'links', ...OBJECT },
    { name: 'record', optional: true, ...ANY },
    {
      name: 'options',
      optional: true,
      ...bag({ cache: ANY, req: OBJECT, type: NAME }),
    },
  ],

  'henri.policies.paths': [
    { name: 'user', ...ANY },
    { name: 'paths', ...OBJECT },
    { name: 'options', optional: true, ...bag({ req: OBJECT }) },
  ],

  'henri.policies.scope': [
    { name: 'user', ...ANY },
    {
      hint: "henri.policies.scope(user, 'proposal') names the policy to ask",
      name: 'name',
      ...NAME,
    },
    { name: 'context', optional: true, ...OBJECT },
  ],

  'henri.privacy.erase': [
    { name: 'who', ...WHO },
    {
      name: 'options',
      optional: true,
      ...bag({ dryRun: BOOLEAN, source: SOURCE, strategy: STRATEGY }),
    },
  ],

  'henri.privacy.export': [
    { name: 'who', ...WHO },
    { name: 'options', optional: true, ...bag({ source: SOURCE }) },
  ],

  'henri.privacy.fields': [{ name: 'model', ...NAME }],

  'henri.privacy.plan': [
    { name: 'who', ...WHO },
    { name: 'options', optional: true, ...bag({ strategy: STRATEGY }) },
  ],

  'henri.privacy.strip': [
    { name: 'value', ...ANY },
    { name: 'include', optional: true, ...INCLUDE },
  ],

  'henri.privacy.subject': [{ name: 'who', ...WHO }],

  'henri.reporter.report': [
    { name: 'error', ...ANY },
    {
      name: 'options',
      optional: true,
      ...bag({
        meta: OBJECT,
        req: OBJECT,
        source: {
          enum: ['application', 'boot', 'rejection', 'request'],
          type: 'string',
        },
        status: STATUS,
      }),
    },
  ],

  'henri.retention.plan': [
    { name: 'options', optional: true, ...bag({ now: WHEN, only: NAME }) },
  ],

  'henri.retention.sweep': [
    {
      name: 'options',
      optional: true,
      ...bag({ dryRun: BOOLEAN, now: WHEN, only: NAME, source: SOURCE }),
    },
  ],

  'henri.trail.about': [
    { name: 'who', ...WHO },
    { name: 'filter', optional: true, ...TRAIL_FILTER },
  ],

  'henri.trail.count': [{ name: 'filter', optional: true, ...TRAIL_FILTER }],

  'henri.trail.list': [{ name: 'filter', optional: true, ...TRAIL_FILTER }],

  'henri.trail.prune': [
    { name: 'options', optional: true, ...bag({ now: { type: 'number' } }) },
  ],

  'message.deliverLater': [
    {
      name: 'options',
      optional: true,
      ...bag({
        at: WHEN,
        priority: { integer: true, type: 'number' },
        queue: NAME,
        wait: DURATION,
      }),
    },
  ],

  'req.flash': [
    { name: 'key', optional: true, ...NAME },
    { name: 'value', optional: true, ...ANY },
  ],

  'req.pagination': [
    {
      name: 'overrides',
      optional: true,
      ...bag({ maxPerPage: COUNT, perPage: COUNT }),
    },
  ],

  'req.permit': [{ name: 'fields', of: NAME, type: 'array' }],

  'res.boom': [
    {
      ...NAME,
      describe: 'a string',
      hint: 'The error body promises a string; the detail goes in the second argument',
      name: 'message',
      optional: true,
    },
    { name: 'data', optional: true, ...ANY },
  ],

  'res.collection': [
    { by: 'HENRI_API_INVALID_COLLECTION', name: 'records' },
    { name: 'options', optional: true, ...COLLECTION_OPTIONS },
  ],

  'res.negotiate': [
    {
      hint: 'res.negotiate({ html: () => res.render(...), json: () => res.resource(...) })',
      name: 'handlers',
      ...bag({ html: FUNCTION, json: FUNCTION }, { unknown: 'warn' }),
    },
  ],

  'res.render': [
    {
      ...NAME,
      describe: 'the route of a page',
      hint: "res.render('/tasks/index', { data })",
      name: 'route',
    },
    {
      name: 'options',
      optional: true,
      ...bag(
        { data: ANY, graphql: { oneOf: [NAME, OBJECT] }, include: INCLUDE },
        { unknown: 'allow' }
      ),
    },
  ],

  'res.resource': [
    { by: 'HENRI_API_INVALID_RESOURCE', name: 'record' },
    { name: 'options', optional: true, ...RESOURCE_OPTIONS },
  ],
};

/**
 * The public methods that are checked somewhere else, or that are right as
 * they are -- and why. `src/__tests__/arguments.spec.js` reads this, so a
 * new public method has to land in one table or the other.
 */
const UNCHECKED = {
  'henri.addMiddleware':
    'says so and answers false, which is its documented contract',
  'henri.analyze': 'takes a module name and answers null for anything else',
  'henri.can': 'the one implementation is henri.policies.can, checked there',
  'henri.config.get':
    'HENRI_CONFIG_UNKNOWN_KEY already refuses anything that is not a key, and this is the one entry point called often enough for an allocation to matter',
  'henri.config.has': 'answers false for anything that is not a key',
  'henri.encryption.decrypt':
    'checked by hand in 1.encryption.js, with three typeofs and no allocation: the three adapters call it once per row per encrypted column, which is the one place a walk is not worth it',
  'henri.encryption.describe': 'takes no argument',
  'henri.encryption.encrypt': 'the same, on the write path',
  'henri.encryption.isEnvelope': 'a total function of unknown',
  'henri.encryption.keyIdIn': 'a total function of unknown',
  'henri.encryption.status': 'takes no argument',
  'henri.gql': 'a tagged template that answers a string, whatever it is given',
  'henri.mailers.onDeliverLater':
    'says so and answers false, which is its documented contract',
  'henri.model.errors':
    'answers null for anything that is not a validation failure, which is its documented contract',
  'henri.model.publish':
    'its contract is anything: it is what res.render hands whatever a controller returned',
  'henri.pen': 'a logger that throws is worse than a wrong log line',
  'henri.policies.get': 'documented to answer null',
  'henri.policies.has': 'documented to answer false',
  'henri.policies.names': 'takes no argument',
  'henri.policies.resolve': 'documented to answer null',
  'henri.policies.rule': 'documented to answer null',
  'henri.policies.size': 'takes no argument',
  'henri.privacy.describe': 'takes no argument',
  'henri.reporter.onError':
    'says so and answers false, which is its documented contract',
  'henri.retention.describe': 'takes no argument',
  'henri.trail.record':
    'HENRI_TRAIL_INVALID_EVENT and the meta refusals already say what is wrong',
  'henri.trail.verify': 'takes no argument',
  'henri.utils': 'node resolution answers for itself',
  'req.authorize': 'the one implementation is henri.policies.authorize',
  'req.can': 'the one implementation is henri.policies.can',
  'req.file': 'answers null for anything that is not a field name',
  'req.permitFiles': 'the same list req.permit takes, checked there',
  'req.scope': 'the one implementation is henri.policies.scope',
  'res.hbs': 'the same arguments as res.render, checked there',
};

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/** The name `config-validate` suggests for a near miss, out of its hint */
const SUGGESTION = /^Rename it to "(?<name>[^"]+)"/u;

/**
 * One line of a refusal
 *
 * @param {string} where the entry point (`henri.cache.set`)
 * @param {object} problem a problem of `config-validate`
 * @returns {string} the line
 */
function line(where, problem) {
  if (problem.expected !== null) {
    return `${where}(${problem.key}) must be ${problem.expected}, but it is ${problem.received}`;
  }

  const near = SUGGESTION.exec(problem.hint || '');

  return `${where}(${problem.key}) is not one of its options${
    near ? `: did you mean "${near.groups.name}"?` : ''
  }`;
}

/**
 * Check what a public method was called with
 *
 * The one way to ask, and the only thing an entry point adds to itself. It
 * throws rather than answering, because a call henri cannot honour has no
 * useful answer: `HENRI_ARGUMENT_INVALID`, naming the method, the argument,
 * what was expected and what arrived. An async method rejects with it,
 * which is what its caller is already handling.
 *
 * Nothing is allocated while a call is right: an argument declared `by` or
 * `any` is skipped outright, and `problems()` is the only allocation the
 * others make.
 *
 * @param {string} where the entry point, as a person writes it
 * @param {Array<*>} args what it was called with
 * @param {string} [as=where] what to call it in the message, when one
 *   signature stands for a family of methods (`res.boom.notFound`)
 * @returns {void}
 * @throws {Error} `HENRI_ARGUMENT_INVALID` when the call cannot be honoured
 */
function check(where, args, as = where) {
  const signature = SIGNATURES[where];

  if (!signature) {
    // A mistake of henri's rather than of the application's, so it reads
    // like the one `stamp()` makes for a code the catalogue does not hold
    throw new Error(
      `${where} has no declared signature: add it to packages/core/src/base/arguments.js`
    );
  }

  let found = null;

  for (let index = 0; index < signature.length; index++) {
    const declared = signature[index];
    const value = args[index];

    if (declared.by || declared.type === 'any') {
      continue;
    }

    if (typeof value === 'undefined') {
      if (declared.optional) {
        continue;
      }

      found = found || [];
      found.push({
        expected: describe(declared),
        hint: declared.hint || null,
        key: declared.name,
        received: 'missing',
      });

      continue;
    }

    const wrong = problems(declared, value, declared.name);

    if (wrong.length > 0) {
      found = found || [];

      for (const problem of wrong) {
        found.push({
          ...problem,
          hint: problem.hint || declared.hint || null,
        });
      }
    }
  }

  if (found === null) {
    return;
  }

  const lines = found.map((problem) => line(as, problem));
  const error = fail(
    CODE,
    lines.length === 1
      ? lines[0]
      : `${as} was called with ${lines.length} arguments henri cannot honour:\n  ${lines.join('\n  ')}`
  );

  error.hint = (found.find((problem) => problem.hint) || {}).hint || null;
  error.problems = found;

  throw error;
}

/**
 * Refuse a selector that names nothing
 *
 * What a shape cannot catch, and what a clean, empty, successful run hides:
 * `henri.retention.plan({ only: 'Propsal' })` sweeping no rule,
 * `henri.encryption.rotate({ model: 'Usr' })` rotating no column. Both end
 * with somebody believing the work is done.
 *
 * @param {string} where the entry point
 * @param {string} what the option that names nothing (`only`)
 * @param {*} value what it named
 * @param {Array<string>} known what it could have named
 * @returns {Error} the error to throw
 */
function unknown(where, what, value, known) {
  const error = fail(
    UNKNOWN,
    `${where}(${what}) names ${received(value)}, which is nothing this application has`
  );

  error.hint =
    known.length > 0
      ? `It is one of: ${known.slice(0, 12).join(', ')}${
          known.length > 12 ? ', ...' : ''
        }`
      : 'This application declares none';

  return error;
}

module.exports = {
  CODE,
  SIGNATURES,
  UNCHECKED,
  UNKNOWN,
  check,
  unknown,
};
