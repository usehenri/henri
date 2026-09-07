/**
 * Multi-tenancy: one column, one ambient value, and a refusal when there
 * is none.
 *
 * ## The three ways to be multi-tenant, and the one henri picked
 *
 * There are three, and they are not variations of one thing:
 *
 * 1. **a column on every row** (`tenantId`), with a condition henri adds to
 *    every query it builds;
 * 2. **a schema, or a database, per tenant**, chosen per request;
 * 3. **a process per tenant**, which is a deployment and not a framework
 *    feature.
 *
 * henri picked the first, and the reason is the model layer rather than a
 * preference. henri's models are one contract over three ORMs on five
 * databases (`HenriAdapter`), and a per-tenant schema is not one thing
 * across them: on PostgreSQL it is a `search_path`, on MySQL a database
 * name, on MongoDB a connection, and on sqlite a file. Each of those is a
 * *connection* decision, and a henri store opens one pool at boot -- so
 * option 2 means a pool per tenant, a migration run per tenant, and a
 * `henri db:migrate` whose blast radius is the number of customers. It buys
 * a boundary the database itself enforces, which is a real thing to want and
 * which this does not give you; the guide says so and says who should reach
 * for it. Option 3 is a compose file and henri has nothing to add to it.
 *
 * A column also **rhymes with what henri already has**, which is the second
 * half of the argument: `policy.scope(user)` is already "the list is what
 * the policy says it is", `options.paranoid` already adds a condition to
 * every read henri builds, and `@usehenri/webhooks` already gives every
 * endpoint an `owner` that an `emit` filters by. A tenant is a scope, and
 * henri had the shape for one.
 *
 * ## A tenant is a scope and not a permission
 *
 * This is the sentence to read twice. Narrowing to a tenant does **not**
 * grant anything: it only ever removes rows. What a person may do with the
 * rows that are left is the policies' question and stays the policies'
 * question, exactly the way `req.filters()` intersects a client's condition
 * with `policy.scope(user)` and can therefore narrow a list and never widen
 * one. That is what makes it safe for an anonymous visitor to name a tenant
 * with a subdomain: they get that tenant's rows filtered by a policy that
 * has never heard of tenants, which for an anonymous visitor is usually
 * nothing at all.
 *
 * ## The default is the refusal
 *
 * A model says it belongs to a tenant with `options: { tenant: true }`, and
 * from then on every read and every write henri builds for it carries the
 * condition. When there is **no tenant in context**, henri does not fall
 * back to "all of them": it raises `HENRI_TENANT_REQUIRED` and names the
 * model. That is `HENRI_POLICY_SCOPE_REQUIRED`'s instinct -- a policy
 * without a `scope` throws rather than quietly meaning everything -- applied
 * one layer down, and it is what makes a job, a seed, a console session and
 * a forgotten `await` fail loudly instead of reading somebody else's rows.
 *
 * There is exactly one way past it and it is not a setting:
 * `henri.tenancy.unscoped(fn)`, an async context, the shape of
 * `henri.encryption.tolerate()` and `henri.versions.acting()`. An
 * application that means "every tenant" says so, in one place, around the
 * call that means it.
 *
 * A model that says nothing is **shared**: a `Country`, a `Plan`, a
 * `Currency`. henri does not guess that a model belongs to a tenant, and
 * `henri audit` reports the models carrying no mark once an application has
 * turned tenancy on, so the list of shared models is a decision somebody
 * made rather than a list nobody read.
 *
 * ## Where the tenant comes from
 *
 * In one place, and visibly. `req.tenant` is the value and
 * `req.tenantSource` is *how it was decided*, the way `req.localeSource`
 * and the call log's `ip_source` already say how their answer was reached.
 * The order is fixed in code (`SOURCES`), a source is on when it is
 * configured, and it goes:
 *
 * | source      | what it reads                                      |
 * | ----------- | -------------------------------------------------- |
 * | `explicit`  | `req.setTenant()`, or `henri.tenancy.run()`        |
 * | `user`      | the column `tenancy.from.user` names on `req.user` |
 * | `subdomain` | the label in front of `tenancy.from.subdomain`     |
 * | `header`    | `tenancy.from.header.name`, from a listed proxy    |
 *
 * **The path prefix is deliberately not on that list**, and it is the same
 * refusal `base/i18n.js` makes for the same reason: henri's route table is
 * the source of both the url and the helper that prints it, so a tenant in
 * the path is a change to every route helper of the application rather than
 * one more rule here. An application that wants `/acme/invoices` mounts it
 * itself and calls `req.setTenant()`, which is the `explicit` source and is
 * checked against the user's own record exactly like the other two.
 *
 * The user's own record is second and everything a client can name is below
 * it, which is the whole of the security argument: **for a signed-in person
 * a client-named tenant is a confirmation, never an election.** When the
 * request named one and the user belongs to another, the request is refused
 * (`HENRI_TENANT_MISMATCH`) rather than served from either -- a tenant a
 * request can pick freely is an authorization bug with extra steps.
 *
 * The header is the one source that cannot verify itself, so it follows the
 * rule `config.calls.address` already set: a header without a `from` naming
 * the proxies allowed to set it **fails the boot**
 * (`HENRI_TENANT_HEADER_UNVERIFIABLE`), because any client can send a header
 * and believing one unconditionally is the same as having no boundary.
 *
 * @module base/tenancy
 */

