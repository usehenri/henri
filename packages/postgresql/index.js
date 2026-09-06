const Drizzle = require('@usehenri/drizzle');

/**
 * PostgreSQL database adapter
 *
 * `@usehenri/drizzle` with the dialect already chosen and the `pg` driver
 * in the dependencies rather than left to the application. It is what
 * `"adapter": "postgresql"` resolves to: henri's PostgreSQL adapter is
 * Drizzle, so the models, the query API and the migrations of
 * `db/migrations` are Drizzle's.
 *
 * @class Postgresql
 * @extends {Drizzle}
 */
class Postgresql extends Drizzle {
  /**
   * Creates an instance of Postgresql.
   *
   * @param {string} name Store name
   * @param {object} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof Postgresql
   */
  constructor(name, config, thisHenri) {
    super(name, config, thisHenri, {
      adapterName: 'postgresql',
      dialect: 'postgres',
      // The pg driver is a dependency of this package, not of the app
      driverPaths: [__dirname],
    });
  }
}

module.exports = Postgresql;
