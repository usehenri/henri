const fs = require('fs');
const path = require('path');

const {
  Drizzle,
  build,
  fakeHenri,
  target,
  taskModel,
  tmpdir,
  userModel,
} = require('./helpers');

/**
 * What MariaDB does, asserted against a MariaDB server.
 *
 * `@usehenri/mysql` is the adapter `"adapter": "mariadb"` resolves to and a
 * `mariadb://` url is served by mysql2, so henri has always said MariaDB
 * was served by the MySQL adapter. Nothing ever ran there. This is what
 * runs: `HENRI_TEST_MARIADB_URL` points the SQL suites at a MariaDB server
 * (`pnpm test:sql:mariadb`), the handful of tests that cannot pass there
 * are skipped on `target.eagerLoads` / `target.introspects`, and this file
 * is where those two refusals are **asserted** rather than skipped -- the
 * `engines.spec.js` arrangement, and for the same reason: they are claims
 * about a database, so they are made against one. The day either of them
 * starts working, this file is what fails and says so.
 *
 * Measured against MariaDB 10.11.19 and 11.8.9, drizzle-orm 0.45.2 and
 * drizzle-kit 0.31.10. Everything asserted here is a difference of the
 * **server** -- henri compiles the same MySQL dialect for both and the
 * driver is mysql2 either way.
 *
 * What is *not* here is everything that simply works: the model API, the
 * exact types, the time zones, the queue, the trail, versions, retention,
 * the call log and its RANGE partitions, filters, slugs, csv and the
 * encryption all run against this server through the suites they already
 * have.
 */

const describeIf = target.server === 'mariadb' ? describe : describe.skip;

