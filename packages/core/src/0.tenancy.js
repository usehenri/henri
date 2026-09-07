const { AsyncLocalStorage } = require('node:async_hooks');

const BaseModule = require('./base/module');

const debug = require('debug')('henri:tenancy');

const { check } = require('./base/arguments');
const {
  TenantError,
  markOf,
  normalizeTenant,
  subdomainOf,
  tenancyConfig,
  tenantOfUser,
  trusts,
} = require('./base/tenancy');
const { fail } = require('./base/errors');
const { userConfig } = require('./base/auth');

/**
 * Starts a lazy thenable inside the context that is open right now.
 *
 * Mongoose's `Model.find()` answers a `Query`, which runs nothing until
 * somebody awaits it -- so `run(tenant, () => Invoice.find())` would build
 * the query inside the context and execute it outside, where there is no
 * tenant and the refusal fires. Touching `then` here starts it while the
 * context is still open, and the continuations inherit it. Everything the
 * other two adapters answer is already a promise, and this is a no-op for
 * a plain value.
 *
 * @param {*} result whatever the work answered
 * @returns {*} the same thing, started
 */
const settled = (result) =>
  result && typeof result.then === 'function'
    ? Promise.resolve(result)
    : result;

/**
 * `henri.tenancy`: which tenant this is, and the refusal when nobody said.
 *
 * The design -- why a column and not a schema, why a tenant is a scope and
 * not a permission, where the value comes from and in what order -- is in
 * the header of `base/tenancy.js`. This is the module: it holds the marks
 * the models declared, the async context the value lives in, the one
 * middleware that decides a request's tenant, and the question every
 * adapter asks before it builds a query.
 *
 * It sits at **runlevel 0**, with the configuration, for the reason the
 * query seam does: everything that installs anything is above it. The three
 * adapters ask `henri.tenancy.enabled` while they are building their models
 * at runlevel 3 and install nothing when the answer is no, and a model call
 * made during a boot -- a seed, an `init()` of an application module -- finds
 * the context already there rather than a module that has not started.
 *
 * **Off costs nothing, and off is the default.** No `config.tenancy` means
 * `enabled` false, no column added to any model, no condition compiled, no
 * middleware mounted and no boot line. The precedent is the call log and the
 * version store, which mount nothing when nobody asked.
 *
 * ## The three answers this module gives
 *
 * - `current()` -- the tenant of whatever is running, or null.
 * - `conditionFor(model)` -- what an adapter must add, `{ column, tenant }`,
 *   or null when it must add nothing. **This is the one that refuses**: on a
 *   marked model, outside `unscoped()`, with no tenant, it raises
 *   `HENRI_TENANT_REQUIRED` rather than answering "no condition", because
 *   "no condition" on a tenanted table is every tenant's rows.
 * - `checkWrite(model, values)` -- what an adapter must stamp, and the
 *   refusal when the values name another tenant.
 *
 * @class Tenancy
 * @extends {BaseModule}
 */
class Tenancy extends BaseModule {
  /**
   * Creates an instance of Tenancy.
   * @memberof Tenancy
   */
  constructor() {
    super();

    this.reloadable = true;
    this.needs = ['config'];
    // Ordering only, and the same list the query seam uses: the models read
    // the marks while they build, the router mounts the middleware, and an
    // application that turned this off has all three run unchanged
    this.before = ['model', 'router', 'server'];
    this.runlevel = 0;
    this.name = 'tenancy';
    this.henri = null;

    /** `config.tenancy`, normalized */
    this.settings = tenancyConfig(null);
    /** Whether an application asked for any of this */
    this.enabled = false;
    /** What each model said, by model name (`Invoice`) */
    this.marks = new Map();
    /** Where the tenant of the running work lives */
    this.context = new AsyncLocalStorage();

    this._mounted = false;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.current = this.current.bind(this);
    this.source = this.source.bind(this);
    this.run = this.run.bind(this);
    this.unscoped = this.unscoped.bind(this);
    this.require = this.require.bind(this);
    this.markFor = this.markFor.bind(this);
    this.conditionFor = this.conditionFor.bind(this);
    this.checkWrite = this.checkWrite.bind(this);
    this.resolve = this.resolve.bind(this);
    this.refuses = this.refuses.bind(this);
    this.middleware = this.middleware.bind(this);

    debug('constructor initialized');
  }

