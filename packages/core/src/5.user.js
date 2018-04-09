const BaseModule = require('./base/module');

const session = require('express-session');
const passport = require('passport');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt-nodejs');

class User extends BaseModule {
  constructor() {
    super();
    this.reloadable = false;
    this.runlevel = 3;
    this.name = 'user';
    this.henri = null;

    this.init = this.init.bind(this);
  }

  async encrypt(password, rounds = 10) {
    return new Promise((resolve, reject) => {
      if (typeof password !== 'string') {
        return reject(new Error('you must provide a string to encrypt'));
      }
      if (password.length < 6) {
        return reject(new Error('minimum password string is 6 characters'));
      }
      if (henri.isTest) {
        rounds = 10;
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

  async compare(password, hash, user) {
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

  async init() {
    const { config, pen } = this.henri;
    if (this.henri._user) {
      if (!config.has('secret')) {
        // TODO: Document more...
        pen.fatal(
          'user',
          'You should provide a secret in your configuration file.'
        );
      }

      const options = {
        usernameField: 'email',
        jwt: {
          jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
          secretOrKey: config.get('secret'),
        },
      };

      const checkLocal = async (email, password, done) => {
        try {
          const user = await this.henri._user.findOne({ email: email });
          await this.compare(password, user.password);
          done(null, user);
        } catch (error) {
          done(null, false, 'Invalid credentials.');
        }
      };

      const checkJWT = async (payload, done) => {
        const user = await this.henri._user.findOne({ id: payload._id });
        if (user) {
          return done(null, user);
        }
        done(null, false);
      };

      const localLogin = new LocalStrategy(
        { usernameField: 'email' },
        checkLocal
      );
      const jwtLogin = new JwtStrategy(options.jwt, checkJWT);

      passport.use(jwtLogin);
      passport.use(localLogin);

      const NedbStore = require('nedb-session-store')(session);

      this.henri.server.app.use(
        session({
          secret: henri.config.get('secret'),
          name: 'henri.sid',
          resave: false,
          saveUninitialized: true,
          cookie: {
            path: '/',
            httpOnly: true,
            maxAge: 365 * 24 * 60 * 60 * 1000, // e.g. 1 year
          },
          store: new NedbStore({
            filename: '.tmp/nedb-sessions.db',
          }),
        })
      );

      passport.serializeUser((user, done) => {
        done(null, user.id);
      });

      passport.deserializeUser(async function(id, done) {
        try {
          const user = await henri._user.find({ _id: id }, { password: 0 });
          return done(null, user && user.length > 0 ? user[0] : undefined);
        } catch (e) {
          return done(e, null);
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
          res.redirect('/');
        });
      });

      this.henri.passport = passport;
    } else {
      /* istanbul ignore next */
      pen.warn('user', 'no user model defined; will not load user module');
    }
    return this.name;
  }

  stop() {
    return false;
  }
}

module.exports = User;