const { isIP } = require('node:net');

const { normalize, trustedProxies } = require('./address');
const { fail } = require('./errors');

/** Settings of `config.tenancy` when the key is absent */
const DEFAULTS = Object.freeze({
  column: 'tenantId',
  enabled: false,
  from: Object.freeze({
    header: null,
    subdomain: null,
    user: 'tenantId',
  }),
  require: false,
  status: 404,
});

/**
 * How the tenant of a request was decided, in the order they are asked.
 *
 * `explicit` first because somebody said so; `user` second because it is
 * the only one a client cannot write; everything a client *can* write after
 * it, and only ever as a confirmation.
 */
const SOURCES = Object.freeze(['explicit', 'user', 'subdomain', 'header']);

/** The sources a client can name, and which are therefore cross-checked */
const CLIENT_NAMED = Object.freeze(['subdomain', 'header']);

/**
 * How long a tenant may be: the width of the column it is indexed in.
 *
 * The same 190 `@usehenri/webhooks` gives an `owner`, and for the same
 * reason -- it is what MySQL indexes in a `utf8mb4` key.
 */
const MAX_TENANT = 190;

/** What a tenant identifier may look like: an opaque, printable token */
const TENANT = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u;

/** The statuses a tenancy refusal may answer, the policies' two */
const STATUSES = Object.freeze([403, 404]);

/**
 * A request refused because of the tenant it named.
 *
 * It carries a status the way `PolicyError` does, and it says as little:
 * a body naming the tenant that was expected is the boundary spelled out
 * in the answer.
 *
 * @class TenantError
 * @extends {Error}
 */
class TenantError extends Error {
  /**
   * Creates an instance of TenantError.
   *
   * @param {object} [options={}] `code`, `message`, `status`
   * @memberof TenantError
   */
  constructor(options = {}) {
    super(options.message || 'Not allowed on this tenant');

    this.name = 'TenantError';
    this.code = options.code || 'HENRI_TENANT_MISMATCH';
    this.isHenriTenant = true;
    this.status = STATUSES.includes(options.status) ? options.status : 404;
    this.statusCode = this.status;
    // `PolicyError`'s rule, for `PolicyError`'s reason: a 404 that says
    // which tenant it expected is the boundary spelled out in the body,
    // which is what the 404 was chosen to hide. The log line keeps it
    this.expose = this.status !== 404;
  }
}

/**
 * Is this a plain object?
 *
 * @param {*} value anything
 * @returns {boolean} yes or no
 */
const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * The tenant a value means, or null.
 *
 * A tenant is an opaque string and henri never interprets it: whether it
 * holds an account's `externalId`, a slug or a customer number is the
 * application's business, exactly the way `policy.scope()`'s answer and a
 * webhook endpoint's `owner` are. What henri does check is that it can go
 * into an indexed column and come back the same.
 *
 * @param {*} value anything
 * @param {string} [where='the tenant'] what to call it in a failure
 * @returns {?string} the tenant, or null when there is none
 * @throws HENRI_TENANT_INVALID when the value cannot be a tenant
 */
