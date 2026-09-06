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
 * (`list`, `count`, `about`, `prune`), `henri.calls` (`list`, `count`,
 * `forPerson`, `forget`,
 * `about`, `prune`, `outbound`, `track`), `henri.encryption` (`markOf`,
 * `encrypt`, `decrypt`, `candidates`, `tolerate`, `rotate`),
 * `henri.user` (`compare`, `encrypt`, `publicUser`), `henri.accounts`
 * (`allowed`, `consume`, `identify`, `register`, `requestConfirmation`,
 * `requestEmailChange`, `requestPasswordReset`, `sendConfirmation`,
 * `sendReset`, `tokenFor`, `urlFor`),
 * `henri.model.getStore`, `henri.mail.send`, `deliverLater`, and what a
 * request gets: `res.resource`, `res.collection`, `res.negotiate`,
 * `res.render`, `res.hbs`, `res.boom.*`, `req.pagination`, `req.permit`,
 * `req.flash`.
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
 * **Deliberately lenient**, which is a third answer and there is one of it:
 * `henri.reporter.report()` runs on a failure path, so refusing a wrong
 * call there would lose the failure it was called about. A wrong `source`
 * is coerced and a wrong `options` is read as none, on purpose.
 *
 * ## The authentication surface, where two rules pull against each other
 *
 * The user module and the account flows were left out of the first pass on
 * purpose: everything they do sits on a path where a refusal can become an
 * oracle. `POST /login` answers the same for an unknown address and a wrong
 * password, and a reset request answers *before* it looks anything up, so
 * that a known and an unknown address are indistinguishable in body, status
 * and timing. A check that throws where henri used to answer, or that throws
 * a different shape on one branch, undoes that from the inside.
 *
 * The line is therefore drawn by **whose mistake it is**:
 *
 * - a value the *caller* chose -- the record a hash is for, the purpose of a
 *   token, the path of a link, the options of a call -- is a coded refusal,
 *   because the alternative is what these methods used to do: mint a token
 *   nothing can consume, build `https://host42`, write an unbound hash;
 * - a value the *visitor* sent -- a password, a token, an address typed into
 *   a form -- is not checked here and keeps the answer it always had. A
 *   token is `malformed`, a password is a mismatch, an address that is not
 *   one is the 422 the endpoint already answered.
 *
 * That is why `henri.user.compare(password, user)` checks its second
 * argument and not its first; why `null` is a *value* for that second one
 * (nobody has that address) rather than a mistake, answering the mismatch a
 * wrong password answers, in the same words, at the same cost; and why
 * `henri.accounts.resetPassword(token, password)` is in `UNCHECKED` with
 * both of its arguments belonging to whoever followed the link. The
 * per-method reasoning is in the headers of `4.user.js` and
 * `base/accounts.js`.
 *
 * ## Where the check goes, and what it costs
 *
 * **Never inside a loop of henri's own.** `res.collection(records)` checks
 * that `records` is a list and stops there; the rows are the serializer's
 * business, and one assertion per row to catch a mistake the call itself
 * announces is the wrong trade. `henri.model.publish()` walks a tree and
 * checks nothing on the way down.
 *
 * Two entry points sit on such a loop without being henri's: the three
 * adapters call `encryption.encrypt()` and `decrypt()` once per row per
 * encrypted column. They are still checked -- the mistake they catch, a
 * missing `context`, writes ciphertext whose AAD no read path will ever
 * match again -- but by hand, in `1.encryption.js`, with three `typeof`s
 * and no allocation, and they are in `UNCHECKED` saying so. That is the
 * shape for anything else that lands there.
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
 * **A method henri also calls internally is checked once, at the method the
 * application names.** `henri.can()` and `req.can()` both funnel into
 * `henri.policies.can()`, so that is the one that checks and the wrappers
 * pass through it. Where henri then calls a checked method itself --
 * `res.render` calls `model.publish`, `privacy.export` calls
 * `privacy.subject` -- the check runs again on a value henri produced,
 * which is affordable because every one of them is O(1).
 *
 * One method needed splitting, and it is the shape for the next:
 * `policies.can()` checks and then calls `policies.answer()`, the body they
 * share, because `links()` and `paths()` ask the same question once per
 * link with an action they read out of a route helper. Checking a value
 * henri produced, inside a loop henri wrote, is the trade the rule above
 * says not to make.
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

