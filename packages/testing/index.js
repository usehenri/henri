const jest = require('jest');
const supertest = require('supertest');

/**
 * Returns a supertest agent bound to the running henri express app
 *
 * @param {object} [instance=global.henri] A henri instance (defaults to the global)
 * @returns {import('supertest').Agent} A supertest agent
 * @throws when henri or its server module is not initialized
 */
const request = (instance = global.henri) => {
  if (!instance || !instance.server || !instance.server.app) {
    throw new Error(
      'henri server is not initialized; start henri before calling request()'
    );
  }

  return supertest(instance.server.app);
};

module.exports = {
  jest,
  request,
  supertest,
};
