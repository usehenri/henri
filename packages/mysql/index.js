const Sql = require('@usehenri/sequelize');

const { log } = henri;

class MySQL extends Sql {
  constructor(name, config) {
    super(name, config);
    const { url, adapter, ...opts } = config;
    if (!config.url) {
      log.fatalError(`Missing url or host in store ${name}`);
    }
    this.adapterName = 'mysql';
    this.connector = new this.Sequelize(config.url, {
      ...opts,
      dialectModulePath: require.resolve('mysql2'),
    });
  }
}

module.exports = MySQL;