/**
 * A locale, as its catalogue in `config/locales` is named.
 *
 * Nothing narrower on purpose: `fr`, `fr-CA` and `zh-Hant-TW` are all
 * locales, and a pattern tight enough to be worth writing would refuse one
 * of them before `henri.i18n` had a chance to say it has no such catalogue,
 * which is the better message.
 */
const LOCALE = {
  describe: 'a locale',
  hint: 'henri.i18n.locales answers the ones this application has',
  pattern: /\S/u,
  type: 'string',
};

/** Where an operation was asked from (`base/trail.js` owns the list) */
const SOURCE = { enum: ['app', 'cli', 'http', 'job'], type: 'string' };

/**
 * A user record: a row, an instance, whatever the ORM answered.
 *
 * Nothing deeper is asked of it -- the adapters know what a user of theirs
 * looks like and henri does not -- but a number is not one, and every method
 * that took one used to answer something plausible for a number: a public
 * user with no identifier, a token nothing names, "could not be changed".
 */
const USER = {
  describe: 'a user record',
  hint: 'henri.user.findByEmail(email) and req.user answer one',
  type: 'object',
};

/**
 * What a signed account token is allowed to do.
 *
 * The list is `PURPOSE` in `base/accounts.js`, spelled again here because
 * that module reaches for this one; `src/__tests__/arguments.spec.js`
 * compares the two. A fourth string is not an extension point: `seedFor()`
 * would give it the confirmation seed and the confirmation expiry, and only
 * a `consume()` carrying the identical typo would ever spend it.
 */
const PURPOSE = {
  enum: ['confirmation', 'email-change', 'password-reset'],
  hint: 'henri.accounts.PURPOSE holds them: confirmation, emailChange, reset',
  type: 'string',
};

/**
 * An address one of the account flows was asked about.
 *
 * A string with something in it, and deliberately **not** an address
 * pattern: the endpoints already refuse what is not one, with the same loose
 * test the adapters validate the column with, and a stricter test here would
 * answer 422 for an address that is nonetheless in the database -- the
 * enumeration leak these flows exist to avoid.
 */
const ADDRESS = {
  describe: 'an email address',
  hint: 'The endpoints refuse an address that is not one before asking',
  pattern: /\S/u,
  type: 'string',
};

/** A path inside the application, which is what an absolute url is built on */
const PATH = {
  describe: 'a path beginning with "/"',
  hint: "henri.accounts.urlFor('/confirm/' + token)",
  pattern: /^\//u,
  type: 'string',
};

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
 * A key of an options bag that also accepts `null`.
 *
 * The rule, and it is worth stating because it is not uniform: a key that
 * names a **selector or a switch** takes `null` as "not given", because a
 * caller that computes an option and comes up with nothing should not have
 * to delete the key -- `{ model: found && found.name }` is how these are
 * written, and every reader of one of them tests it for truth. A key whose
 * absence has a **default** does not, because `{ include: null }` and no
 * `include` at all are different there: the default only fills in for
 * `undefined`, and `null` goes straight through to the code that breaks.
 *
 * @param {object} node the node
 * @returns {object} the node, or null
 */
const maybe = (node) => ({
  describe: describe(node),
  hint: node.hint,
  oneOf: [{ const: null }, node],
});

/**
 * What every cache call takes.
 *
 * `ttl` is `ANY` here on purpose: `Cache#ttlOf` owns it and raises
 * `HENRI_CACHE_TTL_INVALID`, which says more about a duration than a node
 * could. What the bag adds is the key names around it, so `tll` and `forse`
 * are refused instead of silently meaning the default.
 */
const CACHE_OPTIONS = bag({ force: maybe(BOOLEAN), ttl: ANY });

/** What a policy question takes beside the user, the action and the record */
const POLICY_OPTIONS = {
  describe: 'a policy name, or { policy, type, req }',
  oneOf: [
    NAME,
    bag({ policy: maybe(NAME), req: maybe(OBJECT), type: maybe(NAME) }),
  ],
};

/** ... and the same with the status a refusal answers with */
const AUTHORIZE_OPTIONS = {
  describe: 'a policy name, or { policy, type, req, status }',
  oneOf: [
    NAME,
    bag({
      policy: maybe(NAME),
      req: maybe(OBJECT),
      status: maybe({ integer: true, max: 599, min: 100, type: 'number' }),
      type: maybe(NAME),
    }),
  ],
};

