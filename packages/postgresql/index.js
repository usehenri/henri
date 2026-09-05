const Sql = require('@usehenri/sequelize');

/**
 * PostgreSQL database adapter (pg driver)
 *
 * @class Postgresql
 * @extends {Sql}
 */
class Postgresql extends Sql {
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
      driver: require.resolve('pg'),
    });
  }
}

module.exports = Postgresql;
