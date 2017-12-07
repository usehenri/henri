const Sql = require('@usehenri/sequelize');

const { log } = henri;

class Postgresql extends Sql {
  constructor(name, config) {
    super(name, config);
    if (!config.url) {
      log.fatalError(`Missing url or host in store ${name}`);
    }
    this.connector = new this.Sequelize(config.url, {
      dialectModulePath: require.resolve('pg'),
    });
  }
}

module.exports = Postgresql;
