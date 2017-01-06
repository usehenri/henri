/*!
 * henri
 * Copyright(c) 2016-present Félix-Antoine Paradis
 * MIT Licensed
 */

'use strict';

const bodyParser = require('body-parser');
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
const middleware = require('./middleware');

const app = feathers();

app.configure(config);

const view = next({
  dir: app.get('next'),
  dev: true
});

exports.init = function () {
  app.use(compress())
    .options('*', cors())
    .use(cors())
    .use('/', serveStatic(app.get('public')))
    .use(bodyParser.json())
    .use(bodyParser.urlencoded({ extended: true }))
    .configure(hooks())
    .configure(rest());

  if (app.get('socketio')) {
    app.configure(socketio());
  }

  app.configure(auth(app.get('auth')))
    .configure(local())
    .configure(jwt());

  app.view = view;

  return app;
};

exports.run = function () {
  const handle = view.getRequestHandler();
  app.get('*', (req, res) => {
    return handle(req, res);
  });
  app.configure(middleware);
  view.prepare().then(() => {
    const port = app.get('port');
    app.listen(port, (err) => {
      if (err) throw err;
      console.log(`> Ready on http://localhost:${port}`);
    });
  });
};
