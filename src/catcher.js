/*!
 * henri
 * Copyright(c) 2016-present Félix-Antoine Paradis
 * MIT Licensed
 */

'use strict';

const errors = require('feathers-errors');
const handler = require('feathers-errors/handler');
const winston = require('winston');

module.exports = function () {
  const app = this;

  // Not found
  app.use((req, res, next) => {
    next(new errors.NotFound('Page not found'));
  });

  // If app.logger is not present, use winston
  if (typeof app.logger !== 'function') {
    app.use((err, req, res, next) => {
      if (err) {
        const message = `${err.code ? `(${err.code}) ` : ''}Route: ${req.url} - ${err.message}`;

        if (err.code === 404) {
          winston.info(message);
        } else {
          winston.error(message);
          winston.info(err.stack);
        }
      }

      next(err);
    });
  }

  // Feathers error handler
  app.use(handler());
};
