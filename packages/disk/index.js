const HenriMongoose = require('@usehenri/mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const md5 = require('md5');
const debug = require('debug')('henri:disk');
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Disk database adapter
 *
 * Runs a local MongoDB (mongodb-memory-server) so models can use the same
 * mongoose adapter as a real MongoDB store. Data is persisted on disk under
 * the OS temp directory, except in test mode where it stays in memory.
 *
 * @class Disk
 */
class Disk extends HenriMongoose {
  /**
   * Creates an instance of Disk.
   *
   * @param {string} name Store name
   * @param {any} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof Disk
   */
  constructor(name, config, thisHenri) {
    super(name, { url: 'soon' }, thisHenri);

    this.adapterName = 'disk';
    this.config = config;
    this.name = name;
    this.mongod = null;
    this.mongoUri = '';
    this.henri = thisHenri;

    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    debug('constructor => done');
  }

  /**
   * Starts the store
   *
   * @returns {Promise} Resolves or not
   * @memberof Disk
   */
  async start() {
    debug('starting %s', this.name);

    const instance = { dbName: 'henri' };

    if (!this.henri.isTest) {
      const dataPath = path.join(
        os.tmpdir(),
        `henri-mongo-${md5(process.cwd())}`
      );

      fs.mkdirSync(dataPath, { recursive: true });

      instance.dbPath = dataPath;
      instance.storageEngine = 'wiredTiger';
      debug('persisting data in %s', dataPath);
    }

    this.mongod = await MongoMemoryServer.create({ instance });

    this.mongoUri = this.mongod.getUri();
    this.config.url = this.mongoUri;
    debug('mongod available at %s', this.mongoUri);

    return super.start();
  }

  /**
   * Stops the store
   *
   * @returns {Promise} Success or not?
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
