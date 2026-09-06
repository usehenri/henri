const Drizzle = require('@usehenri/drizzle');

/**
 * MySQL / MariaDB database adapter
 *
 * `@usehenri/drizzle` with the dialect already chosen and the `mysql2`
 * driver in the dependencies rather than left to the application. It is
 * what `"adapter": "mysql"` and `"adapter": "mariadb"` resolve to: henri's
 * MySQL adapter is Drizzle, so the models, the query API and the
 * migrations of `db/migrations` are Drizzle's.
 *
 * @class MySQL
 * @extends {Drizzle}
 */
class MySQL extends Drizzle {
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
      // The mysql2 driver is a dependency of this package, not of the app
      driverPaths: [__dirname],
    });
  }
}

module.exports = MySQL;
