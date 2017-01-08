'use strict';

const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const compress = require('compression');
const cors = require('cors');
const serveStatic = require('feathers').static;
const feathers = require('feathers');
const auth = require('feathers-authentication');
const local = require('feathers-authentication-local');
const jwt = require('feathers-authentication-jwt');
const hooks = require('feathers-hooks');
const rest = require('feathers-rest');
const socketio = require('feathers-socketio');
const next = require('next');
const config = require('./config');
const cookies = require('./cookies');
const catcher = require('./catcher');

const app = feathers();

app.configure(config);

const view = next({
  dir: app.get('next'),
  dev: true
});

exports.init = function () {
  if (app.get('public')) {
    app.use('/', serveStatic(app.get('public')));
  }
  app.use(compress())
    .options('*', cors())
    .use(cors())
    .use(bodyParser.json())
    .use(bodyParser.urlencoded({ extended: true }))
    .use(cookieParser())
    .configure(hooks())
    .configure(rest());

  if (app.get('socketio')) {
    app.configure(socketio());
  }

  app.configure(auth(app.get('auth')))
    .configure(local())
    .configure(jwt())
    .configure(cookies);

  app.view = {
    render: (req, res, path, opts) => {
      if (!res.forceCORS) {
        res.removeHeader('Access-Control-Allow-Origin');
      }
      view.render(req, res, path, opts);
    }
  };

  return app;
};

exports.run = function () {
  const handle = view.getRequestHandler();
  app.get('*', (req, res) => {
    res.removeHeader('Access-Control-Allow-Origin');
    return handle(req, res);
  });
  app.configure(catcher);
  view.prepare().then(() => {
    const port = app.get('port');
    app.listen(port, (err) => {
      if (err) throw err;
      console.log(`> Ready on http://localhost:${port}`);
    });
  });
};