function normalizeTenant(value, where = 'the tenant') {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  const tenant = typeof value === 'string' ? value : String(value);

  if (tenant.length > MAX_TENANT) {
    throw fail(
      'HENRI_TENANT_INVALID',
      `${where} is ${tenant.length} characters and at most ${MAX_TENANT} fit in the column it is indexed in. An identifier is never truncated to fit: two tenants sharing a prefix would share their rows`
    );
  }

  if (!TENANT.test(tenant)) {
    throw fail(
      'HENRI_TENANT_INVALID',
      `${where} is not an identifier henri can put in a column: it must start with a letter or a digit and hold only letters, digits and ".", "_", ":", "@", "+" or "-"`
    );
  }

  return tenant;
}

/**
 * Normalizes `config.tenancy.from.header`.
 *
 * The rule `config.calls.address` already set, for the same reason: any
 * client can send a header, so henri believes a named one only from a proxy
 * the application listed, and a header with nobody allowed to set it fails
 * the boot rather than opening the door.
 *
 * @param {*} raw what the configuration said
 * @returns {?object} `{ check, from, name }`, or null
 * @throws HENRI_TENANT_HEADER_UNVERIFIABLE without the proxies
 * @throws HENRI_CONFIG_INVALID on an entry that is not an address or range
 */
function headerFrom(raw) {
  if (!raw) {
    return null;
  }

  const name = typeof raw === 'string' ? raw : raw.name;
  const from = isPlainObject(raw) && Array.isArray(raw.from) ? raw.from : [];

  if (typeof name !== 'string' || name.length === 0) {
    return null;
  }

  if (from.length === 0) {
    throw fail(
      'HENRI_TENANT_HEADER_UNVERIFIABLE',
      `tenancy.from.header names ${name} and nothing is allowed to set it. Any client can send a header, so henri only believes a named one when it arrives from a proxy the application listed: { "tenancy": { "from": { "header": { "name": "${name}", "from": ["10.0.0.0/8"] } } } }`
    );
  }

  let proxies;

  try {
    proxies = trustedProxies(from);
  } catch (error) {
    throw fail(
      'HENRI_CONFIG_INVALID',
      `tenancy.from.header.from: ${String(error.message).replace(
        /^calls\.address\.from: /u,
        ''
      )}`,
      { cause: error }
    );
  }

  return {
    check: proxies.check,
    from: proxies.entries,
    name: name.toLowerCase(),
  };
}

/**
 * Normalizes the `tenancy` configuration key
 *
 * @param {*} config henri's config module (or anything with get/has)
 * @returns {object} the settings, `enabled` saying whether anything asked
 * @throws HENRI_CONFIG_INVALID on a shape henri cannot read
 * @throws HENRI_TENANT_HEADER_UNVERIFIABLE on an unverifiable header
 */
function tenancyConfig(config) {
  const settings = { ...DEFAULTS, from: { ...DEFAULTS.from } };

  if (!config || typeof config.has !== 'function' || !config.has('tenancy')) {
    return settings;
  }

  const raw = config.get('tenancy');

  if (raw === false || raw === null || typeof raw === 'undefined') {
    return settings;
  }

  if (!isPlainObject(raw)) {
    throw fail(
      'HENRI_CONFIG_INVALID',
      'config.tenancy must be an object ({ column, from, require, status }) or false'
    );
  }

  settings.enabled = true;

  if (typeof raw.column === 'string' && raw.column.length > 0) {
    settings.column = raw.column;
  }

  settings.require = raw.require === true;

  if (STATUSES.includes(raw.status)) {
    settings.status = raw.status;
  }

  const from = isPlainObject(raw.from) ? raw.from : {};
  const named = typeof from.user === 'string' && from.user;

  settings.from = {
    header: headerFrom(from.header),
    subdomain: typeof from.subdomain === 'string' ? from.subdomain : null,
    // `false` is how an application says the user record decides nothing,
    // which is what a subdomain-only application wants
    user: from.user === false ? null : named || DEFAULTS.from.user,
  };

  return settings;
}