  /**
   * Module initialization: reads the configuration and says what it means
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @throws HENRI_TENANT_HEADER_UNVERIFIABLE on a header nobody may set
   * @memberof Tenancy
   */
  async init() {
    const { config, pen } = this.henri;

    this.settings = tenancyConfig(config);
    this.enabled = this.settings.enabled;
    this.marks = new Map();
    this._mounted = false;

    if (!this.enabled) {
      debug('off: no config.tenancy');

      return this.name;
    }

    pen.info(
      'tenancy',
      `on, from ${this.sources().join(', ')}`,
      `a query on a tenanted model without one is refused${
        this.settings.require ? '; a request without one is too' : ''
      }`
    );

    return this.name;
  }

  /**
   * Rebuilds the module after a reload
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @memberof Tenancy
   */
  async reload() {
    return this.init();
  }

  /**
   * The sources a request's tenant may come from, in the order they are
   * asked. `explicit` is always one of them and is never configured.
   *
   * @returns {Array<string>} the source names
   * @memberof Tenancy
   */
  sources() {
    const { from } = this.settings;
    const named = [
      from.user && 'user',
      from.subdomain && 'subdomain',
      from.header && 'header',
    ].filter(Boolean);

    return ['explicit', ...named];
  }

  /**
   * The tenant of whatever is running, or null.
   *
   * Null outside a request and outside `run()`: henri does not guess, which
   * is the whole point -- a job, a console session and a seed all answer
   * null here and are refused by `conditionFor()` a moment later.
   *
   * @returns {?string} the tenant, or null
   * @memberof Tenancy
   */
  current() {
    const store = this.context.getStore();

    return (store && store.tenant) || null;
  }

  /**
   * How the tenant of the running work was decided
   *
   * @returns {?string} one of SOURCES, or null when there is no tenant
   * @memberof Tenancy
   */
  source() {
    const store = this.context.getStore();

    return (store && store.source) || null;
  }

  /**
   * Whether the running work is deliberately unscoped
   *
   * @returns {boolean} yes or no
   * @memberof Tenancy
   */
  isUnscoped() {
    const store = this.context.getStore();

    return Boolean(store && store.unscoped);
  }

  /**
   * Runs something as a tenant.
   *
   * An async context rather than a setting, so two jobs running at the same
   * time in one process never claim each other's tenant --
   * `henri.encryption.tolerate()` and `henri.versions.acting()` are the same
   * shape and the same argument.
   *
   * This is what a job does with the tenant its arguments carried, what a
   * console session does before it looks at one customer, and what a
   * recurring sweep does once per tenant.
   *
   * @param {(string|object)} tenant the tenant, or a record carrying it
   * @param {function} work what to run
   * @returns {*} whatever the work answered
   * @throws HENRI_TENANT_INVALID on a value that cannot be a tenant
   * @memberof Tenancy
   */
  run(tenant, work) {
    check('henri.tenancy.run', [tenant, work]);

    const value = normalizeTenant(
      tenant && typeof tenant === 'object'
        ? tenant[this.settings.column]
        : tenant,
      'the tenant henri.tenancy.run() was given'
    );

    if (!value) {
      throw fail(
        'HENRI_TENANT_INVALID',
        'henri.tenancy.run() was given nothing to be. Pass the tenant, or say henri.tenancy.unscoped() when every tenant is what you mean'
      );
    }

    return this.context.run({ source: 'explicit', tenant: value }, () =>
      settled(work())
    );
  }

  /**
   * Runs something across every tenant, deliberately.
   *
   * The one way past the refusal, and it is not a setting: a report that
   * counts every customer, a migration, a `db:seed`, the framework's own
   * reads of the user table. It is a context so that it covers exactly the
   * call it wraps and nothing that runs next to it.
   *
   * @param {function} work what to run
   * @returns {*} whatever the work answered
   * @memberof Tenancy
   */
  unscoped(work) {
    check('henri.tenancy.unscoped', [work]);

    return this.context.run(
      { source: null, tenant: null, unscoped: true },
      () => settled(work())
    );
  }

