const Sql = require('@usehenri/sequelize');

const { log } = henri;

class MsSQL extends Sql {
  constructor(name, config) {
    super(name, config);
    if (!config.url) {
      log.fatalError(`Missing url or host in store ${name}`);
    }
    this.adapterName = 'mssql';
    this.connector = new this.Sequelize(config.url, {
      dialect: 'mssql',
      dialectModulePath: require.resolve('tedious'),
    });
  }
}

module.exports = MsSQL;
