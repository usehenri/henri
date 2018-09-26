const Sql = require('@usehenri/sequelize');

/**
 * PostgreSQL database adapter
 *
 * @class Postgresql
 * @extends {Sql}
 */
class Postgresql extends Sql {
  /**
   *Creates an instance of Postgresql.
   * @param {string} name Store name
   * @param {any} config Store configuration
   * @param {Henri} thisHenri Current henri instance
   * @memberof Postgresql
   */
  constructor(name, config, thisHenri) {
    super(name, config, thisHenri);

    if (!config.url) {
      thisHenri.pen.fatal('postgresql', `Missing url or host in store ${name}`);
    }

    this.adapterName = 'postgresql';

    this.connector = new this.Sequelize(config.url, {
      dialectModulePath: require.resolve('pg'),
    });
  }
}

module.exports = Postgresql;
