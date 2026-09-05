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

    const { url, adapter, ...opts } = config;

    this.adapterName = 'postgresql';

    if (!url) {
      thisHenri.pen.fatal('postgresql', `Missing url or host in store ${name}`);

      return;
    }

    this.connector = new this.Sequelize(url, {
      ...opts,
      dialectModulePath: require.resolve('pg'),
    });
  }
}

module.exports = Postgresql;
