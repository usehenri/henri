const Sql = require('@usehenri/sequelize');
const sequelizeTypes = require('@usehenri/sequelize/types');
const Postgresql = require('../index');
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

describe('postgresql database adapter', () => {
  test('extends the shared sequelize adapter', () => {
    const henri = fakeHenri();
    const store = new Postgresql(
      'default',
      {
        adapter: 'postgresql',
        url: 'postgres://user:pass@db.local:5433/henri',
      },
      henri
    );

    expect(store).toBeInstanceOf(Sql);
    expect(store.adapterName).toBe('postgresql');
    expect(henri.pen.fatal).not.toHaveBeenCalled();
  });

  test('builds a postgres connector from the url', () => {
    const store = new Postgresql(
      'default',
      {
        adapter: 'postgresql',
        url: 'postgres://user:pass@db.local:5433/henri',
      },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('postgres');
    expect(store.connector.config).toMatchObject({
      database: 'henri',
      host: 'db.local',
      password: 'pass',
      port: '5433',
      username: 'user',
    });
    expect(store.connector.options.dialectModulePath).toBe(
      require.resolve('pg')
    );
  });

  test('forwards extra store options to sequelize', () => {
    const store = new Postgresql(
      'default',
      {
        adapter: 'postgresql',
        logging: false,
        pool: { max: 3 },
        url: 'postgres://user:pass@db.local/henri',
      },
      fakeHenri()
    );

    expect(store.connector.options.pool.max).toBe(3);
    expect(store.connector.options.logging).toBe(false);
    expect(store.connector.options.adapter).toBeUndefined();
  });

  test('reports a missing url', () => {
    const henri = fakeHenri();
    const store = new Postgresql('default', { adapter: 'postgresql' }, henri);

    expect(henri.pen.fatal).toHaveBeenCalledWith(
      'postgresql',
      'Missing url or host in store default'
    );
    expect(store.connector).toBeNull();
  });

  test('re-exports the sequelize types', () => {
    expect(types).toBe(sequelizeTypes);
  });
});
