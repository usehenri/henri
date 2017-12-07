const Sql = require('@usehenri/sequelize');

const { cwd } = henri;

class Disk extends Sql {
  constructor(name, config) {
    super(name, config);
    this.connector = new this.Sequelize(
      `sqlite:${cwd}/.tmp/${this.name}.disk.db`,
      {
        dialectModulePath: require.resolve('sqlite3'),
      }
    );
  }
}

module.exports = Disk;
