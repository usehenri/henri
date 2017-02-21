'use strict';

const debug = require('debug')('henri:main');

const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const compress = require('compression');
const cors = require('cors');

const feathers = require('feathers');
const serveStatic = require('feathers').static;
const auth = require('feathers-authentication');
const local = require('feathers-authentication-local');
const jwt = require('feathers-authentication-jwt');
const hooks = require('feathers-hooks');
const rest = require('feathers-rest');

const config = require('./config');
const cookies = require('./cookies');
const catcher = require('./catcher');

const app = feathers();

app.configure(config);

const isProduction = app.get('env') === 'production';

const init = () => {
  // Basic configuration
  app.use(compress());
  app.options('*', cors());
  app.use(cors());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.configure(hooks());
  app.configure(rest());

  if (app.get('public')) {
    debug('serving static files from', app.get('public'));
    app.use('/', serveStatic(app.get('public')));
  }

  debug('socket.io enabled.');
  const socketio = require('feathers-socketio');
  app.configure(socketio());

  if (app.get('auth')) {
    app.configure(auth(app.get('auth')));
    app.configure(local());
    app.configure(jwt());
    app.configure(cookies);
    const addUser = (hook) => {
      const id = hook.params.user._id;
      return hook.app.service('users')
        .get(id)
        .then(user => {
          const passwordField =
            hook.app.get('users') && hook.app.get('users').passwordField
              ? hook.app.get('users').passwordField : 'password';
          delete user[passwordField];
          hook.result.user = user;
          return hook;
        });
    };
    app.service('authentication').hooks({
      before: {
        create: [ auth.hooks.authenticate(['local', 'jwt']) ]
      },
      after: {
        create: [addUser]
      }
    });
  }

  app.use((req, res, next) => {
    debug('exposing feathers utilities');
    const session = {
      options: {
        authentication: !!app.get('auth'),
        endpoint: app.get('endpoint')
      },
      user: {
        authenticated: req.authenticated,
        token: req.token,
        profile: req.user
      },
      userAgent: req.headers['user-agent'] || ''
    };
    Object.assign(req, { session: session });
    next();
  });

  if (app.get('next')) {
    const next = require('next');
    debug('setting up next.js');
    app.nextServer = next({
      dir: app.get('next'),
      dev: true
    });
    app.view = {
      render: (req, res, path, opts) => {
        if (!res.forceCORS) {
          res.removeHeader('Access-Control-Allow-Origin');
        }
        app.nextServer.render(req, res, path, opts);
      }
    };
  }

  return app;
};

const run = () => {
  if (app.get('next')) {
    const handle = app.nextServer.getRequestHandler();

    app.get('*', (req, res) => {
      res.removeHeader('Access-Control-Allow-Origin');
      return handle(req, res);
    });
    app.configure(catcher);

    if (isProduction) {
      debug('building nextjs production bundle');
      const builder = require('next/dist/server/build').default;
      builder(app.get('next')).then(() => server());
    } else {
      debug('preparing nextjs dev server');
      app.nextServer.prepare().then(() => server());
    }
  } else {
    app.configure(catcher);
    server();
  }
};

const server = () => {
  debug('starting server');
  const port = app.get('port');

  app.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${port}`);
  });
};

module.exports.init = init;
module.exports.run = run;