/**
 * What a model said about tenants.
 *
 * `tenant: true` is the column `config.tenancy.column` names, added by the
 * adapter when the schema does not already declare it. `tenant: 'accountId'`
 * names a column of the model's own, which the schema **must** declare --
 * so a tenant can be an existing foreign key, and a typo is a failed boot
 * rather than a table nobody scoped.
 *
 * @param {object} model a model file (`{ options, schema }`)
 * @param {object} settings `tenancyConfig()`
 * @returns {?object} `{ column, declared }`, or null when it said nothing
 * @throws HENRI_TENANT_INVALID_MARK on a mark henri cannot carry out
 * @throws HENRI_TENANT_UNKNOWN_COLUMN on a named column the model has not
 */
function markOf(model, settings) {
  const mark = ((model && model.options) || {}).tenant;

  if (
    !settings.enabled ||
    mark === false ||
    mark === null ||
    typeof mark === 'undefined'
  ) {
    return null;
  }

  const name = (model && (model.globalId || model.identity)) || 'a model';

  if (mark !== true && typeof mark !== 'string') {
    throw fail(
      'HENRI_TENANT_INVALID_MARK',
      `${name} says options.tenant: ${JSON.stringify(mark)}, and a mark is true (the ${settings.column} column henri adds) or the name of a column of the model's own`
    );
  }

  const column = mark === true ? settings.column : mark;
  const schema = (model && model.schema) || {};
  const declared = Object.prototype.hasOwnProperty.call(schema, column);

  if (mark !== true && !declared) {
    throw fail(
      'HENRI_TENANT_UNKNOWN_COLUMN',
      `${name} says options.tenant: '${column}' and declares no ${column} in its schema. A named tenant column is one of the model's own -- declare it, or say options.tenant: true and henri adds ${settings.column}`
    );
  }

  // `length` travels with the mark so that the three adapters need no copy
  // of the width: the column they add is exactly as wide as an identifier
  // this file will accept, and there is one place that says how wide that is
  return { column, declared, length: MAX_TENANT };
}

/**
 * The label in front of a domain, or null.
 *
 * `acme.example.com` under `example.com` is `acme`; `example.com` itself is
 * nothing, `www.example.com` is `www` and henri does not know that `www` is
 * special, so the guide says to give a marketing site a name of its own. An
 * address is never a subdomain.
 *
 * @param {*} host the `Host` header, port and all
 * @param {?string} domain what `tenancy.from.subdomain` names
 * @returns {?string} the label, or null
 */
function subdomainOf(host, domain) {
  if (typeof host !== 'string' || typeof domain !== 'string' || !domain) {
    return null;
  }

  const bare = host.replace(/:\d+$/u, '').toLowerCase();
  const suffix = `.${domain.toLowerCase().replace(/^\./u, '')}`;

  if (isIP(bare) !== 0 || !bare.endsWith(suffix)) {
    return null;
  }

  const label = bare.slice(0, -suffix.length);

  // One label: `a.b.example.com` is not the tenant `a.b`, because a
  // wildcard certificate covers one level and the second is somebody else's
  return label && !label.includes('.') ? label : null;
}

/**
 * The tenant the user record names, or null
 *
 * @param {*} user `req.user`, or null
 * @param {?string} column what `tenancy.from.user` names
 * @returns {?string} the tenant, or null
 */
function tenantOfUser(user, column) {
  if (!user || !column) {
    return null;
  }

  const value =
    typeof user.get === 'function' ? user.get(column) : user[column];

  return normalizeTenant(value, `the ${column} of the signed-in user`);
}

/**
 * May the peer of this request set the tenant header?
 *
 * The socket address and nothing the client wrote: a header saying who the
 * client is cannot be what decides whether to believe that client.
 *
 * @param {object} req the request
 * @param {?object} header what `headerFrom()` answered
 * @returns {boolean} yes or no
 */
function trusts(req, header) {
  if (!header || !header.check || !req) {
    return false;
  }

  const socket = req.socket || req.connection || null;
  const peer = normalize(socket && socket.remoteAddress);

  return Boolean(peer) && header.check(peer);
}

module.exports = {
  CLIENT_NAMED,
  DEFAULTS,
  MAX_TENANT,
  SOURCES,
  STATUSES,
  TENANT,
  TenantError,
  headerFrom,
  isPlainObject,
  markOf,
  normalizeTenant,
  subdomainOf,
  tenancyConfig,
  tenantOfUser,
  trusts,
};
