const HenriMongoose = require('@usehenri/mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const debug = require('debug')('henri:disk');
const path = require('path');
const fs = require('fs');

/**
 * Disk database adapter
 *
 * Runs a local MongoDB (mongodb-memory-server) so models can use the same
 * mongoose adapter as a real MongoDB store. Data is persisted under
 * `<cwd>/.henri/data` (`config.path` to change it), except in test mode
 * where it stays in memory.
 *
 * @class Disk
 * @extends {HenriMongoose}
 */
class Disk extends HenriMongoose {
  /**
   * The disk adapter provisions its own server, no url is needed
   *
   * @readonly
   * @static
   * @returns {boolean} true
   * @memberof Disk
   */
  static get managed() {
    return true;
  }

  /**
   * Creates an instance of Disk.
   *
   * @param {string} name Store name
   * @param {object} config Store configuration: `path` (data directory,
   *   relative to the app), `dbName` (defaults to henri)
   * @param {Henri} thisHenri Current henri instance
   * @memberof Disk
   */
  constructor(name, config, thisHenri) {
    super(name, config, thisHenri);

    this.adapterName = 'disk';
    this.mongod = null;
    this.mongoUri = '';
    debug('constructor => done');
  }

  /**
   * The directory where data is persisted
   *
   * @returns {string} An absolute path
   * @memberof Disk
   */
  dataPath() {
    const cwd =
      typeof this.henri.cwd === 'function' ? this.henri.cwd() : process.cwd();

    return path.resolve(cwd, this.config.path || path.join('.henri', 'data'));
  }

  /**
   * The url of the local server
   *
   * @returns {string} A mongodb:// url
   * @memberof Disk
   */
  resolveUrl() {
    return this.mongoUri;
  }

  /**
   * Starts the local server, then the store
   *
   * @returns {Promise<void>} Resolves when connected
   * @memberof Disk
   */
  async start() {
    const { pen } = this.henri;
    const instance = { dbName: this.config.dbName || 'henri' };

    debug('starting %s', this.name);

    if (!this.henri.isTest) {
      const dataPath = this.dataPath();

      fs.mkdirSync(dataPath, { recursive: true });

      instance.dbPath = dataPath;
      instance.storageEngine = 'wiredTiger';
      debug('persisting data in %s', dataPath);

      if (this.henri.isProduction) {
        pen.warn(
          'disk',
          `persisting data in ${dataPath}; the disk adapter is not meant for production`
        );
      }
    }

    this.mongod = await MongoMemoryServer.create({ instance });

    this.mongoUri = this.mongod.getUri(instance.dbName);
    this.config.url = this.mongoUri;
    debug('mongod available at %s', this.mongoUri);

    return super.start();
  }

  /**
   * Stops the store, then the local server
   *
   * @returns {Promise<void>} Resolves when stopped
   * @memberof Disk
   */
  async stop() {
    debug('stopping %s', this.name);

    await super.stop();

    if (this.mongod) {
      await this.mongod.stop();
      this.mongod = null;
    }
  }
}

module.exports = Disk;
