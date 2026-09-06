const { DIALECTS, install, uninstall } = require('../src/store/schema');
const { describe: describeAdapter } = require('../src/store/sql');
const { storeFor } = require('../src/store');

const TABLES = { endpoints: 'henri_webhooks' };

describe('the endpoints table, on every dialect', () => {
  test.each(Object.keys(DIALECTS))(
    '%s: the statements create the table and its index, idempotently',
    (dialect) => {
      const statements = install(dialect, TABLES);

      expect(statements.length).toBeGreaterThan(0);
      expect(statements.join('\n')).toContain('henri_webhooks');
      expect(statements.join('\n')).toMatch(/secrets/u);

      // Every statement is safe to run twice: `IF NOT EXISTS`, or the guard
      // the dialect uses instead of one
      for (const statement of statements) {
        expect(statement).toMatch(/IF NOT EXISTS|IF OBJECT_ID|KEY /u);
      }

      expect(uninstall(dialect, TABLES)).toEqual([
        expect.stringContaining('DROP TABLE IF EXISTS'),
      ]);
    }
  );

  test('mysql declares its index inside the guarded CREATE TABLE', () => {
    const [create, ...rest] = install('mysql', TABLES);

    expect(rest).toHaveLength(0);
    expect(create).toContain('KEY `henri_webhooks_owner` (owner, disabled_at)');
  });

  test('mssql guards both the table and the index', () => {
    const statements = install('mssql', TABLES);

    expect(statements[0]).toContain("IF OBJECT_ID('henri_webhooks', 'U')");
    expect(statements[1]).toContain('IF NOT EXISTS (SELECT 1 FROM sys.indexes');
    expect(statements[0]).toContain('NVARCHAR(MAX)');
  });

  test('a dialect with no statements says so rather than guessing', () => {
    expect(() => install('oracle', TABLES)).toThrow(/unsupported SQL dialect/u);
    expect(() => uninstall('oracle', TABLES)).toThrow(/unsupported SQL/u);
  });

  test('a table name that is not an identifier never reaches a statement', () => {
    expect(() => install('postgres', { endpoints: 'a b' })).toThrow(
      /invalid table name/u
    );
  });

  test('an adapter with neither query() nor mongo is refused, by name', () => {
    expect(() => storeFor(null, TABLES)).toThrow(/no store to hold/u);
    expect(() => storeFor({ adapterName: 'nope' }, TABLES)).toThrow(
      /has neither query\(\) nor a MongoDB connection/u
    );
    expect(describeAdapter({ adapterName: 'nope' })).toBeNull();
  });

  test('the drizzle adapter names its dialect and its placeholder style', () => {
    expect(
      describeAdapter({
        dialect: { name: 'postgres', placeholder: (n) => `$${n}` },
      })
    ).toEqual({ dialect: 'postgres', dollars: true });
    expect(
      describeAdapter({ dialect: { name: 'sqlite', placeholder: () => '?' } })
    ).toEqual({ dialect: 'sqlite', dollars: false });
  });

  test('a dialect the endpoints have no statements for is refused', () => {
    expect(() =>
      storeFor(
        {
          adapterName: 'cockroach',
          dialect: { name: 'cockroach', placeholder: () => '?' },
          query: () => null,
        },
        TABLES
      )
    ).toThrow(/dialect is not supported/u);
  });
});
