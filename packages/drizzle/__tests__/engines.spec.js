const { Drizzle, fakeHenri, target } = require('./helpers');

/**
 * What the catalogue of `safety.js` claims, asserted against the database
 * the suite is pointed at.
 *
 * The checks say a statement is dangerous, and each says something
 * different per dialect: an index build blocks writes on postgres and not
 * on mysql, a NOT NULL column with no default is refused outright by
 * sqlite and postgres and silently filled in by mysql. Those are claims
 * about a database, so they are made against one -- sqlite offline, and
 * postgres or mysql with HENRI_TEST_POSTGRES_URL / HENRI_TEST_MYSQL_URL
 * (`pnpm test:sql:live`). What is asserted is the behaviour the catalogue
 * text describes: when an engine changes its mind, the text is what has to
 * change, and this is what says so.
 */

const dialect = target.name;

describe(`what ${dialect} does`, () => {
  let adapter;

  beforeAll(async () => {
    adapter = target.prepare(
      new Drizzle(
        'default',
        { sync: false, ...target.store('engines.db') },
        fakeHenri({})
      )
    );
    adapter.associate();
    adapter.compile();
    await adapter.start();
  });

  afterAll(async () => {
    if (adapter) {
      await adapter.stop();
    }
  });

  const quote = (name) => adapter.dialect.quote(name);

  /**
   * Runs a statement and says whether the database took it
   *
   * @param {string} sql The statement
   * @returns {Promise<?string>} null when it was accepted, the message when
   *   it was refused
   */
  const run = async (sql) => {
    try {
      await adapter.query(sql);

      return null;
    } catch (error) {
      return error.message;
    }
  };

  /**
   * A table of the given shape, with one row in it
   *
   * @param {string} name The table
   * @param {string} columns Its DDL
   * @returns {Promise<void>} Resolves once it holds a row
   */
  const filled = async (name, columns) => {
    await run(`DROP TABLE ${quote(name)}`);
    await adapter.query(`CREATE TABLE ${quote(name)} (${columns})`);
    await adapter.query(
      `INSERT INTO ${quote(name)} (${quote('txt')}) VALUES ('a')`
    );
  };

  /** What a dialect writes to add a column */
  const ADD = dialect === 'postgres' ? 'ADD COLUMN' : 'ADD';

  test('a NOT NULL column with no default is not safe, and only mysql takes it', async () => {
    await filled('probe_nn', `${quote('txt')} varchar(64)`);

    const refused = await run(
      `ALTER TABLE ${quote('probe_nn')} ${ADD} ${quote('note')} varchar(64) NOT NULL`
    );

    // The finding that decides the wording of `column.not-null`: sqlite and
    // postgres refuse the statement once there is a row, so the migration
    // fails and the deploy stops. mysql takes it
    expect(refused === null).toBe(dialect === 'mysql');
  });

  test.skipIf(dialect !== 'mysql')(
    'mysql fills the rows that were already there, without a warning',
    async () => {
      await filled('probe_fill', '`txt` varchar(64)');
      await adapter.query(
        'ALTER TABLE `probe_fill` ADD `note` varchar(64) NOT NULL'
      );

      const rows = await adapter.query(
        'SELECT `note` AS note FROM `probe_fill`'
      );

      // Under STRICT_TRANS_TABLES, which is the default of mysql 8
      expect(rows[0].note).toBe('');
    }
  );

  test('a default is what makes it safe, on every dialect', async () => {
    await filled('probe_def', `${quote('txt')} varchar(64)`);

    expect(
      await run(
        `ALTER TABLE ${quote('probe_def')} ${ADD} ${quote('note')} varchar(64) DEFAULT 'x' NOT NULL`
      )
    ).toBeNull();
  });

  test.skipIf(dialect !== 'postgres')(
    'CONCURRENTLY works outside a transaction and not inside one',
    async () => {
      await filled('probe_idx', '"txt" varchar(64), "n" integer');

      // Outside a transaction it works, which is why the fix says to build
      // the index there
      expect(
        await run(
          'CREATE INDEX CONCURRENTLY "probe_idx_n" ON "probe_idx" ("n")'
        )
      ).toBeNull();

      // Inside one it does not -- and drizzle's migrator applies every
      // pending migration inside a single transaction, so "add CONCURRENTLY
      // to the migration" would be advice that fails. The fix does not give
      // it
      await adapter.query('BEGIN');

      const inside = await run(
        'CREATE INDEX CONCURRENTLY "probe_idx_n2" ON "probe_idx" ("n")'
      );

      await run('ROLLBACK');
      expect(inside).toMatch(/transaction block/iu);
    }
  );

  test.skipIf(dialect !== 'sqlite')(
    'sqlite has no CONCURRENTLY to point at',
    async () => {
      await filled('probe_idx', '`txt` varchar(64), `n` integer');

      expect(
        await run(
          'CREATE INDEX CONCURRENTLY `probe_idx_n` ON `probe_idx` (`n`)'
        )
      ).toBeTruthy();
    }
  );

  test.skipIf(dialect !== 'mysql')(
    'mysql builds a secondary index online and rebuilds for a type change',
    async () => {
      await filled('probe_online', '`txt` varchar(64), `n` int');

      // LOCK=NONE is only accepted when the DDL really is online, which is
      // what makes an index build a postgres problem and not a mysql one
      expect(
        await run(
          'ALTER TABLE `probe_online` ADD INDEX `probe_online_n` (`n`), ALGORITHM=INPLACE, LOCK=NONE'
        )
      ).toBeNull();

      // A type change is the other answer, and it is why `column.type` is
      // declared for mysql too
      expect(
        await run(
          'ALTER TABLE `probe_online` MODIFY COLUMN `n` bigint, ALGORITHM=INPLACE, LOCK=NONE'
        )
      ).toMatch(/INPLACE is not supported/iu);
    }
  );

  test.skipIf(dialect !== 'postgres')(
    'postgres rewrites the table for a growing integer and not for a widening varchar',
    async () => {
      await filled('probe_type', '"txt" varchar(255), "n" integer');

      const filenode = async () => {
        const rows = await adapter.query(
          `SELECT pg_relation_filenode('probe_type') AS f`
        );

        return String(rows[0].f);
      };
      const before = await filenode();

      await adapter.query(
        'ALTER TABLE "probe_type" ALTER COLUMN "txt" SET DATA TYPE varchar(500)'
      );

      // Widening a varchar rewrites nothing, which is the cheap case the
      // fix tells a person to look for first
      const widened = await filenode();

      await adapter.query(
        'ALTER TABLE "probe_type" ALTER COLUMN "n" SET DATA TYPE bigint'
      );

      // Growing an integer rewrites the whole table under an exclusive lock
      expect(widened).toBe(before);
      expect(await filenode()).not.toBe(before);
    }
  );

  test('a dropped column is taken, so the danger is the deploy and not the lock', async () => {
    await filled(
      'probe_drop',
      `${quote('txt')} varchar(64), ${quote('n')} integer`
    );

    expect(
      await run(`ALTER TABLE ${quote('probe_drop')} DROP COLUMN ${quote('n')}`)
    ).toBeNull();
  });
});
