const debug = require('debug')('henri:webhooks:mongo');

const { WebhookError } = require('../errors');

/**
 * The MongoDB backend of the endpoints collection.
 *
 * Documents carry the same field names as the SQL columns, on purpose: the
 * two backends hand the package the same rows, so everything above this
 * file is written once.
 */

/**
 * The MongoDB store
 *
 * @class MongoStore
 */
class MongoStore {
  /**
   * Creates an instance of MongoStore.
   *
   * @param {object} adapter A henri mongoose (or disk) adapter
   * @param {object} tables `{ endpoints }` collection names
   * @memberof MongoStore
   */
  constructor(adapter, tables) {
    this.adapter = adapter;
    this.tables = tables;
    this.dialect = 'mongodb';
    this.kind = 'mongo';
  }

  /**
   * The database of the store
   *
   * @returns {object} A MongoDB database
   * @throws {WebhookError} When the store is not connected
   * @memberof MongoStore
   */
  database() {
    const connection =
      this.adapter.mongoose && this.adapter.mongoose.connection;

    if (!connection || connection.readyState !== 1 || !connection.db) {
      throw new WebhookError(
        'HENRI_WEBHOOK_UNSUPPORTED_STORE',
        `@usehenri/webhooks: the ${this.adapter.name} store is not connected`
      );
    }

    return connection.db;
  }

  /**
   * The endpoints collection
   *
   * @returns {object} A MongoDB collection
   * @memberof MongoStore
   */
  endpoints() {
    return this.database().collection(this.tables.endpoints);
  }

  /**
   * Creates the collection and its indexes; idempotent
   *
   * @returns {Promise<Array<string>>} What was created
   * @memberof MongoStore
   */
  async install() {
    const collection = this.endpoints();

    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ disabled_at: 1, owner: 1 });

    debug('indexes ready on %s', this.tables.endpoints);

    return [`${this.tables.endpoints}: id (unique), owner + disabled_at`];
  }

  /**
   * Drops the collection
   *
   * @returns {Promise<Array<string>>} What was dropped
   * @memberof MongoStore
   */
  async uninstall() {
    await this.endpoints()
      .drop()
      .catch(() => null);

    return [`${this.tables.endpoints} dropped`];
  }

  /**
   * Whether the collection answers
   *
   * @returns {Promise<boolean>} true when it does
   * @memberof MongoStore
   */
  async installed() {
    try {
      await this.endpoints().countDocuments({}, { limit: 1 });

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Inserts an endpoint
   *
   * @param {object} row A row, in database shape
   * @returns {Promise<object>} The endpoint, read back
   * @memberof MongoStore
   */
  async insert(row) {
    await this.endpoints().insertOne({ ...row });

    return this.find(row.id);
  }

  /**
   * One endpoint by id
   *
   * @param {string} id The endpoint id
   * @returns {Promise<?object>} The document, or null
   * @memberof MongoStore
   */
  async find(id) {
    return this.endpoints().findOne({ id }, { projection: { _id: 0 } });
  }

  /**
   * Writes a few fields of an endpoint
   *
   * @param {string} id The endpoint id
   * @param {object} changes The fields to write
   * @returns {Promise<?object>} The document, read back
   * @memberof MongoStore
   */
  async update(id, changes) {
    await this.endpoints().updateOne({ id }, { $set: { ...changes } });

    return this.find(id);
  }

  /**
   * Deletes an endpoint
   *
   * @param {string} id The endpoint id
   * @returns {Promise<boolean>} Whether there was one to delete
   * @memberof MongoStore
   */
  async remove(id) {
    const answer = await this.endpoints().deleteOne({ id });

    return (answer.deletedCount || 0) > 0;
  }

  /**
   * The filter of a listing
   *
   * @param {object} filter `owner` and `disabled`
   * @returns {object} A MongoDB filter
   * @memberof MongoStore
   */
  query(filter) {
    const query = {};

    if (typeof filter.owner === 'string') {
      query.owner = filter.owner;
    }

    // `null` is a filter, not the absence of one
    if (filter.owner === null) {
      query.owner = null;
    }

    if (filter.disabled === false) {
      query.disabled_at = null;
    }

    if (filter.disabled === true) {
      query.disabled_at = { $ne: null };
    }

    return query;
  }

  /**
   * The endpoints of an application, or of one owner
   *
   * @param {object} [filter={}] `owner`, `disabled`, `limit`, `offset`
   * @returns {Promise<Array<object>>} The documents
   * @memberof MongoStore
   */
  async list(filter = {}) {
    return this.endpoints()
      .find(this.query(filter), { projection: { _id: 0 } })
      .sort({ created_at: 1, id: 1 })
      .skip(Math.max(0, Number(filter.offset) || 0))
      .limit(Math.max(1, Math.min(Number(filter.limit) || 1000, 10000)))
      .toArray();
  }

  /**
   * How many endpoints there are
   *
   * @param {object} [filter={}] `owner`, `disabled`
   * @returns {Promise<number>} The count
   * @memberof MongoStore
   */
  async count(filter = {}) {
    return this.endpoints().countDocuments(this.query(filter));
  }
}

/**
 * Builds the MongoDB store of an adapter
 *
 * @param {object} adapter A henri mongoose (or disk) adapter
 * @param {object} tables `{ endpoints }` collection names
 * @returns {MongoStore} The store
 */
const create = (adapter, tables) => new MongoStore(adapter, tables);

module.exports = { MongoStore, create };
