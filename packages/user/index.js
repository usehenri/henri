/* global User */
const session = require('express-session');

const passport = require('passport');
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt-nodejs');

const { app, config, log } = henri;

if (!config.has('secret')) {
  // TODO: Document more...
  log.fatalError('You should provide a secret in your configuration file.');
}

const options = {
  usernameField: 'email',
  jwt: {
    jwtFromRequest: ExtractJwt.fromAuthHeader(),
    secretOrKey: config.get('secret'),
  },
};

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
      if (henri.isTest) {
        rounds = 10;
      }
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

async function checkLocal(email, password, done) {
  log.info('in check local', email, password);
  try {
    const user = await User.findOne({ email: email });
    await compare(password, user.password);
    done(null, user);
  } catch (error) {
    done(null, false, 'Invalid credentials.');
  }
}

async function checkJWT(payload, done) {
  const user = await User.findOne({ id: payload._id });
  if (user) {
    return done(null, user);
  }
  done(null, false);
}

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
  User.find({ id: id }, (err, user) => {
    delete user.password;
    done(err, user);
  });
});

app.use(passport.initialize());
app.use(passport.session());

app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/success',
    failureRedirect: '/failure',
  })
);

app.get('/logout', function(req, res) {
  log.info('Logging out user', req.user);
  req.logout();
  res.redirect('/');
});

global['henri'].user = {
  encrypt,
  compare,
};

log.info('user module loaded.');
