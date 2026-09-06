const BaseModule = require('./base/module');

const path = require('path');
const debug = require('debug')('henri:policies');

const { loadModules } = require('./utils');
const { check, unknown } = require('./base/arguments');
const { fail } = require('./base/errors');
const { singularize } = require('./base/routes');
const { userConfig } = require('./base/auth');
const {
  LINK_ACTIONS,
  PolicyError,
  RESERVED,
  identityOf,
  needsRecord,
  parseHelper,
  policiesConfig,
} = require('./base/policies');

/**
 * Policies module: `henri.policies`, and the one question behind
 * `henri.can()`, `req.can()` and `req.authorize()`.
 *
 * `app/policies/*.js` is loaded the way `app/models` is -- one file per
 * model, named after it -- and every exported function is a rule for the
 * action of the same name. The rules of failing closed are in
 * `base/policies.js`; this module is the registry, the lookup and the three
 * things henri does with an answer:
 *
 * - **asking**: `can()` and `authorize()`, and nothing else. There is one
 *   way to ask, and it is the same one in a controller, in a route
 *   declaration, in a `before` hook and in a view's data.
 * - **narrowing what leaves**: `links()` and `paths()` drop what the reader
 *   may not follow. A page that cannot link where the reader may not go is
 *   what stops the leak, and it is where this feature earns its keep.
 * - **scoping**: `scope()` hands back what the policy said a list should be
 *   filtered by. henri never interprets the value.
 *
 * @class Policies
 * @extends {BaseModule}
 */
class Policies extends BaseModule {
  /**
   * Creates an instance of Policies.
   * @memberof Policies
   */
  constructor() {
    super();

    this.reloadable = true;
    this.needs = ['config'];
    // The router reads them while it registers the routes, and every
    // request afterwards
    this.before = ['router'];
    this.runlevel = 3;
    this.name = 'policies';
    this.henri = null;

    /** The policies loaded from app/policies, by model name (lowercased) */
    this._policies = new Map();
    /** What has already been said once, so a hot path warns once */
    this._warned = new Set();
    /** `config.policies`, normalized */
    this.settings = policiesConfig(null);

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.can = this.can.bind(this);
    this.authorize = this.authorize.bind(this);
    this.scope = this.scope.bind(this);
    this.links = this.links.bind(this);
    this.paths = this.paths.bind(this);
  }

  /**
   * Loads the policy files from disk
   *
   * @static
   * @async
   * @param {string} location defaults: ./app/policies
   * @returns {Promise<object>} the policies, by identity
   * @throws when a policy fails to load
   * @memberof Policies
   */
  static async load(location) {
    return loadModules(path.resolve(location), { keepDirectoryPath: true });
  }

