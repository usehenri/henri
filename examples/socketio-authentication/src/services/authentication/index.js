'use strict';

const auth = require('feathers-authentication');

module.exports = function () {
  const app = this;

  app.service('authentication').hooks({
    before: {
      create: [
        auth.hooks.authenticate(['local', 'jwt'])
      ]
    }
  });
};
