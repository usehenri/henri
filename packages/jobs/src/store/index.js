const mongo = require('./mongo');
const sql = require('./sql');

const { JobStoreError } = require('../errors');

/**
 * Picks the backend of a store adapter
 *
 * The queue talks to the database the application already runs, through the
 * adapter's own surface: `query()` on the SQL adapters (sequelize and its
 * dialect packages, drizzle), the MongoDB collections on the mongoose and
 * disk adapters. No henri model is involved either way.
 *
 * @param {object} adapter A henri store adapter
 * @param {object} tables `{ jobs, schedules }` table names
 * @returns {object} A store backend
 * @throws {JobStoreError} When the adapter cannot back a queue
 */
const storeFor = (adapter, tables) => {
  if (!adapter) {
    throw new JobStoreError('@usehenri/jobs: no store to back the queue');
  }

  if (adapter.mongoose) {
    return mongo.create(adapter, tables);
  }

  if (typeof adapter.query !== 'function') {
    throw new JobStoreError(
      `@usehenri/jobs: the ${adapter.adapterName || 'unknown'} adapter has neither query() nor a MongoDB connection`
    );
  }

  return sql.create(adapter, tables);
};

module.exports = { mongo, sql, storeFor };
