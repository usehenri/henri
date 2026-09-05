const Sql = require('@usehenri/sequelize');

/**
 * MSSQL database adapter (tedious driver)
 *
 * @class MsSQL
 * @extends {Sql}
 */
class MsSQL extends Sql {
  /**
   * Creates an instance of MsSQL.
   *
   * @param {string} name Store name
   * @param {object} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof MsSQL
   */
  constructor(name, config, thisHenri) {
    super(name, config, thisHenri, {
      adapterName: 'mssql',
      dialect: 'mssql',
      driver: require.resolve('tedious'),
    });
  }
}

module.exports = MsSQL;
