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

    const dataPath = path.join(
      os.tmpdir(),
      `henri-mongo-${md5(process.cwd())}`
    );

    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath);
    }

    this.mongod = new MongoMemoryServer({
      instance: {
        dbName: 'henri',
        dbPath: dataPath,
        storageEngine: this.henri.isTest ? 'ephemeralForTest' : 'wiredTiger',
      },
    });

    this.config.url = await this.mongod.getConnectionString();

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

    await this.mongod.stop();
  }
}

module.exports = Disk;
