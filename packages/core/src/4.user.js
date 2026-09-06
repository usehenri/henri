const BaseModule = require('./base/module');

const crypto = require('crypto');
const session = require('express-session');
const { Passport } = require('passport');
const { ExtractJwt, Strategy: JwtStrategy } = require('passport-jwt');
const { Strategy: LocalStrategy } = require('passport-local');
const bcrypt = require('bcryptjs');
const debug = require('debug')('henri:user');

const { publicUser, respond, userAdapter, userConfig } = require('./base/auth');
const { params, permitMiddleware } = require('./base/params');
const csrf = require('./base/csrf');
const SessionStoreProxy = require('./base/session-store');

const SESSION_COOKIE = 'henri.sid';
const CSRF_COOKIE = 'henri.csrf';

/**
 * Tells if a store adapter owns a model
 *
 * @param {object} store an adapter
 * @param {object} model a model
 * @returns {boolean} owned or not
 */
function owns(store, model) {
  if (!store || !model || typeof store.getModels !== 'function') {
    return false;
  }

  const models = store.getModels() || {};

  return Object.keys(models).some((key) => models[key] === model);
}

/**
 * Normalizes an email before a lookup
 *
 * @param {*} email the email
 * @returns {string} trimmed, lowercased (empty when invalid)
 */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * User module
 *
 * Sessions, login/logout, CSRF protection, `req.permit()` and the public
 * representation of users. Talks to the database only through the adapter
 * contract (`findUserByEmail`, `findUserById`, `userId`, `toPlain`), see
 * `base/auth.js`.
 *
 * @class User
 * @extends {BaseModule}
 */
class User extends BaseModule {
  /**
   * Creates an instance of User.
   * @memberof User
   */
  constructor() {
    super();
    this.reloadable = false;
    this.needs = ['config', 'model', 'server'];
    this.runlevel = 4;
    this.name = 'user';
    this.henri = null;

    /** Normalized `config.user` (see base/auth.js userConfig) */
    this.settings = null;
    this.passport = null;
    this.sessionStore = null;
    this.dummyHash = null;

    this.encrypt = this.encrypt.bind(this);
    this.compare = this.compare.bind(this);
    this.init = this.init.bind(this);
    this.stop = this.stop.bind(this);
    this.adapter = this.adapter.bind(this);
    this.findByEmail = this.findByEmail.bind(this);
    this.findById = this.findById.bind(this);
    this.publicUser = this.publicUser.bind(this);
    this.login = this.login.bind(this);
    this.logout = this.logout.bind(this);
    this.deprecatedLogout = this.deprecatedLogout.bind(this);
  }

  /**
   * Encrypt a password
   *
   * @async
   * @static
   * @param {any} password The password
   * @param {number} [rounds=10] Rounds... rounds... rounds...
   * @returns {Promise<string|err>} The hash or an error
   * @memberof User
   */
  async encrypt(password, rounds = 10) {
    if (typeof password !== 'string') {
      throw new Error('you must provide a string to encrypt');
    }
    if (password.length < 6) {
      throw new Error('minimum password string is 6 characters');
    }
    if (this.henri && this.henri.isTest) {
      rounds = 4;
    }

    const salt = await bcrypt.genSalt(rounds);
    const hash = await bcrypt.hash(password, salt);

    return hash;
  }

  /**
   * Compare a password with hash (after hashing given password)
   *
   * @async
   * @static
   * @param {string} password A password
   * @param {string} hash A hash
   * @returns {(Promise<boolean>|Error)} Good (true) or ERROR!
   * @memberof User
   */
  async compare(password, hash) {
    const ok = await bcrypt.compare(password, hash);

    if (!ok) {
      throw new Error('Invalid credentials');
    }

    return true;
  }

  /**
   * The store adapter owning the user model
   *
   * Resolved on every call: the model module rebuilds its adapters on reload.
   *
   * @returns {?{name: string, store: object}} the store or null
   * @memberof User
   */
  userStore() {
    const { model, _user: user } = this.henri;
    const stores = (model && model.stores) || {};

    for (const name of Object.keys(stores)) {
      if (owns(stores[name], user)) {
        return { name, store: stores[name] };
      }
    }

    if (stores.default) {
      return { name: 'default', store: stores.default };
    }

    return null;
  }

  /**
   * The user lookup facade (adapter contract with fallbacks)
   *
   * @returns {object} see base/auth.js userAdapter()
   * @memberof User
   */
  adapter() {
    const found = this.userStore();

    return userAdapter(found && found.store, this.henri._user || null);
  }

