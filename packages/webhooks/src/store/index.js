const mongo = require('./mongo');
const sql = require('./sql');

const { WebhookError } = require('../errors');

/**
 * Picks the backend of a store adapter
 *
 * The endpoints live in the database the application already runs, reached
 * through the adapter's own surface: `query()` on the SQL adapters
 * (sequelize and its dialect packages, drizzle), the MongoDB collections on
 * the mongoose and disk adapters. No henri model is involved either way.
 *
 * @param {object} adapter A henri store adapter
 * @param {object} tables `{ endpoints }` table names
 * @returns {object} A store backend
 * @throws {WebhookError} When the adapter cannot hold the endpoints
 */
const storeFor = (adapter, tables) => {
  if (!adapter) {
    throw new WebhookError(
      'HENRI_WEBHOOK_UNSUPPORTED_STORE',
      '@usehenri/webhooks: no store to hold the endpoints'
    );
  }

  if (adapter.mongoose) {
    return mongo.create(adapter, tables);
  }

  if (typeof adapter.query !== 'function') {
    throw new WebhookError(
      'HENRI_WEBHOOK_UNSUPPORTED_STORE',
      `@usehenri/webhooks: the ${adapter.adapterName || 'unknown'} adapter has neither query() nor a MongoDB connection`
    );
  }

  return sql.create(adapter, tables);
};

module.exports = { mongo, sql, storeFor };
