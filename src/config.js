'use strict';

require('dotenv').config({
  silent: true
});

const debug = require('debug')('henri:config');
const fs = require('fs');
const path = require('path');
const appRootDir = require('app-root-dir').get();
const configuration = require('feathers-configuration');
const validate = require('./config-validation');

module.exports = function () {
  const app = this;

  app.configure(configuration(appRootDir));
  validate(app.locals.settings);
  const publicPath = path.join(app.get('next'), 'static');
  try {
    fs.accessSync(path.join(app.get('next'), 'static'), 'r');
    app.set('public', publicPath);
    debug(`setting static files directory as ${publicPath}`);
  } catch (e) {
    debug(`unable to access ${publicPath} - will not serve static files`);
  }
};
