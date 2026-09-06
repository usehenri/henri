const Sql = require('@usehenri/sequelize');

/**
 * MSSQL database adapter (tedious driver)
 *
 * Sequelize is how henri reaches SQL Server, and it is the only way it can:
 * Drizzle has no SQL Server dialect (drizzle-orm 0.45 ships pg, mysql,
 * sqlite, singlestore and gel; drizzle-kit 0.31 generates for postgresql,
 * mysql, sqlite, turso, singlestore and gel). Whatever happens to the other
 * SQL adapters, this package and `@usehenri/sequelize` under it stay.
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
