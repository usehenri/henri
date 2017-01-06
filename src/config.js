/*!
 * henri
 * Copyright(c) 2016-present Félix-Antoine Paradis
 * MIT Licensed
 */

'use strict';

require('dotenv').config({
  silent: true
});

const appRootDir = require('app-root-dir').get();
const configuration = require('feathers-configuration');
const validate = require('./config-validation');

module.exports = function () {
  const app = this;

  app.configure(configuration(appRootDir));
  validate(app.locals.settings);
};