  /**
   * Module initialization
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof Policies
   */
  async init() {
    const { pen } = this.henri;

    this.settings = policiesConfig(this.henri.config);

    const loaded = await Policies.load(
      path.join(this.henri.cwd(), 'app/policies')
    );

    for (const [identity, policy] of Object.entries(loaded)) {
      this._policies.set(identity, policy);
    }

    if (this._policies.size > 0) {
      pen.info(
        'policies',
        `${this._policies.size} loaded`,
        `a refusal answers ${this.settings.status}`
      );
    }

    debug('loaded %o', this.names());

    return this.name;
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Policies
   */
  async reload() {
    this._policies.clear();
    this._warned.clear();
    await this.init();

    return this.name;
  }

  /**
   * The names of the loaded policies
   *
   * @returns {Array<string>} the names
   * @memberof Policies
   */
  names() {
    return Array.from(this._policies.keys());
  }

  /**
   * How many policies the application ships
   *
   * @returns {number} the count
   * @memberof Policies
   */
  size() {
    return this._policies.size;
  }

  /**
   * The name of the policy a word means, or null when there is none.
   *
   * A model name and a controller name reach the same file: `Proposal` and
   * `proposals` are both `app/policies/proposal.js`. A namespace is kept --
   * `admin/proposals` is `app/policies/admin/proposal.js`, a different
   * controller with different actions -- so a policy is never borrowed
   * across one.
   *
   * @param {*} word a model, controller or policy name
   * @returns {?string} the policy name, or null
   * @memberof Policies
   */
  resolve(word) {
    if (typeof word !== 'string' || word.length === 0) {
      return null;
    }

    const bare = word.toLowerCase();

    if (this._policies.has(bare)) {
      return bare;
    }

    // Only the last segment is singularized: `admin/proposals` looks for
    // app/policies/admin/proposals.js and then admin/proposal.js, and never
    // borrows the policy of the `proposals` controller next door
    const parts = bare.split('/');

    parts[parts.length - 1] = singularize(parts[parts.length - 1]);

    const singular = parts.join('/');

    return this._policies.has(singular) ? singular : null;
  }

  /**
   * A policy by name
   *
   * @param {string} name the policy name
   * @returns {?object} the policy, or null
   * @memberof Policies
   */
  get(name) {
    const found = this.resolve(name);

    return found ? this._policies.get(found) : null;
  }

  /**
   * Is there a policy for this name?
   *
   * @param {string} name the policy name
   * @returns {boolean} yes or no
   * @memberof Policies
   */
  has(name) {
    return this.resolve(name) !== null;
  }

  /**
   * The rule a policy has for an action, or null
   *
   * @param {string} name the policy name
   * @param {string} action the action
   * @returns {?function} the rule, or null
   * @memberof Policies
   */
  rule(name, action) {
    const policy = this.get(name);

    if (!policy || typeof action !== 'string' || RESERVED.has(action)) {
      return null;
    }

    const found = policy[action];

    return typeof found === 'function' ? found : null;
  }

  /**
   * Says something once, however many requests reach it
   *
   * @param {string} key what is being said
   * @param {...string} args the arguments of `pen.warn`
   * @returns {boolean} true when it was said now
   * @memberof Policies
   */
  once(key, ...args) {
    if (this._warned.has(key)) {
      return false;
    }

    this._warned.add(key);
    this.henri.pen.warn('policies', ...args);

    return true;
  }

  /**
   * Which policy a call meant: what it said, then what the record is, then
   * what the route is about
   *
   * @param {*} record the record (may be null)
   * @param {object} [options={}] `{ policy, type }`
   * @returns {?string} the policy name, or null
   * @memberof Policies
   */
  nameFor(record, options = {}) {
    return (
      this.resolve(options.policy) ||
      this.resolve(identityOf(record)) ||
      this.resolve(options.type)
    );
  }

  /**
   * May this user take this action on this record?
   *
   * The one question. It answers `false` for everything it cannot answer
   * `true` for: no policy, no rule, a rule that needs a record it was not
   * given, a rule that threw, a rule that returned anything but the boolean
   * `true` (see base/policies.js).
   *
   * @async
   * @param {*} user the user (`req.user`), or null
   * @param {string} action the action (`update`)
   * @param {*} [record=null] the record, when there is one
   * @param {(object|string)} [options={}] `{ policy, type, req }`, or a policy name
   * @returns {Promise<boolean>} allowed or not
   * @memberof Policies
   */
  async can(user, action, record = null, options = {}) {
    check('henri.policies.can', [user, action, record, options]);

    return this.answer(user, action, record, options);
  }

  /**
   * The same question, unchecked: what henri asks itself.
   *
   * `links()` and `paths()` ask it once per link, with an action they read
   * out of a route helper and options they built themselves. Checking a
   * value henri produced, inside a loop henri wrote, is the one trade
   * `base/arguments.js` says not to make -- so the check lives on `can()`,
   * which is what an application calls, and this is the body they share.
   *
   * @async
   * @param {*} user the user (`req.user`), or null
   * @param {string} action the action (`update`)
   * @param {*} [record=null] the record, when there is one
   * @param {(object|string)} [options={}] `{ policy, type, req }`, or a name
   * @returns {Promise<boolean>} allowed or not
   * @memberof Policies
   */
  async answer(user, action, record = null, options = {}) {
    const opts = typeof options === 'string' ? { policy: options } : options;
    const name = this.nameFor(record, opts || {});
    const target = record === undefined ? null : record;

    if (!name) {
      const asked = (opts && (opts.policy || opts.type)) || identityOf(record);

      this.once(
        `missing:${asked || action}`,
        'no policy for',
        asked ? String(asked) : `"${action}" (nothing named what it is about)`,
        asked
          ? `write app/policies/${String(asked).toLowerCase()}.js, or henri generate policy ${asked}`
          : 'pass the model: henri.can(user, action, record)'
      );

      return false;
    }

    const policy = this._policies.get(name);
    const context = {
      action,
      henri: this.henri,
      policy: name,
      req: (opts && opts.req) || null,
      user: user || null,
    };

    try {
      if (typeof policy.before === 'function') {
        const early = await policy.before(user || null, target, context);

        if (early === true || early === false) {
          return early;
        }
      }

      const rule = this.rule(name, action);

      if (!rule) {
        this.once(
          `rule:${name}#${action}`,
          `the ${name} policy has no "${action}" rule: refused`,
          `add ${action}(user, record) to app/policies/${name}.js`
        );

        return false;
      }

      // A rule that declares a record is not asked without one: "may this
      // user update no particular proposal" has no useful yes
      if (target === null && needsRecord(rule)) {
        return false;
      }

      return (await rule(user || null, target, context)) === true;
    } catch (error) {
      // An exception is never an allow
      this.henri.pen.error(
        'policies',
        `${name}#${action} threw`,
        error && error.message ? error.message : String(error)
      );

      return false;
    }
  }

  /**
   * The same question, and a refusal when the answer is no.
   *
   * It resolves with the record, so a controller can read as one line:
   * `const proposal = await req.authorize('update', await Proposal.findById(id))`.
   *
   * @async
   * @param {*} user the user, or null
   * @param {string} action the action
   * @param {*} [record=null] the record
   * @param {object} [options={}] `{ policy, type, req, status }`
   * @returns {Promise<*>} the record
   * @throws {PolicyError} when the policy says no
   * @memberof Policies
   */
  async authorize(user, action, record = null, options = {}) {
    check('henri.policies.authorize', [user, action, record, options]);

    if (await this.answer(user, action, record, options)) {
      return record;
    }

    throw this.refusal(user, action, record, options);
  }

  /**
   * The error a refusal answers with.
   *
   * A signed-in user gets the configured status, 404 by default: a 403
   * tells whoever asked that the record is there, which is half of what
   * they wanted. An anonymous one gets a 401 and, in a browser, the login
   * page -- the role guard's answer, for the same reason.
   *
   * @param {*} user the user, or null
   * @param {string} action the action
   * @param {*} record the record
   * @param {object} [options={}] `{ policy, type, status }`
   * @returns {PolicyError} the error
   * @memberof Policies
   */
  refusal(user, action, record, options = {}) {
    const opts = typeof options === 'string' ? { policy: options } : options;
    const name = this.nameFor(record, opts || {});
    const anonymous = !user;
    const status =
      (options && options.status) || (anonymous ? 401 : this.settings.status);

    return new PolicyError({
      action,
      policy: name,
      redirect: anonymous ? userConfig(this.henri.config).loginPath : null,
      status,
    });
  }

  /**
   * What a list of records should be filtered by, for this user.
   *
   * The other half of the question: "may this person see this record" one
   * row at a time is not "which records may they see". A policy answers it
   * with a `scope(user, context)` export, and henri hands the value back
   * untouched -- it is a `where` for the ORM the application chose, and
   * henri never builds a query. A policy without one throws rather than
   * quietly meaning "everything".
   *
   * @async
   * @param {*} user the user, or null
   * @param {string} name the policy (or model, or controller) name
   * @param {object} [context={}] anything the scope needs (`{ req }`)
   * @returns {Promise<*>} whatever the policy returned
   * @throws {TypeError} when there is no policy, or it declares no scope
   * @memberof Policies
   */
  async scope(user, name, context = {}) {
    check('henri.policies.scope', [user, name, context]);

    const found = this.resolve(name);

    if (!found) {
      throw unknown('henri.policies.scope', 'name', name, this.names());
    }

    const policy = this._policies.get(found);

    if (typeof policy.scope !== 'function') {
      throw fail(
        'HENRI_POLICY_SCOPE_REQUIRED',
        `the ${found} policy declares no scope(user): add it to ` +
          `app/policies/${found.toLowerCase()}.js, or filter the list in the ` +
          'controller -- henri will not guess what "everything they may ' +
          'see" is, and `scope: () => ({})` is how a policy says everything'
      );
    }

    return policy.scope(user || null, {
      action: 'scope',
      henri: this.henri,
      policy: found,
      req: context.req || null,
      user: user || null,
      ...context,
    });
  }

  /**
   * Drops the links a policy would refuse.
   *
   * `_links` are already filtered by role; this is the same filter, one
   * level down, where the record is in hand. `self` is left alone: it names
   * the representation the client is holding, not something it may do, and
   * the links an application added itself are left alone too -- henri does
   * not know what action they are.
   *
   * @async
   * @param {*} user the user, or null
   * @param {object} links the HAL links
   * @param {*} record the record they are about (null for a collection)
   * @param {object} [options={}] `{ type, req, cache }`
   * @returns {Promise<object>} the links the user may follow
   * @memberof Policies
   */
  async links(user, links, record, options = {}) {
    check('henri.policies.links', [user, links, record, options]);

    const name = this.nameFor(record, options);

    if (!name || !links) {
      return links;
    }

    const cache = options.cache instanceof Map ? options.cache : null;
    const out = {};

    for (const [rel, value] of Object.entries(links)) {
      const known = LINK_ACTIONS[rel];

      if (!known) {
        out[rel] = value;
        continue;
      }

      const key = `${name}#${known.action}`;
      let allowed;

      if (!known.record && cache && cache.has(key)) {
        allowed = cache.get(key);
      } else {
        allowed = await this.answer(
          user,
          known.action,
          known.record ? record : null,
          { policy: name, req: options.req || null }
        );

        !known.record && cache && cache.set(key, allowed);
      }

      if (allowed) {
        out[rel] = value;
      }
    }

    return out;
  }

  /**
   * Drops the path helpers a policy would refuse.
   *
   * These are the `paths` a rendered page receives, and there is no record
   * here: only the rules that answer without one are asked, which is why a
   * `show` rule taking a proposal never removes `show_proposals_path`. That
   * question is answered where the record is, on its own `_links`.
   *
   * A controller with no policy is not asked about at all, so an
   * application that ships none sees exactly the table the roles built.
   *
   * @async
   * @param {*} user the user, or null
   * @param {object} paths the path helpers (see Router.pathForRoles)
   * @param {object} [options={}] `{ req }`
   * @returns {Promise<object>} the paths the user may follow
   * @memberof Policies
   */
  async paths(user, paths, options = {}) {
    check('henri.policies.paths', [user, paths, options]);

    if (this._policies.size === 0 || !paths) {
      return paths;
    }

    const cache = new Map();
    const out = {};

    for (const [helper, value] of Object.entries(paths)) {
      const parsed = parseHelper(helper);
      const name = parsed && this.resolve(parsed.controller);

      if (!name) {
        out[helper] = value;
        continue;
      }

      const rule = this.rule(name, parsed.action);

      // Undecidable without the record: the record's own _links answer it
      if (rule && needsRecord(rule)) {
        out[helper] = value;
        continue;
      }

      const key = `${name}#${parsed.action}`;

      if (!cache.has(key)) {
        cache.set(
          key,
          await this.answer(user, parsed.action, null, {
            policy: name,
            req: options.req || null,
          })
        );
      }

      if (cache.get(key)) {
        out[helper] = value;
      }
    }

    return out;
  }

  /**
   * Stops the module
   *
   * @async
   * @static
   * @returns {(string|boolean)} Module name or false
   * @memberof Policies
   */
  static async stop() {
    return false;
  }
}

module.exports = Policies;
