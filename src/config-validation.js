'use strict';

const joi = require('joi');
const debug = require('debug')('henri:config-validation');
const config = require('config');

const schema = joi.object().keys({
  host: joi.string().hostname().required(),
  port: joi.number().integer().min(1).max(65534).required(),
  next: joi.string().required(),
  auth: joi.object().keys({
    secret: joi.string().min(30).required()
  }).required()

});

module.exports = (obj) => {
  if (typeof obj === 'undefined') {
    throw new Error('Configuration file not specified');
  }
  const opts = { abortEarly: false, allowUnknown: true };
  joi.validate(obj, schema, opts, (err, value) => {
    debug('beginning validation');
    if (err) {
      console.log(` `);
      console.log(`  ${err.details.length} configuration error${err.details.length > 1 ? 's' : ''} found:`);
      console.log(` `);
      err.details.forEach((error, i) => {
        console.log(`    ${i + 1}: ${error.message}`);
      });
      console.log(` `);
      console.log(`  Check ${config.util.getConfigSources()[0].name} for more infos`);
      console.log(` `);
      process.exit(-1);
    }
    debug('configuration file seems ok.', value, err);
    return null;
  });
};
