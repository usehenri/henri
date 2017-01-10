'use strict';

const hooks = require('feathers-hooks');
const auth = require('feathers-authentication');
const local = require('feathers-authentication-local');
const permissions = require('feathers-permissions');

exports.before = {
  all: [],
  find: [
    auth.hooks.authenticate('jwt'),
    permissions.hooks.checkPermissions({ service: 'users' }),
    permissions.hooks.isPermitted()
  ],
  get: [
    auth.hooks.authenticate('jwt'),
    permissions.hooks.checkPermissions({ service: 'users' }),
    permissions.hooks.isPermitted()
  ],
  create: [
    local.hooks.hashPassword({ passwordField: 'password' })
  ],
  update: [
    auth.hooks.authenticate('jwt'),
    permissions.hooks.checkPermissions({ service: 'users' }),
    permissions.hooks.isPermitted(),
    local.hooks.hashPassword()
  ],
  patch: [
    auth.hooks.authenticate('jwt'),
    permissions.hooks.checkPermissions({ service: 'users' }),
    permissions.hooks.isPermitted(),
    local.hooks.hashPassword()
  ],
  remove: [
    auth.hooks.authenticate('jwt'),
    permissions.hooks.checkPermissions({ service: 'users' }),
    permissions.hooks.isPermitted()
  ]
};

exports.after = {
  all: [hooks.remove('password')],
  find: [],
  get: [],
  create: [],
  update: [],
  patch: [],
  remove: []
};
