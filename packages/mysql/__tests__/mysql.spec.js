const Sql = require('@usehenri/sequelize');
const sequelizeTypes = require('@usehenri/sequelize/types');
const MySQL = require('../index');
const types = require('../types');

/**
 * Builds a minimal henri stand-in for the adapter
 *
 * @returns {object} fake henri
 */
const fakeHenri = () => ({
  config: { get: () => undefined, has: () => false },
  pen: { error: vi.fn(), fatal: vi.fn(), info: vi.fn(), warn: vi.fn() },
});

describe('mysql database adapter', () => {
  test('extends the shared sequelize adapter', () => {
    const henri = fakeHenri();
    const store = new MySQL(
      'default',
      { adapter: 'mysql', url: 'mysql://user:pass@db.local:3307/henri' },
      henri
    );

    expect(store).toBeInstanceOf(Sql);
    expect(store.adapterName).toBe('mysql');
    expect(store.name).toBe('default');
    expect(henri.pen.fatal).not.toHaveBeenCalled();
  });

  test('builds a mysql connector from the url', () => {
    const store = new MySQL(
      'default',
      { adapter: 'mysql', url: 'mysql://user:pass@db.local:3307/henri' },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('mysql');
    expect(store.connector.config).toMatchObject({
      database: 'henri',
      host: 'db.local',
      password: 'pass',
      port: '3307',
      username: 'user',
    });
    expect(store.connector.options.dialectModulePath).toBe(
      require.resolve('mysql2')
    );
  });

  test('serves mariadb urls with the mysql2 driver', () => {
    const store = new MySQL(
      'maria',
      { adapter: 'mariadb', url: 'mariadb://user:pass@db.local/henri' },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('mysql');
    expect(store.connector.config.database).toBe('henri');
  });

  test('forwards extra store options to sequelize', () => {
    const store = new MySQL(
      'default',
      {
        adapter: 'mysql',
        logging: false,
        pool: { max: 3 },
        url: 'mysql://user:pass@db.local/henri',
      },
      fakeHenri()
    );

    expect(store.connector.options.pool.max).toBe(3);
    expect(store.connector.options.logging).toBe(false);
    expect(store.connector.options.adapter).toBeUndefined();
  });

  test('reports a missing url', () => {
    const henri = fakeHenri();
    const store = new MySQL('default', { adapter: 'mysql' }, henri);

    expect(henri.pen.fatal).toHaveBeenCalledWith(
      'mysql',
      'Missing url or host in store default'
    );
    expect(store.connector).toBeNull();
  });

  test('re-exports the sequelize types', () => {
    expect(types).toBe(sequelizeTypes);
  });
});
