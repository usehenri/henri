const Sql = require('@usehenri/sequelize');

/**
 * MySQL / MariaDB database adapter
 *
 * @class MySQL
 * @extends {Sql}
 */
class MySQL extends Sql {
  /**
   *Creates an instance of MySQL.
   * @param {string} name Store name
   * @param {any} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof MySQL
   */
  constructor(name, config, thisHenri) {
    super(name, config, thisHenri);

    const { url, adapter, ...opts } = config;

    this.adapterName = 'mysql';

    if (!url) {
      thisHenri.pen.fatal('mysql', `Missing url or host in store ${name}`);

      return;
    }

    // MariaDB is served by the mysql2 driver; sequelize picks the dialect
    // from the url protocol, so normalize it
    this.connector = new this.Sequelize(url.replace(/^mariadb:/i, 'mysql:'), {
      ...opts,
      dialectModulePath: require.resolve('mysql2'),
    });
  }
}

module.exports = MySQL;