  /**
   * The tenant, or a refusal
   *
   * @param {string} [why='this'] what wanted one, for the message
   * @returns {string} the tenant
   * @throws HENRI_TENANT_REQUIRED when there is none
   * @memberof Tenancy
   */
  require(why = 'this') {
    const tenant = this.current();

    if (tenant) {
      return tenant;
    }

    throw fail(
      'HENRI_TENANT_REQUIRED',
      `${why} needs a tenant and nothing in scope names one. Inside a request henri decides it (${this.sources().join(
        ', '
      )}); outside one -- a job, a seed, the console -- say which with henri.tenancy.run(tenant, () => ...), or henri.tenancy.unscoped(() => ...) when every tenant is what you mean`
    );
  }

  /**
   * What a model said about tenants, remembered.
   *
   * The adapters ask this once per model while they build, and once per
   * call afterwards, so it is a Map lookup and not a walk of the options.
   *
   * @param {object} model a model file (`{ globalId, options, schema }`)
   * @returns {?object} `{ column, declared }`, or null
   * @throws HENRI_TENANT_INVALID_MARK, HENRI_TENANT_UNKNOWN_COLUMN
   * @memberof Tenancy
   */
  markFor(model) {
    if (!this.enabled || !model) {
      return null;
    }

    const name = model.globalId || model.identity;
    const known = this.marks.get(name);

    if (typeof known !== 'undefined') {
      return known;
    }

    const mark = markOf(model, this.settings);

    // The user model is where the tenant comes *from*, so it cannot be a
    // thing the tenant filters: a sign-in reads the user table before any
    // request has a tenant, and a scoped `findUserByEmail` would answer
    // "no such account" to everybody. The tenant is a plain column on the
    // user model, which is what `tenancy.from.user` names, and the guide
    // says so; refusing here is a failed boot rather than an application
    // where nobody can sign in
    if (mark && name && name.toLowerCase() === this.userModel()) {
      throw fail(
        'HENRI_TENANT_INVALID_MARK',
        `${name} is the user model and says options.tenant, and the user model is where the tenant comes from: a sign-in reads it before any request has a tenant, so scoping it would answer "no such account" to everyone. Declare ${this.settings.from.user || 'tenantId'} in its schema as an ordinary column instead -- that is what tenancy.from.user reads`
      );
    }

    if (name) {
      this.marks.set(name, mark);
    }

    return mark;
  }

  /**
   * The mark an adapter passed, when it passed one
   *
   * @param {object} options what `conditionFor`/`checkWrite` was given
   * @returns {?object} `{ column }`, or null
   * @memberof Tenancy
   */
  told(options) {
    return options && typeof options.column === 'string'
      ? { column: options.column }
      : null;
  }

  /**
   * The name of the user model, lowercased
   *
   * @returns {string} the name
   * @memberof Tenancy
   */
  userModel() {
    return userConfig(this.henri && this.henri.config).model.toLowerCase();
  }

