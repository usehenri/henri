const session = require('express-session');

const passport = require('passport');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt-nodejs');

const { app, config, log } = henri;

async function encrypt(password, rounds = 10) {
  return new Promise((resolve, reject) => {
    if (typeof password !== 'string') {
      return reject(new Error('you must provide a string to encrypt'));
    }
    if (password.length < 6) {
      return reject(new Error('minimum password string is 6 characters'));
    }
    if ((rounds < 1 || rounds > 15000) && !henri.passwordHashWarning) {
      log.warn(
        `password encryption rounds higher than 15,000 can really slow down execution`
      );
      henri.passwordHashWarning = true;
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

async function compare(password, hash, user) {
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

if (henri._user) {
  if (!config.has('secret')) {
    // TODO: Document more...
    log.fatalError('You should provide a secret in your configuration file.');
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
      const user = await henri._user.findOne({ email: email });
      await compare(password, user.password);
      done(null, user);
    } catch (error) {
      done(null, false, 'Invalid credentials.');
    }
  };

  const checkJWT = async (payload, done) => {
    const user = await henri._user.findOne({ id: payload._id });
    if (user) {
      return done(null, user);
    }
    done(null, false);
  };

  const localLogin = new LocalStrategy({ usernameField: 'email' }, checkLocal);
  const jwtLogin = new JwtStrategy(options.jwt, checkJWT);

  passport.use(jwtLogin);
  passport.use(localLogin);

  const NedbStore = require('nedb-session-store')(session);

  app.use(
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

  passport.deserializeUser(function(id, done) {
    henri._user.find({ _id: id }, { password: 0 }, (err, user) => {
      done(err, user && user.length > 0 ? user[0] : {});
    });
  });

  app.use(passport.initialize());
  app.use(passport.session());
  /* istanbul ignore next */
  henri.addMiddleware(() => {
    henri.router.post('/login', passport.authenticate('local'), (req, res) =>
      res.send('authenticated')
    );
  });
  /* istanbul ignore next */
  henri.addMiddleware(() => {
    henri.router.get('/logout', function(req, res) {
      log.info('Logging out user', req.user);
      req.logout();
      res.redirect('/');
    });
  });

  henri.passport = passport;

  log.info('user module loaded.');
} else {
  /* istanbul ignore next */
  log.warn('no user model defined; will not load user module');
}

global['henri'].user = {
  encrypt,
  compare,
};
