/**
 * User configuration and adapter helpers shared by the user module, the
 * model module and the router.
 *
 * `config.user` is either a string (the user model name, historical form) or
 * an object:
 *
 * ```json
 * {
 *   "user": {
 *     "model": "user",
 *     "public": ["name"],
 *     "loginPath": "/login",
 *     "afterLogin": "/",
 *     "sessionMaxAge": 2592000000,
 *     "password": { "minLength": 12 },
 *     "lockout": { "max": 10, "windowMs": 900000 }
 *   }
 * }
 * ```
 *
 * The password policy and the hashing parameters live in `base/password.js`,
 * the per-account sign-in lockout in `base/lockout.js`.
 */
const { stamp } = require('./errors');
const { EXTERNAL_ID, hasExternalId, isUuid } = require('./external-id');
const { lockoutConfig } = require('./lockout');
const { passwordPolicy } = require('./password');

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

const DEFAULTS = Object.freeze({
  afterLogin: '/',
  loginPath: '/login',
  model: 'user',
  public: Object.freeze([]),
  sessionMaxAge: THIRTY_DAYS,
});

/**
 * Normalizes the `user` configuration key
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @param {object} [options={}] options
 * @param {boolean} [options.isTest=false] cheap hashing parameters
 * @returns {{model: string, public: Array<string>, loginPath: string, afterLogin: string, sessionMaxAge: number, password: object, lockout: ?object}} settings
 * @throws {TypeError} when `config.user` is neither a string nor an object
 */
function userConfig(config, { isTest = false } = {}) {
  const settings = Object.assign({}, DEFAULTS, {
    lockout: lockoutConfig(undefined),
    password: passwordPolicy({}, { isTest }),
    public: [],
  });

  if (!config || typeof config.has !== 'function' || !config.has('user')) {
    return settings;
  }

  const raw = config.get('user');

  if (typeof raw === 'string') {
    settings.model = raw;

    return settings;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw stamp(
      new TypeError(
        'config.user must be a string (model name) or an object ({ model, public, loginPath, afterLogin, sessionMaxAge, password, lockout })'
      ),
      'HENRI_CONFIG_INVALID'
    );
  }

  if (typeof raw.model === 'string' && raw.model.length > 0) {
    settings.model = raw.model;
  }
  if (typeof raw.loginPath === 'string' && raw.loginPath.length > 0) {
    settings.loginPath = raw.loginPath;
  }
  if (typeof raw.afterLogin === 'string' && raw.afterLogin.length > 0) {
    settings.afterLogin = raw.afterLogin;
  }
  if (Number.isFinite(raw.sessionMaxAge) && raw.sessionMaxAge > 0) {
    settings.sessionMaxAge = raw.sessionMaxAge;
  }
  if (Array.isArray(raw.public)) {
    settings.public = raw.public.filter(
      (field) => typeof field === 'string' && field !== 'password'
    );
  }
  if (typeof raw.password !== 'undefined') {
    settings.password = passwordPolicy(raw.password, { isTest });
  }
  if (typeof raw.lockout !== 'undefined') {
    settings.lockout = lockoutConfig(raw.lockout);
  }

  return settings;
}

/**
 * Tells if a model looks like a Sequelize model (as opposed to Mongoose)
 *
 * `findAndCountAll` is the tell, not `findByPk`: henri gives every adapter
 * a key lookup now (`findByKey`, and `findByPk` where the ORM uses that
 * name), so the name a Sequelize model shares with the others cannot be
 * what tells them apart.
 *
 * @param {object} model a model
 * @returns {boolean} sequelize or not
 */
function isSequelizeModel(model) {
  return Boolean(model) && typeof model.findAndCountAll === 'function';
}

/**
 * A user by the identifier a session or a token carries, on an adapter that
 * does not implement `findUserById()`.
 *
 * Either identifier resolves: the subject henri serializes is the primary
 * key, and an application minting its own JWT may well put the public one
 * in it. This is the framework reading its own token, not a url naming a
 * row, so the key lookup is the right door -- `findById()` is the one that
 * got strict (see base/references.js).
 *
 * @param {object} model the user model
 * @param {*} id the subject
 * @param {object} options the projection (per ORM)
 * @returns {Promise<?object>} the user or null
 */
function lookupUser(model, id, options) {
  if (isUuid(id) && typeof model.findByExternalId === 'function') {
    return model.findByExternalId(id, options);
  }

  if (typeof model.findByKey === 'function') {
    return model.findByKey(id, options);
  }

  if (typeof model.findByPk === 'function') {
    return model.findByPk(id, options);
  }

  return model.findById(id, options);
}

/**
 * An identifier a record actually carries.
 *
 * The three adapters answer `userId()` with `String(user._id || user.id)` (or
 * the primary key attribute), which turns a record carrying no identifier at
 * all into the nine letter string `"undefined"`. That string is *truthy*, so
 * every guard written against it -- `serializeUser()`'s `if (!id)`,
 * `accounts.identify()`'s null -- lets it through, and it goes on to name a
 * session, the subject of a signed token and the `id` of the public user, as
 * if it were a row.
 *
 * No primary key is spelled `undefined`, `null` or nothing, so reading those
 * three back as nobody costs an application nothing and closes the hole for
 * every caller at once.
 *
 * @param {*} value what an adapter's userId() answered
 * @returns {(string|undefined)} the identifier, or undefined for nobody
 */
