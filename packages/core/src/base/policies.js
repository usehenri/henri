/**
 * Record-level authorization: the pieces `3.policies.js` is built from.
 *
 * `roles` on a route answers "may this kind of person reach this endpoint".
 * A policy answers the other question, the one every application actually
 * has: "may *this* person read *this* proposal". It is a file next to the
 * model it is about (`app/policies/proposal.js`), one function per action,
 * taking the user and the record:
 *
 * ```js
 * // app/policies/proposal.js
 * module.exports = {
 *   index: (user) => Boolean(user),
 *   create: (user) => Boolean(user),
 *   show: (user, proposal) => proposal.state === 'published' || owns(user, proposal),
 *   update: (user, proposal) => owns(user, proposal),
 *   destroy: (user, proposal) => owns(user, proposal),
 * };
 * ```
 *
 * ## Failing closed
 *
 * Three things can go wrong, and the safe answer is the same for all three:
 * **no**.
 *
 * - a model with no policy: `henri.can()` answers false and says which file
 *   to write. It never falls back to the roles, and there is no "allow when
 *   undecided" setting to turn on.
 * - an action the policy does not mention: false. A policy that lists
 *   `update` and forgets `destroy` refuses `destroy`, and the `destroy`
 *   link disappears from the answers -- which is how you find out.
 * - a rule that throws: false, logged through `pen.error` with the policy
 *   and the action. An exception is never an allow.
 *
 * There is one more, quieter, way to get an accidental yes, and it is the
 * reason a rule has to return the boolean `true` and not merely something
 * truthy: `(user, post) => user.roles.find((role) => role === 'admin')`
 * returns a string for an admin and `undefined` for everybody else, and a
 * truthiness test would read the same for `'nope'`. Only `=== true` allows.
 *
 * ## Rules that need a record, and rules that do not
 *
 * `index`, `new` and `create` have no record to speak of; `show`, `edit`,
 * `update` and `destroy` do. henri tells them apart by what the rule
 * declares: **a rule that takes a second parameter is never asked without a
 * record.** `(user) => ...` is asked anywhere, `(user, proposal) => ...`
 * only where a record is in hand, and `(user, proposal = null) => ...` says
 * "ask me either way" -- the default is the author opting in.
 *
 * That one predicate is what lets the same policy answer the route gate (no
 * record yet), the `_links` of a HAL resource (a record in hand) and the
 * `paths` of a rendered page (no record) without a second vocabulary.
 */

/** Settings of `config.policies` when the key is absent */
const DEFAULTS = Object.freeze({ status: 404, verify: true });

/** The statuses a refusal may answer */
const STATUSES = [403, 404];

/**
 * Exports of a policy file that describe it instead of being actions.
 * `identity` and `globalId` are added by the loader.
 */
const RESERVED = new Set(['before', 'globalId', 'identity', 'scope']);

/**
 * The link relations henri builds itself, and the action each one is:
 * `record: false` is a question about the collection (asked without a
 * record), `record: true` a question about the one record in hand. `self`
 * is deliberately absent -- it names the representation the client is
 * already holding, not something it may do.
 */
const LINK_ACTIONS = Object.freeze({
  collection: { action: 'index', record: false },
  create: { action: 'create', record: false },
  destroy: { action: 'destroy', record: true },
  edit: { action: 'edit', record: true },
  new: { action: 'new', record: false },
  update: { action: 'update', record: true },
});

/** `<action>_<controller>_path`, the shape of every path helper */
const HELPER = /^([a-z_][a-z0-9_]*)_(.+)_path$/iu;

/**
 * Normalizes the `policies` configuration key
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {{status: number, verify: boolean}} the settings
 * @throws {TypeError} when `config.policies` is not an object
 */
function policiesConfig(config) {
  const settings = Object.assign({}, DEFAULTS);

  if (!config || typeof config.has !== 'function' || !config.has('policies')) {
    return settings;
  }

  const raw = config.get('policies');

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(
      'config.policies must be an object ({ status, verify })'
    );
  }

  if (STATUSES.includes(raw.status)) {
    settings.status = raw.status;
  }

  if (typeof raw.verify === 'boolean') {
    settings.verify = raw.verify;
  }

  return settings;
}

/**
 * A refusal, thrown by `req.authorize()` and by the HAL helpers.
 *
 * It carries the status the configuration asked for, so `base/http.js`
 * answers it the way it answers any other 4xx: the negotiated page or the
 * boom body. An anonymous visitor gets a 401 and, in a browser, the login
 * page: "log in and try again" is the useful answer and it leaks nothing.
 *
 * @class PolicyError
 * @extends {Error}
 */
class PolicyError extends Error {
  /**
   * Creates an instance of PolicyError.
   *
   * @param {object} options options
   * @param {string} options.action the action that was refused
   * @param {string} [options.policy] the policy that refused it
   * @param {number} [options.status=404] the status to answer
   * @param {?string} [options.redirect=null] where a browser should go instead
   * @memberof PolicyError
   */
  constructor({ action, policy = null, status = 404, redirect = null }) {
    super(
      status === 401
        ? 'Authentication required'
        : `Not allowed to ${action}${policy ? ` this ${policy}` : ''}`
    );

    this.name = 'PolicyError';
    this.code = 'POLICY_DENIED';
    this.action = action;
    this.policy = policy;
    this.status = status;
    this.statusCode = status;
    this.redirect = redirect;
  }
}

/**
 * The model a record belongs to, whichever ORM produced it.
 *
 * Mongoose and Drizzle both put the name on the constructor
 * (`modelName`), Sequelize keeps it in the model options; a plain object
 * that never went through a model has no answer, and the caller then has to
 * say which policy it meant.
 *
 * @param {*} record a model instance
 * @returns {?string} the model name, or null
 */
function identityOf(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const ctor = record.constructor;

  if (!ctor || typeof ctor !== 'function') {
    return null;
  }

  if (typeof ctor.modelName === 'string' && ctor.modelName.length > 0) {
    return ctor.modelName;
  }

  const named = ctor.options && ctor.options.name;

  if (named && typeof named.singular === 'string' && named.singular.length) {
    return named.singular;
  }

  if (typeof ctor.name === 'string' && ctor.name.length > 0) {
    return ctor.name === 'Object' ? null : ctor.name;
  }

  return null;
}

/**
 * Does this rule need a record to answer? (see the header)
 *
 * @param {*} rule a policy rule
 * @returns {boolean} true when it declares a record parameter
 */
function needsRecord(rule) {
  return typeof rule === 'function' && rule.length >= 2;
}

/**
 * Splits a path helper name into the action and the controller it names
 *
 * @param {string} helper the helper name (`edit_proposals_path`)
 * @returns {?{action: string, controller: string}} the parts, or null
 */
function parseHelper(helper) {
  const match = HELPER.exec(String(helper));

  return match ? { action: match[1], controller: match[2] } : null;
}

module.exports = {
  DEFAULTS,
  LINK_ACTIONS,
  PolicyError,
  RESERVED,
  STATUSES,
  identityOf,
  needsRecord,
  parseHelper,
  policiesConfig,
};