describeIf('what MariaDB does', () => {
  describe('the server', () => {
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      adapter.addModel(taskModel, 'user');
      adapter.addModel(userModel, 'user');
      await adapter.start();
    });

    afterAll(async () => {
      if (adapter) {
        await adapter.stop();
      }
    });

    test('is MariaDB, reached with the mysql dialect and mysql2', async () => {
      const [row] = await adapter.query('SELECT VERSION() AS version');

      expect(String(row.version)).toMatch(/mariadb/iu);
      expect(adapter.dialect.name).toBe('mysql');
      expect(target.name).toBe('mysql');
    });

    test('keeps the display width MySQL 8 dropped, and has no JSON type', async () => {
      const rows = await adapter.query(
        `SELECT column_name AS name, column_type AS type
         FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'users'`
      );
      const columns = Object.fromEntries(
        rows.map((row) => [row.name, String(row.type).toLowerCase()])
      );

      // MySQL 8 says `int` here
      expect(columns.id).toBe('int(11)');
      // `JSON` is an alias for `LONGTEXT` with a CHECK next to it, so the
      // user model's `roles` is a longtext -- which is what the check
      // constraint below is, and what drizzle-kit then cannot read back
      expect(columns.roles).toBe('longtext');
    });

    test('gives every json column a CHECK constraint of its own', async () => {
      const rows = await adapter.query(
        `SELECT constraint_name AS name, check_clause AS clause
         FROM information_schema.check_constraints
         WHERE constraint_schema = DATABASE() AND table_name = 'users'`
      );

      expect(rows.map((row) => row.name)).toContain('roles');
      expect(String(rows[0].clause)).toMatch(/json_valid/iu);
    });

    test('answers COLUMN_DEFAULT as an expression and not as a value', async () => {
      await adapter.query(
        'CREATE TABLE defaults_probe (' +
          "a varchar(20), b varchar(20) DEFAULT 'hi', " +
          'c datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))'
      );

      const rows = await adapter.query(
        `SELECT column_name AS name, column_default AS dflt, extra AS extra
         FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'defaults_probe'`
      );
      const columns = Object.fromEntries(
        rows.map((row) => [row.name, { dflt: row.dflt, extra: row.extra }])
      );

      // MySQL 8 answers SQL NULL, `hi` and CURRENT_TIMESTAMP(3) marked
      // DEFAULT_GENERATED. MariaDB answers SQL, all three times -- which is
      // what `dump.js` reads differently, and what wrote `DEFAULT 'NULL'`
      // into a schema dump before it did
      expect(columns.a.dflt).toBe('NULL');
      expect(columns.b.dflt).toBe("'hi'");
      expect(columns.c.dflt).toBe('current_timestamp(3)');
      expect(String(columns.c.extra)).not.toContain('DEFAULT_GENERATED');

      await adapter.query('DROP TABLE defaults_probe');
    });
  });

  describe('what does not work, and whose it is', () => {
    test('eager loading is a syntax error: MariaDB has no LATERAL', async () => {
      const { adapter } = build();

      adapter.addModel(
        {
          globalId: 'Author',
          identity: 'author',
          options: { timestamps: false },
          schema: { name: { type: 'string' } },
        },
        'user'
      );

      const Post = adapter.addModel(
        {
          /**
           * Points a post at an author
           *
           * @param {object} models The models
           * @returns {void}
           */
          associate: (models) => models.Post.belongsTo(models.Author),
          globalId: 'Post',
          identity: 'post',
          options: { timestamps: false },
          schema: { title: { type: 'string' } },
        },
        'user'
      );

      await adapter.start();

      const { Author } = adapter.getModels();
      const ada = await Author.create({ name: 'Ada' });

      await Post.create({ authorId: ada.id, title: 'first' });

      // The MySQL relational query builder of drizzle-orm eager loads with
      // `LEFT JOIN LATERAL (...) ON TRUE`; MariaDB has no LATERAL derived
      // tables, so the server refuses to parse it. henri writes none of
      // that SQL: it hands the `with` tree to drizzle
      await expect(Post.include('author').first()).rejects.toMatchObject({
        message: expect.stringMatching(/lateral|syntax/iu),
      });

      await adapter.stop();
    });

    test('a push cannot read a schema back once a json column is in it', async () => {
      const key = path.join(tmpdir('henri-mariadb-'), 'push.db');
      const first = build({}, {}, key);

      first.adapter.addModel(taskModel, 'user');
      first.adapter.addModel(userModel, 'user');

      // The first push, into an empty database, works: there is no CHECK
      // constraint to read yet
      await first.adapter.start();
      await first.adapter.stop();

      // The second reads the schema back, and drizzle-kit's
      // check-constraint pass reads `row["TABLE_NAME"]` out of rows its own
      // query labelled `table_name`. It throws, and drizzle-kit answers a
      // task that threw with `process.exit(1)`. henri catches the exit
      const second = build({}, {}, key);

      second.adapter.addModel(taskModel, 'user');
      second.adapter.addModel(userModel, 'user');

      await expect(second.adapter.start()).rejects.toMatchObject({
        code: 'HENRI_MIGRATION_PUSH_FAILED',
        message: expect.stringContaining('ended the process'),
      });

      await second.adapter.stop();
    });
  });

  describe('what to do instead', () => {
    let dir;

    beforeEach(() => {
      dir = tmpdir('henri-mariadb-migrations-');
    });

    afterEach(() => {
      fs.rmSync(dir, { force: true, recursive: true });
    });

    /**
     * An adapter that never pushes, with its migrations in a directory
     *
     * @param {string} file The database of the store
     * @returns {object} `{ adapter, henri }`
     */
    const adapterIn = (file) => {
      const henri = fakeHenri({});
      const adapter = target.prepare(
        new Drizzle(
          'default',
          {
            migrationsFolder: path.join(dir, 'db/migrations'),
            schemaFile: path.join(dir, 'db/schema.sql'),
            sync: false,
            ...target.store(path.join(dir, file)),
          },
          henri
        )
      );

      adapter.addModel(taskModel, 'user');
      adapter.addModel(userModel, 'user');

      return { adapter, henri };
    };

    test('db:generate then db:migrate, with the store pushing nothing', async () => {
      const { adapter } = adapterIn('app.db');

      await adapter.start();

      const written = await adapter.migrations.generate({ name: 'init' });

      expect(written.tag).toBe('0000_init');
      expect(fs.existsSync(written.file)).toBe(true);
      // Nothing was pushed, so nothing is recorded as applied
      expect(written.recorded).toEqual([]);
      expect(await adapter.migrations.status()).toMatchObject({
        applied: [],
        pending: ['0000_init'],
      });

      expect((await adapter.migrations.migrate()).applied).toEqual([
        '0000_init',
      ]);

      const { Task } = adapter.getModels();
      const task = await Task.create({ name: 'a row' });

      expect(task.name).toBe('a row');
      expect(await Task.count()).toBe(1);

      await adapter.stop();
    });

    test('a generate that cannot read the database back says so and stays pending', async () => {
      const { adapter, henri } = adapterIn('app.db');

      await adapter.start();
      await adapter.migrations.generate({ name: 'init' });
      await adapter.migrations.migrate();

      // The tables are there now, json column and all, so the plan
      // `generate()` runs to decide whether to record the next migration as
      // applied is the one that cannot run. The file is still written
      adapter.addModel(
        {
          ...taskModel,
          schema: { ...taskModel.schema, priority: { type: 'integer' } },
        },
        'user'
      );
      adapter.compile();

      const second = await adapter.migrations.generate({ name: 'priority' });

      expect(second.tag).toBe('0001_priority');
      expect(fs.existsSync(second.file)).toBe(true);
      expect(second.recorded).toEqual([]);
      expect(
        henri.calls.some(
          (call) =>
            call[0] === 'warn' && /could not be read back/u.test(call[2])
        )
      ).toBe(true);

      await adapter.stop();
    });

    test('a schema dump reads back and loads, defaults and all', async () => {
      const { adapter } = adapterIn('app.db');

      await adapter.start();
      await adapter.migrations.generate({ name: 'init' });
      await adapter.migrations.migrate();

      const { text } = await adapter.dump.render();

      // The defaults of a MariaDB catalogue are SQL, so a nullable column
      // carries no DEFAULT at all and a function default is not quoted.
      // Before this was read the way MariaDB answers it, every nullable
      // column of a dump taken here said `DEFAULT 'NULL'` -- silently a
      // four letter string on a varchar, and a refusal on a datetime
      expect(text).not.toContain("DEFAULT 'NULL'");
      expect(text).not.toContain("DEFAULT 'current_timestamp");
      expect(text).toContain('`roles` longtext');

      // And the server takes back what henri wrote
      await adapter.dump.write();
      await adapter.query('SET FOREIGN_KEY_CHECKS = 0');

      for (const table of await adapter.listTables()) {
        await adapter.query(`DROP TABLE IF EXISTS \`${table}\``);
      }

      await adapter.query('SET FOREIGN_KEY_CHECKS = 1');

      const loaded = await adapter.dump.load();

      expect(loaded.statements).toBeGreaterThan(0);
      expect(await adapter.listTables()).toEqual(
        expect.arrayContaining(['tasks', 'users'])
      );

      await adapter.stop();
    });
  });

  describe('the exact types, which the shared suite cannot reach here', () => {
    let Ledger;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Ledger = adapter.addModel(
        {
          globalId: 'Ledger',
          identity: 'ledger',
          options: { timestamps: false },
          schema: {
            count: { type: 'bigint' },
            label: { type: 'string' },
            total: { scale: 2, type: 'decimal' },
          },
          store: 'default',
        },
        'user'
      );
      await adapter.start();

      for (const [label, total, count] of [
        ['a', '9.99', '9223372036854775807'],
        ['b', '10.00', '-5'],
        ['c', '100.50', '0'],
        ['d', '-2.50', '9007199254740993'],
      ]) {
        await Ledger.create({ count, label, total });
      }
    });

    afterAll(async () => {
      if (adapter) {
        await adapter.stop();
      }
    });

    test('a decimal and a bigint come back as the digits that went in', async () => {
      const row = await Ledger.findOne({ label: 'a' });

      expect(row.total).toBe('9.99');
      expect(row.count).toBe('9223372036854775807');
    });

    test('a comparison is numeric at both ends of the 64-bit range', async () => {
      // `'9.99' > '10'` letter by letter, and the row with 9.99 is the one
      // that must not come back
      const above = await Ledger.find(
        { total: { gte: '10' } },
        { order: 'label' }
      );
      const big = await Ledger.find(
        { count: { gt: '9007199254740992' } },
        { order: 'label' }
      );

      expect(above.map((row) => row.label)).toEqual(['b', 'c']);
      expect(big.map((row) => row.label)).toEqual(['a', 'd']);
    });

    test('an order is numeric, negatives included', async () => {
      const totals = await Ledger.find({}, { order: 'total' });
      const counts = await Ledger.find({}, { order: 'count' });

      expect(totals.map((row) => row.label)).toEqual(['d', 'a', 'b', 'c']);
      expect(counts.map((row) => row.label)).toEqual(['b', 'c', 'd', 'a']);
    });
  });
});