  /**
   * The condition an adapter must add to a query, or nothing.
   *
   * **This is where the default is the safe one.** Three answers and only
   * three: `null` when nothing should be added (tenancy off, an unmarked
   * model, or `unscoped()`), `{ column, tenant }` when it should, and a
   * throw when the model is a tenant's and nobody said which. There is no
   * fourth answer where a tenanted table is read without a condition, and
   * there is no setting that adds one.
   *
   * The **adapter's** mark is authoritative when it passes one. It built
   * the model, it holds the column, and it asks only about a model that
   * carries one -- while this module's own table is rebuilt from scratch by
   * a reload, which would otherwise leave a window where a model that is
   * still scoped asks a module that has forgotten it and gets `null` back.
   * `null` there is an unscoped read, so it is not a window worth having.
   *
   * @param {string} model the model name (`Invoice`)
   * @param {object} [options={}] `column` (what the adapter knows) and
   *   `operation` (for the message)
   * @returns {?object} `{ column, tenant }`, or null
   * @throws HENRI_TENANT_REQUIRED on a tenanted model with no tenant
   * @memberof Tenancy
   */
  conditionFor(model, options = {}) {
    if (!this.enabled) {
      return null;
    }

    const mark = this.marks.get(model) || this.told(options);

    if (!mark) {
      return null;
    }

    if (this.isUnscoped()) {
      return null;
    }

    const tenant = this.current();

    if (!tenant) {
      const what = options.operation
        ? `${model}.${options.operation}()`
        : model;

      throw fail(
        'HENRI_TENANT_REQUIRED',
        `${what} is a tenant's (options.tenant on ${model}) and nothing in scope says which tenant. henri does not read a tenanted table without a condition, because no condition is every tenant's rows. Inside a request henri decides it (${this.sources().join(
          ', '
        )}); outside one say which with henri.tenancy.run(tenant, () => ...), or henri.tenancy.unscoped(() => ...) when every tenant is what you mean`
      );
    }

    return { column: mark.column, tenant };
  }

  /**
   * What a write must carry, and the refusal when it names another tenant.
   *
   * A create is stamped with the current tenant. A create or an update that
   * *names* the column is checked against it and refused when they differ:
   * moving a row from one tenant to another is not something henri makes
   * easy, because a mistyped identifier there is a permanent leak rather
   * than a failed request. `unscoped()` is where that is done deliberately.
   *
   * @param {string} model the model name
   * @param {object} values the attributes being written
   * @param {object} [options={}] `operation`, `create`
   * @returns {?object} `{ column, tenant }` to stamp, or null
   * @throws HENRI_TENANT_REQUIRED, HENRI_TENANT_CROSS_WRITE
   * @memberof Tenancy
   */
  checkWrite(model, values, options = {}) {
    if (!this.enabled) {
      return null;
    }

    const mark = this.marks.get(model) || this.told(options);

    if (!mark) {
      return null;
    }

    const named =
      values &&
      typeof values === 'object' &&
      Object.prototype.hasOwnProperty.call(values, mark.column)
        ? normalizeTenant(
            values[mark.column],
            `the ${mark.column} written on a ${model}`
          )
        : null;

    if (this.isUnscoped()) {
      return null;
    }

    const tenant = this.current();

    if (!tenant) {
      const what = options.operation
        ? `${model}.${options.operation}()`
        : model;

      throw fail(
        'HENRI_TENANT_REQUIRED',
        `${what} writes to a tenant's table (options.tenant on ${model}) and nothing in scope says which tenant. Say which with henri.tenancy.run(tenant, () => ...), or henri.tenancy.unscoped(() => ...) when you mean to write across tenants`
      );
    }

    if (named && named !== tenant) {
      throw fail(
        'HENRI_TENANT_CROSS_WRITE',
        `a ${model} was written with ${mark.column} '${named}' while the tenant in scope is '${tenant}'. henri refuses rather than obeying: a row written into another tenant is a leak that no later request will notice. Run the write inside henri.tenancy.run('${named}', () => ...) when that is what it means`
      );
    }

    return { column: mark.column, tenant };
  }

  /**
   * The tenant of a request, and how it was decided.
   *
   * One place, `SOURCES` order, and the cross-check that makes a
   * client-named tenant a confirmation rather than an election.
   *
   * @param {object} req the request
   * @param {*} [who] the user, when it is not (yet) `req.user`
   * @returns {object} `{ source, tenant }`
   * @throws {TenantError} HENRI_TENANT_MISMATCH when the two disagree
   * @memberof Tenancy
   */
  resolve(req, who) {
    const { from, status } = this.settings;
    const said = req && req._henriTenant;

    if (said && said.tenant) {
      return said;
    }

    const mine = tenantOfUser(
      typeof who === 'undefined' ? req && req.user : who,
      from.user
    );
    const claimed = this.claimed(req);

    // A signed-in person's own record wins, and what the request named is
    // only ever allowed to agree with it. Refusing rather than ignoring is
    // the point: a link that quietly serves another tenant's page from this
    // tenant's data is how a boundary stops being one
    if (mine && claimed.tenant && claimed.tenant !== mine) {
      throw new TenantError({
        code: 'HENRI_TENANT_MISMATCH',
        message: `the request names the tenant '${claimed.tenant}' (${claimed.source}) and the signed-in user belongs to '${mine}'`,
        status,
      });
    }

    if (mine) {
      return { source: 'user', tenant: mine };
    }

    return claimed;
  }

