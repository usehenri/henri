const BaseModule = require('./base/module');

const session = require('express-session');
const passport = require('passport');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt-nodejs');

/**
 * User module
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
    this.runlevel = 4;
    this.name = 'user';
    this.henri = null;

    this.encrypt = this.encrypt.bind(this);
    this.compare = this.compare.bind(this);
    this.init = this.init.bind(this);
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
    return new Promise((resolve, reject) => {
      if (typeof password !== 'string') {
        return reject(new Error('you must provide a string to encrypt'));
      }
      if (password.length < 6) {
        return reject(new Error('minimum password string is 6 characters'));
      }
      if (this.henri.isTest) {
        rounds = 3;
      }
      bcrypt.genSalt(rounds, (err, salt) => {
        if (err) {
          return reject(err);
        }

        bcrypt.hash(password, salt, null, (err, hash) => {
          if (err) {
            return reject(err);
          }

          return resolve(hash);
        });
      });
    });
  }

  /**
   * Compare a password with hash (after hashing given password)
   *
   * @async
   * @static
   * @param {string} password A password
   * @param {string} hash A hash
   * @param {object} user The user
   * @returns {(Promise<boolean>|Error)} Good (true) or ERROR!
   * @memberof User
   */
  async compare(password, hash) {
    if (this.henri) {
      return new Promise((resolve, reject) => {
        bcrypt.compare(password, hash, (err, ok) => {
          if (err) {
            return reject(err);
          }
          if (!ok) {
            return reject(new Error('Invalid credentials'));
          }

          return resolve(true);
        });
      });
    }
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
    const { config, pen } = this.henri;

    if (this.henri._user) {
      if (!config.has('secret')) {
        // TODO: Document more...
        throw new Error(
          'You should provide a secret in your configuration file.'
        );
      }

      const options = {
        jwt: {
          jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
          secretOrKey: config.get('secret'),
        },
        usernameField: 'email',
      };

      /**
       * Check if
       * @param {string} email An email
       * @param {string} passwordHash A password hash
       * @param {function} done A callback
       * @returns {void}
       */
      const checkLocal = async (email, passwordHash, done) => {
        try {
          const user = await this.henri._user.findOne({
            email: email,
          });

          await this.compare(passwordHash, user.password);
          done(null, user);
        } catch (error) {
          done(null, false, 'Invalid credentials.');
        }
      };

      /**
       * Check the JWT
       *
       * @param {string} payload A payload
       * @param {function} done A callback
       * @returns {function} callback
       */
      const checkJWT = async (payload, done) => {
        const user = await this.henri._user.findOne({
          id: payload._id,
        });

        if (user) {
          return done(null, user);
        }

        return done(null, false);
      };

      const localLogin = new LocalStrategy(
        {
          usernameField: 'email',
        },
        checkLocal
      );
      const jwtLogin = new JwtStrategy(options.jwt, checkJWT);

      passport.use(jwtLogin);
      passport.use(localLogin);

      const connector = this.henri.model.getSessionConnector(session);

      this.henri.server.app.use(
        session({
          cookie: {
            httpOnly: true,
            maxAge: 365 * 24 * 60 * 60 * 1000,
            path: '/',
          },
          name: 'henri.sid',
          resave: false,
          saveUninitialized: true,
          secret: this.henri.config.get('secret'),
          store: connector,
        })
      );

      /* istanbul ignore next */
      passport.serializeUser((user, done) => {
        done(null, user._id);
      });

      /* istanbul ignore next */
      passport.deserializeUser(async function(id, done) {
        try {
          const user = await henri._user.find(
            {
              _id: id,
            },
            {
              password: 0,
            }
          );

          return done(null, user && user.length > 0 ? user[0] : undefined);
        } catch (error) {
          return done(error, null);
        }
      });

      this.henri.server.app.use(passport.initialize());
      this.henri.server.app.use(passport.session());

      /* istanbul ignore next */
      this.henri.addMiddleware(app => {
        app.post('/login', passport.authenticate('local'), (req, res) =>
          res.send('authenticated')
        );
      });

      /* istanbul ignore next */
      this.henri.addMiddleware(app => {
        app.get('/logout', function(req, res) {
          pen.info('user', 'Logging out', req.user);
          req.logout();
          delete req.user;

          return res.redirect('/');
        });
      });

      this.henri.passport = passport;
    } else {
      /* istanbul ignore next */
      pen.warn('user', 'no user model defined; will not load user module');
    }

    return this.name;
  }

  /**
   * Stops the module
   * @async
   * @returns {(string|boolean)} Module name or false
   */
  static async stop() {
    return false;
  }
}

module.exports = User;
