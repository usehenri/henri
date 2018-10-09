const Sql = require('@usehenri/sequelize');

/**
 * MySQL database adapter
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

    const { url, ...opts } = config;

    if (!config.url) {
      thisHenri.pen.fatal('mysql', `Missing url or host in store ${name}`);
    }
    this.adapterName = 'mysql';
    this.connector = new this.Sequelize(url, {
      ...opts,
      dialectModulePath: require.resolve('mysql2'),
    });
  }
}

module.exports = MySQL;
