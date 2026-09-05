const Sql = require('@usehenri/sequelize');
const sequelizeTypes = require('@usehenri/sequelize/types');
const MsSQL = require('../index');
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

describe('mssql database adapter', () => {
  test('extends the shared sequelize adapter', () => {
    const henri = fakeHenri();
    const store = new MsSQL(
      'default',
      { adapter: 'mssql', url: 'mssql://user:pass@db.local:1434/henri' },
      henri
    );

    expect(store).toBeInstanceOf(Sql);
    expect(store.adapterName).toBe('mssql');
    expect(henri.pen.fatal).not.toHaveBeenCalled();
  });

  test('builds a mssql connector from the url', () => {
    const store = new MsSQL(
      'default',
      { adapter: 'mssql', url: 'mssql://user:pass@db.local:1434/henri' },
      fakeHenri()
    );

    expect(store.connector.getDialect()).toBe('mssql');
    expect(store.connector.config).toMatchObject({
      database: 'henri',
      host: 'db.local',
      password: 'pass',
      port: '1434',
      username: 'user',
    });
    expect(store.connector.options.dialectModulePath).toBe(
      require.resolve('tedious')
    );
  });

  test('forwards extra store options to sequelize', () => {
    const store = new MsSQL(
      'default',
      {
        adapter: 'mssql',
        dialectOptions: { options: { encrypt: true } },
        logging: false,
        url: 'mssql://user:pass@db.local/henri',
      },
      fakeHenri()
    );

    expect(store.connector.options.dialectOptions).toEqual({
      options: { encrypt: true },
    });
    expect(store.connector.options.logging).toBe(false);
    expect(store.connector.options.adapter).toBeUndefined();
  });

  test('reports a missing url', () => {
    const henri = fakeHenri();
    const store = new MsSQL('default', { adapter: 'mssql' }, henri);

    expect(henri.pen.fatal).toHaveBeenCalledWith(
      'mssql',
      'Missing url or host in store default'
    );
    expect(store.connector).toBeNull();
  });

  test('re-exports the sequelize types', () => {
    expect(types).toBe(sequelizeTypes);
  });
});
