'use strict';

const debug = require('debug')('henri:cookies');

module.exports = function () {
  const app = this;

  app.use((req, res, next) => {
    const { cookie: { name }, secret } = app.get('auth');
    const cookies = req.feathers.cookies;
    if (cookies[name]) {
      app.passport.verifyJWT(cookies[name], { secret }).then(payload => {
        debug('cookie token verified successfully');
        app.service('users').get(payload.userId).then(user => {
          const infos = {
            authenticated: true,
            user,
            payload: { userId: user._id }
          };
          Object.assign(req, infos);
          Object.assign(req.feathers, infos);
          debug('user informations injected in request');
          next();
        }).catch(err => {
          debug('error finding user:', err);
          next();
        });
      })
      .catch(error => {
        debug('unable to verify token', error);
        next();
      });
    } else {
      debug('no matching cookie found');
      next();
    }
  });
};