  /**
   * Would this user be refused on this request?
   *
   * The half of `resolve()` a sign-in needs. `POST /login` is the one
   * request where `req.user` appears *after* the middleware ran, so the
   * check has to be made again once passport has authenticated -- and
   * answering it there means signing in on the wrong subdomain opens no
   * session, rather than one that dies on its next request.
   *
   * @param {object} req the request
   * @param {*} user the user that just authenticated
   * @returns {?TenantError} the refusal, or null
   * @memberof Tenancy
   */
  refuses(req, user) {
    if (!this.enabled) {
      return null;
    }

    try {
      this.resolve(req, user);
    } catch (error) {
      return error instanceof TenantError ? error : null;
    }

    return null;
  }

  /**
   * What the request itself named, in `SOURCES` order
   *
   * @param {object} req the request
   * @returns {object} `{ source, tenant }`
   * @memberof Tenancy
   */
  claimed(req) {
    const { from } = this.settings;
    const none = { source: null, tenant: null };

    if (!req) {
      return none;
    }

    const label = from.subdomain
      ? subdomainOf(req.get && req.get('host'), from.subdomain)
      : null;

    if (label) {
      return { source: 'subdomain', tenant: normalizeTenant(label) };
    }

    if (from.header && trusts(req, from.header)) {
      const sent = req.get && req.get(from.header.name);
      const tenant = sent
        ? normalizeTenant(sent, `the ${from.header.name}`)
        : null;

      if (tenant) {
        return { source: 'header', tenant };
      }
    }

    return none;
  }

  /**
   * The middleware that decides the tenant of a request.
   *
   * It is one function and it runs once, after passport (so `req.user` is
   * there) and before the router (so an action, a policy, a `before` hook
   * and every model call underneath them all see the same answer). It opens
   * the async context for the rest of the request, which is what lets
   * `record.save()` four calls deep in a service carry a tenant nobody
   * passed down.
   *
   * @returns {function} the express middleware
   * @memberof Tenancy
   */
  middleware() {
    const { require: mandatory, status } = this.settings;

    return (req, res, next) => {
      let decided;

      try {
        decided = this.resolve(req);
      } catch (error) {
        return next(error);
      }

      req.tenant = decided.tenant;
      req.tenantSource = decided.source;
      req.setTenant = (tenant) => {
        const value = normalizeTenant(
          tenant,
          'the tenant req.setTenant() was given'
        );

        req._henriTenant = { source: 'explicit', tenant: value };
        req.tenant = value;
        req.tenantSource = 'explicit';

        return value;
      };

      if (mandatory && !decided.tenant) {
        return next(
          new TenantError({
            code: 'HENRI_TENANT_UNRESOLVED',
            message: 'no tenant could be decided for this request',
            status,
          })
        );
      }

      return this.context.run(decided, next);
    };
  }

  /**
   * Mounts the middleware, once, and only when an application asked
   *
   * @param {object} server the server module
   * @returns {boolean} whether it was mounted by this call
   * @memberof Tenancy
   */
  mount(server) {
    if (this._mounted || !this.enabled || !server || !server.app) {
      return false;
    }

    server.app.use(this.middleware());
    this._mounted = true;

    return true;
  }

  /**
   * The models that carry a mark, and the column each one uses
   *
   * @returns {object} `{ [model]: column }`
   * @memberof Tenancy
   */
  map() {
    const out = {};

    for (const [model, mark] of this.marks) {
      if (mark) {
        out[model] = mark.column;
      }
    }

    return out;
  }

  /**
   * Stops the module
   *
   * @async
   * @static
   * @returns {Promise<boolean>} false: there is nothing to stop
   * @memberof Tenancy
   */
  static async stop() {
    return false;
  }
}

module.exports = Tenancy;