function identifier(value) {
  if (value === null || typeof value === 'undefined') {
    return undefined;
  }

  const id = String(value);

  return id === '' || id === 'undefined' || id === 'null' ? undefined : id;
}

/**
 * Builds the user lookup facade used by core.
 *
 * Adapters implementing the contract (`findUserByEmail`, `findUserById`,
 * `userId`, `toPlain`) are called directly. When a method is missing, core
 * falls back to the ORM calls it knows (Mongoose or Sequelize), so older
 * adapters keep working.
 *
 * @param {object} store the adapter owning the user model (may be null)
 * @param {object} model the user model (may be null)
 * @returns {{findUserByEmail: function, findUserById: function, userId: function, toPlain: function, native: boolean}} facade
 */
function userAdapter(store, model) {
  const has = (name) => Boolean(store) && typeof store[name] === 'function';
  const sql = isSequelizeModel(model);

  const fallback = {
    findUserByEmail: async (email) => {
      if (!model) {
        return null;
      }
      if (sql) {
        return model.findOne({ where: { email } });
      }

      // The password is needed to check credentials, even when the schema
      // deselects it
      return model.findOne({ email }).select('+password');
    },
    findUserById: async (id) => {
      if (!model || id === null || typeof id === 'undefined') {
        return null;
      }
      try {
        return await lookupUser(
          model,
          id,
          sql ? { attributes: { exclude: ['password'] } } : { password: 0 }
        );
      } catch (error) {
        // A malformed id (ex: a stale session) is not a user
        if (error && error.name === 'CastError') {
          return null;
        }
        throw error;
      }
    },
    toPlain: (user) => {
      if (!user || typeof user !== 'object') {
        return {};
      }
      if (typeof user.toObject === 'function') {
        return user.toObject();
      }
      if (typeof user.toJSON === 'function') {
        return user.toJSON();
      }

      return Object.assign({}, user);
    },
    userId: (user) => {
      if (!user) {
        return undefined;
      }
      const id = sql ? user.id : (user._id ?? user.id);

      return id === null || typeof id === 'undefined' ? undefined : String(id);
    },
  };

  const methods = ['findUserByEmail', 'findUserById', 'userId', 'toPlain'];
  const facade = { native: methods.every(has) };

  for (const name of methods) {
    facade[name] = has(name)
      ? (...args) => store[name](...args)
      : fallback[name];
  }

  // Whichever of the two answered, a record with no identifier is nobody
  // rather than a string that reads like one (see identifier())
  const answered = facade.userId;

  facade.userId = (user) => identifier(answered(user));

  return facade;
}

/**
 * Builds the representation of a user that can leave the server
 *
 * The identifier is the user's `externalId`, the public one every model
 * carries; a user model that opted out of it (`options: { externalId:
 * false }`) still answers with its `id`.
 *
 * @param {object} adapter facade built by userAdapter()
 * @param {object} user a user instance (or null)
 * @param {Array<string>} [fields=[]] extra fields to expose (config.user.public)
 * @param {?Set<string>} [hidden=null] the names marked `personal: { expose: false }`
 * @returns {?{externalId: string, email: string, roles: Array<string>}} the public user or null
 */
function publicUser(adapter, user, fields = [], hidden = null) {
  if (!user) {
    return null;
  }

  const isHidden = (field) => Boolean(hidden && hidden.has(field));

  const plain = adapter.toPlain(user) || {};
  let roles = [];

  if (Array.isArray(plain.roles)) {
    roles = plain.roles.slice();
  } else if (typeof plain.roles === 'string' && plain.roles.length > 0) {
    roles = [plain.roles];
  }

  const result = hasExternalId(plain)
    ? { email: plain.email, externalId: plain[EXTERNAL_ID], roles }
    : { email: plain.email, id: adapter.userId(user), roles };

  if (isHidden('email')) {
    delete result.email;
  }

  for (const field of fields) {
    if (
      typeof field === 'string' &&
      field !== 'password' &&
      !isHidden(field) &&
      Object.prototype.hasOwnProperty.call(plain, field) &&
      typeof plain[field] !== 'undefined'
    ) {
      result[field] = plain[field];
    }
  }

  return result;
}

/**
 * Content negotiation for the auth endpoints: JSON for API clients (curl,
 * fetch, axios, anything accepting `* / *`), `html` (usually a redirect) for
 * browsers asking for text/html.
 *
 * @param {Express.Response} res the response
 * @param {{json: function, html: function}} handlers the handlers
 * @returns {*} whatever the handler returns
 */
function respond(res, { json, html }) {
  // The order matters to res.format: json must come first so that `* / *`
  // gets JSON and only explicit text/html gets the html handler.
  // eslint-disable-next-line sort-keys
  return res.format({ json, html, default: json });
}

module.exports = {
  DEFAULTS,
  identifier,
  isSequelizeModel,
  publicUser,
  respond,
  userAdapter,
  userConfig,
};