  /**
   * Finds a user by email (trimmed and lowercased first).
   * The returned instance includes the password hash.
   *
   * @param {string} email the email
   * @returns {Promise<?object>} the user or null
   * @memberof User
   */
  async findByEmail(email) {
    const normalized = normalizeEmail(email);

    if (!normalized || !this.henri._user) {
      return null;
    }

    return this.adapter().findUserByEmail(normalized);
  }

  /**
   * Finds a user by id, without its password
   *
   * @param {string} id the id (as stored in the session)
   * @returns {Promise<?object>} the user or null
   * @memberof User
   */
  async findById(id) {
    if (!this.henri._user) {
      return null;
    }

    return this.adapter().findUserById(id);
  }

  /**
   * The representation of a user that can be sent to a browser:
   * `{ externalId, email, roles }` plus the fields listed in
   * `config.user.public`. The primary key stays on the server.
   *
   * @param {object} user a user instance
   * @returns {?object} the public user or null
   * @memberof User
   */
  publicUser(user) {
    return publicUser(
      this.adapter(),
      user,
      this.settings ? this.settings.public : []
    );
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof User
   */
  async init() {
    const { config, pen, server } = this.henri;

    this.settings = userConfig(config);
    this.henri.params = params;

    if (server && server.app) {
      server.app.set(
        'trust proxy',
        config.has('trustProxy') ? config.get('trustProxy') : true
      );
      server.app.use(permitMiddleware());
    }

    if (!this.henri._user) {
      pen.warn('user', 'no user model defined; will not load user module');

      return this.name;
    }

    if (!config.has('secret')) {
      throw new Error(
        'You should provide a secret in your configuration file.'
      );
    }

    if (!server || !server.app) {
      throw new Error('the user module needs the server module');
    }

    const secret = config.get('secret');
    const maxAge = this.settings.sessionMaxAge;

    // Unknown emails are checked against this hash so the response time does
    // not tell whether an account exists
    this.dummyHash = await this.encrypt(crypto.randomBytes(24).toString('hex'));

    this.passport = new Passport();
    this.passport.use(
      new LocalStrategy({ usernameField: 'email' }, (email, password, done) =>
        this.checkLocal(email, password, done)
      )
    );
    this.passport.use(
      new JwtStrategy(
        {
          jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
          secretOrKey: secret,
        },
        (payload, done) => this.checkJWT(payload, done)
      )
    );

    this.passport.serializeUser((user, done) => {
      const id = this.adapter().userId(user);

      if (!id) {
        return done(new Error('unable to serialize the user: missing id'));
      }

      return done(null, id);
    });

    this.passport.deserializeUser(async (id, done) => {
      try {
        const user = await this.findById(id);

        return done(null, user || false);
      } catch (error) {
        return done(error);
      }
    });

    this.sessionStore = new SessionStoreProxy({
      create: (store) =>
        this.henri.model.getSessionConnector(session, this.storeNameOf(store)),
      owner: () => {
        const found = this.userStore();

        return found ? found.store : null;
      },
    });

    server.app.use(
      session({
        cookie: {
          httpOnly: true,
          maxAge,
          path: '/',
          sameSite: 'lax',
          secure: this.henri.isProduction,
        },
        name: SESSION_COOKIE,
        resave: false,
        saveUninitialized: false,
        secret,
        store: this.sessionStore,
      })
    );

    server.app.use(this.passport.initialize());
    server.app.use(this.passport.session());

    if (config.has('csrf') && config.get('csrf') === false) {
      pen.warn('user', 'csrf protection is disabled by configuration');
    } else {
      server.app.use(
        csrf({
          cookie: CSRF_COOKIE,
          maxAge,
          secure: this.henri.isProduction,
          sessionCookie: SESSION_COOKIE,
        })
      );
    }

    this.henri.addMiddleware('login', (app) => {
      app.post('/login', this.login);
    });

    this.henri.addMiddleware('logout', (app) => {
      app.post('/logout', this.logout);
      app.get('/logout', this.deprecatedLogout);
    });

    this.henri.passport = this.passport;

    return this.name;
  }

  /**
   * Name of a store in the model module
   *
   * @param {object} store an adapter
   * @returns {string} its name (default when unknown)
   * @memberof User
   */
  storeNameOf(store) {
    const stores = (this.henri.model && this.henri.model.stores) || {};

    return (
      Object.keys(stores).find((name) => stores[name] === store) || 'default'
    );
  }

  /**
   * Local strategy: checks an email and a password
   *
   * @param {string} email the email
   * @param {string} password the clear text password
   * @param {function} done passport callback
   * @returns {Promise<void>} nothing
   * @memberof User
   */
  async checkLocal(email, password, done) {
    try {
      const user = await this.findByEmail(email);
      const hash =
        user && typeof user.password === 'string' && user.password.length > 0
          ? user.password
          : this.dummyHash;
      const ok = await bcrypt.compare(
        typeof password === 'string' ? password : '',
        hash
      );

      if (!user || !ok) {
        return done(null, false, { message: 'Invalid credentials' });
      }

      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }

  /**
   * JWT strategy: loads the user of a token
   *
   * @param {object} payload the token payload (`id`, `_id` or `sub`)
   * @param {function} done passport callback
   * @returns {Promise<void>} nothing
   * @memberof User
   */
  async checkJWT(payload, done) {
    try {
      const id = payload && (payload.id || payload._id || payload.sub);
      const user = id ? await this.findById(id) : null;

      return done(null, user || false);
    } catch (error) {
      return done(error, false);
    }
  }

  /**
   * POST /login
   *
   * Answers `{ user }` to JSON clients and redirects browsers to
   * `config.user.afterLogin` (default `/`). On failure: 401 (400 when the
   * credentials are missing) or a redirect to `<loginPath>?error=invalid`.
   *
   * @param {Express.Request} req request
   * @param {Express.Response} res response
   * @param {function} next next
   * @returns {void}
   * @memberof User
   */
  login(req, res, next) {
    const { pen } = this.henri;
    const { afterLogin, loginPath } = this.settings;

    this.passport.authenticate('local', (error, user, info, status) => {
      if (error) {
        return next(error);
      }

      if (!user) {
        const message = (info && info.message) || 'Invalid credentials';

        debug('login failed: %s', message);

        return respond(res, {
          html: () => res.redirect(`${loginPath}?error=invalid`),
          json: () =>
            status === 400
              ? res.boom.badRequest(message)
              : res.boom.unauthorized(message),
        });
      }

      return req.logIn(user, (loginError) => {
        if (loginError) {
          return next(loginError);
        }

        const me = this.publicUser(user);

        pen.info('user', 'logged in', me && (me.externalId || me.id));

        return respond(res, {
          html: () => res.redirect(afterLogin),
          json: () => res.json({ user: me }),
        });
      });
    })(req, res, next);
  }

  /**
   * POST /logout
   *
   * Destroys the session and answers `{ ok: true }` (JSON) or redirects to `/`.
   *
   * @param {Express.Request} req request
   * @param {Express.Response} res response
   * @param {function} next next
   * @returns {void}
   * @memberof User
   */
  logout(req, res, next) {
    const { pen } = this.henri;
    const me = this.publicUser(req.user);

    const finish = () => {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      me && pen.info('user', 'logged out', me.externalId || me.id);

      return respond(res, {
        html: () => res.redirect('/'),
        json: () => res.json({ ok: true }),
      });
    };

    const destroy = () => {
      if (!req.session || typeof req.session.destroy !== 'function') {
        return finish();
      }

      return req.session.destroy((error) => (error ? next(error) : finish()));
    };

    if (typeof req.logout !== 'function') {
      return destroy();
    }

    return req.logout((error) => (error ? next(error) : destroy()));
  }

  /**
   * GET /logout: deprecated, does nothing
   *
   * @param {Express.Request} req request
   * @param {Express.Response} res response
   * @returns {void}
   * @memberof User
   */
  deprecatedLogout(req, res) {
    this.henri.pen.warn(
      'user',
      'GET /logout is deprecated and does nothing; use POST /logout'
    );
    res.set('Allow', 'POST');

    return res.boom.methodNotAllowed(
      'GET /logout is deprecated, use POST /logout'
    );
  }

  /**
   * Stops the module: detaches from the session store. The adapters close
   * their own stores when the model module stops.
   *
   * @async
   * @returns {(string|boolean)} Module name or false
   * @memberof User
   */
  async stop() {
    if (!this.sessionStore) {
      return false;
    }

    await this.sessionStore.close();
    this.sessionStore = null;

    return this.name;
  }
}

module.exports = User;
module.exports.SESSION_COOKIE = SESSION_COOKIE;
module.exports.CSRF_COOKIE = CSRF_COOKIE;
