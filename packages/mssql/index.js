const Sql = require('@usehenri/sequelize');

/**
 * MSSQL database adapter
 *
 * @class MsSQL
 * @extends {Sql}
 */
class MsSQL extends Sql {
  /**
   * Creates an instance of MSSQL.
   * @param {string} name Store name
   * @param {any} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof MsSQL
   */
  constructor(name, config, thisHenri) {
    super(name, config, thisHenri);
    if (!config.url) {
      thisHenri.pen.fatal('mssql', `Missing url or host in store ${name}`);
    }
    this.adapterName = 'mssql';
    this.connector = new this.Sequelize(config.url, {
      dialect: 'mssql',
      dialectModulePath: require.resolve('tedious'),
    });
  }
}

module.exports = MsSQL;
