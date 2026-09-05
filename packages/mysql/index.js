const Sql = require('@usehenri/sequelize');

/**
 * MySQL / MariaDB database adapter (mysql2 driver)
 *
 * @class MySQL
 * @extends {Sql}
 */
class MySQL extends Sql {
  /**
   * Creates an instance of MySQL.
   *
   * @param {string} name Store name
   * @param {object} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof MySQL
   */
  constructor(name, config, thisHenri) {
    super(name, config, thisHenri, {
      adapterName: 'mysql',
      dialect: 'mysql',
      driver: require.resolve('mysql2'),
      mariadbRewrite: true,
    });
  }
}

module.exports = MySQL;