/** What the access trail is read back with */
/** Where a version says a change came from (`base/versions.js`) */
const SOURCES = ['console', 'http', 'job', 'seed', 'system', 'task'];

/** A version, or the id of one */
const VERSION = {
  describe: 'a version, or the id of one',
  hint: 'henri versions <Model> <record> lists them with their ids',
  oneOf: [NAME, OBJECT],
};

/** What a version listing takes */
const VERSION_FILTER = bag({
  actor: maybe(NAME),
  event: maybe({ enum: ['create', 'destroy', 'update'], type: 'string' }),
  limit: maybe(COUNT),
  model: maybe(NAME),
  offset: maybe({ integer: true, min: 0, type: 'number' }),
  record: maybe(NAME),
  requestId: maybe(NAME),
  since: maybe(WHEN),
  source: maybe({ enum: SOURCES, type: 'string' }),
  until: maybe(WHEN),
});

const TRAIL_FILTER = bag({
  action: maybe(NAME),
  actor: maybe(NAME),
  digest: maybe(NAME),
  limit: maybe(COUNT),
  model: maybe(NAME),
  offset: maybe({ integer: true, min: 0, type: 'number' }),
  outcome: maybe({ enum: ['failed', 'ok', 'refused'], type: 'string' }),
  since: maybe(WHEN),
  subject: maybe(NAME),
  until: maybe(WHEN),
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

/**
 * What a span takes beside its name and its function.
 *
 * `attributes` is `OBJECT` rather than a shape: what an application puts in
 * one is its own, and `base/telemetry.js` masks it and drops what a span
 * cannot carry rather than refusing the call. `boundary` is henri's own
 * list, so a typo there means "always spanned" and is worth refusing.
 *
 * None of the three takes `null`, by the rule of `maybe()` above: each one
 * absent has a meaning of its own -- no attributes, no boundary, an
 * internal span -- so `null` is a mistake rather than "not given". It is
 * also the one bag on a path that can run per store call, and a `oneOf`
 * per key is what a walk of it costs.
 */
const SPAN_OPTIONS = bag({
  attributes: OBJECT,
  boundary: {
    enum: ['boot', 'http', 'jobs', 'mail', 'stores', 'views', 'webhooks'],
    type: 'string',
  },
  kind: {
    enum: ['client', 'consumer', 'internal', 'producer', 'server'],
    type: 'string',
  },
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

/** What the call log is read back with */
const CALL_FILTER = bag({
  actor: maybe(NAME),
  direction: maybe({ enum: ['in', 'out'], type: 'string' }),
  limit: maybe(COUNT),
  offset: maybe({ integer: true, min: 0, type: 'number' }),
  outcome: maybe({ enum: ['aborted', 'failed', 'ok'], type: 'string' }),
  requestId: maybe(NAME),
  service: maybe(NAME),
  since: maybe(WHEN),
  status: maybe(STATUS),
  until: maybe(WHEN),
});

/**
 * One half of a call: the headers and the body of a request or an answer.
 *
 * The body is `ANY` on purpose -- an outbound call carries whatever the
 * service takes -- and what it is *allowed to become* is not this module's
 * question: `base/calls.js` stores a body it can walk and redact, and
 * records the shape of anything else instead of the thing itself.
 */
const CALL_SIDE = maybe(bag({ body: ANY, headers: maybe(OBJECT) }));

/** What an outbound call records */
const CALL = bag({
  actor: maybe(NAME),
  at: maybe({ min: 0, type: 'number' }),
  duration: maybe({ min: 0, type: 'number' }),
  error: maybe(NAME),
  meta: maybe(OBJECT),
  method: maybe(NAME),
  outcome: maybe({ enum: ['aborted', 'failed', 'ok'], type: 'string' }),
  request: CALL_SIDE,
  requestId: maybe(NAME),
  response: CALL_SIDE,
  route: maybe(NAME),
  service: maybe(NAME),
  status: maybe(STATUS),
  url: maybe(NAME),
});

/** ... and what starts timing one */
const CALL_TRACK = bag({
  meta: maybe(OBJECT),
  method: maybe(NAME),
  request: CALL_SIDE,
  requestId: maybe(NAME),
  service: maybe(NAME),
  url: maybe(NAME),
});

/** What `res.resource()` takes */
const RESOURCE_OPTIONS = bag({
  include: INCLUDE,
  links: maybe(OBJECT),
  status: STATUS,
  subject: ANY,
  type: maybe(NAME),
});

/** ... and what `res.collection()` adds to it */
const COLLECTION_OPTIONS = bag({
  include: INCLUDE,
  links: maybe(OBJECT),
  page: maybe(COUNT),
  perPage: maybe(COUNT),
  status: STATUS,
  subject: ANY,
  total: maybe({ integer: true, min: 0, type: 'number' }),
  type: maybe(NAME),
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
  'henri.accounts.allowed': [{ name: 'user', ...USER }],

  'henri.accounts.consume': [
    // Whoever followed the link chose it; `peek()` answers null for anything
    { name: 'token', ...ANY },
    { name: 'purpose', ...PURPOSE },
  ],

  'henri.accounts.identify': [{ name: 'user', ...USER }],

  'henri.accounts.register': [
    {
      hint: 'henri.accounts.register(req.permit("email", "password"))',
      name: 'attributes',
      ...bag({}, { unknown: 'allow' }),
    },
  ],

  'henri.accounts.requestConfirmation': [{ name: 'email', ...ADDRESS }],

  'henri.accounts.requestEmailChange': [
    { name: 'user', ...USER },
    // The address is the one that was typed: this answers `{ errors: { email
    // } }` for anything that is not one, which is what a form needs
    { name: 'email', ...ANY },
  ],

  'henri.accounts.requestPasswordReset': [{ name: 'email', ...ADDRESS }],

  'henri.accounts.sendConfirmation': [{ name: 'user', ...USER }],

  'henri.accounts.sendReset': [{ name: 'user', ...USER }],

  'henri.accounts.tokenFor': [
    { name: 'user', ...USER },
    { name: 'purpose', ...PURPOSE },
    {
      name: 'options',
      optional: true,
      // `expiresIn` is any whole number of milliseconds, negative included:
      // that is how a suite mints a link that is already expired
      ...bag({
        data: ANY,
        expiresIn: maybe({ integer: true, type: 'number' }),
      }),
    },
  ],

  'henri.accounts.urlFor': [{ name: 'path', ...PATH }],

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

  'henri.calls.about': [
    { name: 'requestId', ...NAME },
    { name: 'filter', optional: true, ...CALL_FILTER },
  ],

  'henri.calls.count': [{ name: 'filter', optional: true, ...CALL_FILTER }],

  'henri.calls.forPerson': [
    { name: 'actor', ...NAME },
    { name: 'filter', optional: true, ...CALL_FILTER },
  ],

  'henri.calls.forget': [{ name: 'actor', ...NAME }],

  'henri.calls.list': [{ name: 'filter', optional: true, ...CALL_FILTER }],

  'henri.calls.outbound': [{ name: 'call', ...CALL }],

  'henri.calls.prune': [
    {
      name: 'options',
      optional: true,
      ...bag({ now: maybe({ min: 0, type: 'number' }) }),
    },
  ],

  'henri.calls.track': [{ name: 'details', ...CALL_TRACK }],

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
      ...bag({
        dryRun: maybe(BOOLEAN),
        field: maybe(NAME),
        model: maybe(NAME),
      }),
    },
  ],

  'henri.encryption.tolerate': [
    {
      hint: 'henri.encryption.tolerate(() => Model.find())',
      name: 'work',
      ...FUNCTION,
    },
  ],

  'henri.i18n.catalogue': [{ name: 'locale', ...LOCALE }],

  'henri.i18n.forUser': [{ name: 'user', ...maybe(USER) }],

  'henri.i18n.url': [{ name: 'locale', ...LOCALE }],

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
      ...bag({ cache: ANY, req: maybe(OBJECT), type: maybe(NAME) }),
    },
  ],

  'henri.policies.paths': [
    { name: 'user', ...ANY },
    { name: 'paths', ...OBJECT },
    { name: 'options', optional: true, ...bag({ req: maybe(OBJECT) }) },
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
      ...bag({
        dryRun: maybe(BOOLEAN),
        source: maybe(SOURCE),
        strategy: maybe(STRATEGY),
      }),
    },
  ],

  'henri.privacy.export': [
    { name: 'who', ...WHO },
    { name: 'options', optional: true, ...bag({ source: maybe(SOURCE) }) },
  ],

  'henri.privacy.fields': [{ name: 'model', ...NAME }],

  'henri.privacy.plan': [
    { name: 'who', ...WHO },
    { name: 'options', optional: true, ...bag({ strategy: maybe(STRATEGY) }) },
  ],

  'henri.privacy.strip': [
    { name: 'value', ...ANY },
    { name: 'include', optional: true, ...INCLUDE },
  ],

  'henri.privacy.subject': [{ name: 'who', ...WHO }],

  'henri.retention.plan': [
    {
      name: 'options',
      optional: true,
      ...bag({ now: maybe(WHEN), only: maybe(NAME) }),
    },
  ],

  'henri.retention.sweep': [
    {
      name: 'options',
      optional: true,
      ...bag({
        dryRun: maybe(BOOLEAN),
        now: maybe(WHEN),
        only: maybe(NAME),
        source: maybe(SOURCE),
      }),
    },
  ],

  'henri.telemetry.histogram': [
    { name: 'name', ...NAME },
    {
      name: 'options',
      optional: true,
      ...bag({ description: maybe(NAME), unit: maybe(NAME) }),
    },
  ],

  'henri.telemetry.inject': [
    {
      hint: 'henri.telemetry.inject(headers) writes traceparent into an outgoing header bag',
      name: 'carrier',
      ...OBJECT,
    },
  ],

  'henri.telemetry.observe': [
    { name: 'name', ...NAME },
    {
      name: 'options',
      ...bag({
        description: maybe(NAME),
        kind: maybe({ enum: ['counter', 'gauge'], type: 'string' }),
        unit: maybe(NAME),
      }),
    },
    {
      hint: 'henri.telemetry.observe(name, options, (observe) => observe(value, attributes))',
      name: 'callback',
      ...FUNCTION,
    },
  ],

  'henri.telemetry.span': [
    { name: 'name', ...NAME },
    { name: 'options', optional: true, ...SPAN_OPTIONS },
    {
      hint: 'henri.telemetry.span(name, [options], fn) runs fn inside a span',
      name: 'fn',
      ...FUNCTION,
    },
  ],

  'henri.trail.about': [
    { name: 'who', ...WHO },
    { name: 'filter', optional: true, ...TRAIL_FILTER },
  ],

  'henri.trail.count': [{ name: 'filter', optional: true, ...TRAIL_FILTER }],

  'henri.trail.list': [{ name: 'filter', optional: true, ...TRAIL_FILTER }],

  'henri.trail.prune': [
    {
      name: 'options',
      optional: true,
      ...bag({ now: maybe({ min: 0, type: 'number' }) }),
    },
  ],

  'henri.user.compare': [
    // The password is whoever is signing in; a wrong one is a mismatch and
    // a wrong *shape* has to be the same mismatch, or the shape is the
    // oracle. `verifyPassword()` reads anything that is not a string as ''
    { name: 'password', ...ANY },
    {
      describe: 'a user record, a hash on its own, or null for no account',
      hint: 'henri.user.compare(password, await henri.user.findByEmail(email))',
      name: 'user',
      // `null` is a value here and not a mistake: it is what findByEmail()
      // answers for an address nobody has, and it answers the mismatch a
      // wrong password answers. `undefined` goes with it, because that is
      // what a lookup of an application's own comes back as
      oneOf: [{ const: null }, NAME, OBJECT],
      optional: true,
    },
  ],

  'henri.user.encrypt': [
    // The policy answers this one, as a ValidationError shaped like a
    // model's, which is what puts the message next to the field
    { name: 'password', ...ANY },
    {
      describe: 'a bcrypt cost, or { identity, rounds }',
      hint: 'henri.user.encrypt(password, { identity: user }) binds the hash to that record',
      name: 'options',
      oneOf: [
        COUNT,
        bag({
          identity: maybe({
            describe: 'the record the hash is for, or its externalId',
            oneOf: [NAME, OBJECT],
          }),
          rounds: maybe(COUNT),
        }),
      ],
      optional: true,
    },
  ],

  'henri.user.publicUser': [
    {
      ...maybe(OBJECT),
      describe: 'a user record, or null',
      name: 'user',
      // `res.render` and the logout handler hand it `req.user`, which is
      // absent for an anonymous visitor and answers null
      optional: true,
    },
  ],

  'henri.versions.acting': [
    {
      hint: "henri.versions.acting({ actor: user, source: 'job' }, () => ...)",
      name: 'who',
      ...bag({
        actor: maybe({
          describe: 'an external id, or the record itself',
          oneOf: [NAME, OBJECT],
        }),
        source: maybe({ enum: SOURCES, type: 'string' }),
      }),
    },
    { name: 'work', ...FUNCTION },
  ],

  'henri.versions.count': [
    { name: 'filter', optional: true, ...VERSION_FILTER },
  ],

  'henri.versions.get': [{ name: 'id', ...NAME }],

  'henri.versions.list': [
    { name: 'filter', optional: true, ...VERSION_FILTER },
  ],

  'henri.versions.of': [
    {
      describe: 'a record, or { model, record }',
      hint: 'henri.versions.of(task) reads the history of that record',
      name: 'record',
      ...OBJECT,
    },
    { name: 'filter', optional: true, ...VERSION_FILTER },
  ],

  'henri.versions.prune': [
    {
      name: 'options',
      optional: true,
      ...bag({
        batch: maybe(COUNT),
        now: maybe({ min: 0, type: 'number' }),
      }),
    },
  ],

  'henri.versions.reify': [{ name: 'version', ...VERSION }],

  'henri.versions.restore': [
    { name: 'version', ...VERSION },
    { name: 'options', optional: true, ...bag({ force: maybe(BOOLEAN) }) },
  ],

  'message.deliverLater': [
    {
      name: 'options',
      optional: true,
      ...bag({
        at: maybe(WHEN),
        priority: maybe({ integer: true, type: 'number' }),
        queue: maybe(NAME),
        wait: maybe(DURATION),
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

  // `permit()` with no field at all answers everything the action declared,
  // so the list may be empty -- and `params.js` always hands one over
  'req.permit': [{ name: 'fields', of: NAME, optional: true, type: 'array' }],

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
        {
          data: ANY,
          graphql: maybe({ oneOf: [NAME, OBJECT] }),
          include: INCLUDE,
        },
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
 * new public method has to land in one table or the other -- unless it
 * takes no argument at all, which that test exempts on its own rather than
 * making a list of methods with nothing to check.
 */
const UNCHECKED = {
  'henri.accounts.checkPassword':
    'henri.user.validatePassword, which never throws and answers a verdict a form can show: the password is the visitor s and "that is not a password" is the answer, not a refusal',
  'henri.accounts.confirm':
    'the token is whoever followed the link: tokens.peek() answers null for anything that is not one and the flow answers reason: malformed, which is what an expired, a spent and a forged link all answer',
  'henri.accounts.resetPassword':
    'both arguments belong to whoever followed the link: the token answers reason: malformed and the password answers reason: password, and neither says anything about the account',
  'henri.addMiddleware':
    'says so and answers false, which is its documented contract',
  'henri.analyze': 'takes a module name and answers null for anything else',
  'henri.can': 'the one implementation is henri.policies.can, checked there',
  'henri.config.get':
    'HENRI_CONFIG_UNKNOWN_KEY already refuses anything that is not a key, and this is the one entry point called often enough for an allocation to matter',
  'henri.config.has': 'answers false for anything that is not a key',
  'henri.encryption.decrypt':
    'checked by hand in 1.encryption.js, with three typeofs and no allocation: the three adapters call it once per row per encrypted column, which is the one place a walk is not worth it',
  'henri.encryption.encrypt': 'the same, on the write path',
  'henri.encryption.isEnvelope': 'a total function of unknown',
  'henri.encryption.keyIdIn': 'a total function of unknown',
  'henri.gql': 'a tagged template that answers a string, whatever it is given',
  'henri.i18n.decide':
    'answers the default locale and source: default for anything that is not a request, which is what a caller asking about nothing should get',
  'henri.i18n.embed':
    'a view engine is the one caller and what it passes is what view() answered; anything else comes back untouched rather than failing a render',
  'henri.i18n.has': 'answers false for anything that is not a key it holds',
  'henri.i18n.supports':
    'answers false for anything that is not one of the locales this application has, which is what it is for',
  'henri.i18n.t':
    'guarded by hand with one typeof, because a page calls it once per string and walking a schema per string is a cost nobody asked for: HENRI_LOCALE_KEY_INVALID and HENRI_LOCALE_UNKNOWN are what it raises',
  'henri.i18n.view':
    'the router is the one caller and what it passes is what decide() answered; anything else answers null rather than failing a render for the sake of a locale',
  'henri.mailers.onDeliverLater':
    'says so and answers false, which is its documented contract',
  'henri.model.errors':
    'answers null for anything that is not a validation failure, which is its documented contract',
  'henri.model.publish':
    'its contract is anything: it is what res.render hands whatever a controller returned',
  'henri.params':
    'the helper behind req.permit(), whose fields are checked there; what it is given a request for is read with optional chaining and answers {}',
  'henri.pen': 'a logger that throws is worse than a wrong log line',
  'henri.policies.get': 'documented to answer null',
  'henri.policies.has': 'documented to answer false',
  'henri.policies.resolve': 'documented to answer null',
  'henri.policies.rule': 'documented to answer null',
  'henri.queries.onQuery':
    'says so and answers false, which is its documented contract, and the one it shares with henri.reporter.onError',
  'henri.queries.stats':
    'takes no argument: it reads counters back and there is nothing to get wrong',
  'henri.reporter.onError':
    'says so and answers false, which is its documented contract',
  'henri.reporter.report':
    'the one entry point that must not refuse: it runs on a failure path, so throwing would lose the failure it was called about. A wrong source is coerced and a wrong options is read as none, deliberately',
  'henri.telemetry.boot':
    'henri.init() is the one caller and what it passes is what henri.analyze() answered; anything else answers false rather than failing a boot for the sake of a span',
  'henri.telemetry.on':
    'answers false for anything that is not one of the boundaries, which is what a caller asking about a name henri does not know should get',
  'henri.trail.record':
    'HENRI_TRAIL_INVALID_EVENT and the meta refusals already say what is wrong',
  'henri.user.findByEmail':
    'the address is normalized to a string first and anything that is not one answers the null an unknown address answers, deliberately: a lookup that refuses one shape and answers another is how a probe learns what it holds',
  'henri.user.findById':
    'the identifier comes out of a session or a token, so it is the visitor s: it answers null for a malformed one, which is the 404 an unknown one answers',
  'henri.user.identityOf':
    'a total function of unknown, documented to answer null for a record that carries no externalId, which is what makes password binding degrade instead of failing',
  'henri.user.rehash':
    'documented to answer false rather than throw, and henri calls it on the sign-in path the moment a password verified: a refusal here would fail a sign-in that already succeeded',
  'henri.user.validatePassword':
    'documented never to throw: it is the verdict a registration form shows next to the box, so anything that is not a password is { valid: false, errors } and not a refusal',
  'henri.utils': 'node resolution answers for itself',
  'henri.versions.record':
    'the adapters call it once per row they write, which is the write path: it is a seam of henri s rather than an entry point of an application s, and what it is given is what a model hook already had in its hands',
  'henri.versions.watches':
    'a Map lookup that answers false for anything that is not a model keeping versions, which is what a caller asking about a name henri does not know should get',
  'req.authorize': 'the one implementation is henri.policies.authorize',
  'req.can': 'the one implementation is henri.policies.can',
  'req.file':
    '@usehenri/uploads ships it, and it answers null for anything that is not a field it holds',
  'req.logIn': "passport's, not henri's",
  'req.logOut': "passport's, not henri's",
  'req.logout': "passport's, not henri's",
  'req.permitFiles':
    '@usehenri/uploads ships it, and a package checks its own surface',
  'req.scope': 'the one implementation is henri.policies.scope',
  'req.setLocale':
    'refuses every locale the application has no catalogue for, by name and with HENRI_LOCALE_UNKNOWN, which is a better message than a schema walk would write',
  'req.t': 'the one implementation is henri.i18n.t, hand-guarded there',
  'res.hbs': "checked against res.render's signature, under its own name",
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
  PURPOSE,
  SIGNATURES,
  UNCHECKED,
  UNKNOWN,
  check,
  unknown,
};
