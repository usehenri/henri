const fs = require('fs');
const os = require('os');
const path = require('path');

const dialects = require('../dialects');

/**
 * The database the adapter suites run on.
 *
 * Nothing set: an in-memory sqlite database, as before, so `pnpm test`
 * stays fast and offline. With `HENRI_TEST_POSTGRES_URL`,
 * `HENRI_TEST_MYSQL_URL` or `HENRI_TEST_MARIADB_URL` in the environment the
 * same suites run against that server instead; `HENRI_TEST_SQL_DIALECT`
 * picks one when more than one is set (postgres first otherwise).
 *
 * ## The server and the dialect are two things
 *
 * MariaDB is a **server** and not a dialect: it answers the MySQL wire
 * protocol, mysql2 connects to it, drizzle compiles the MySQL dialect for
 * it and `"adapter": "mariadb"` is `@usehenri/mysql` with nothing changed.
 * So `name` stays `mysql` there -- every suite written for the MySQL
 * dialect runs unchanged -- and `server` says which of the two answered.
 * Only what the *server* does differently is branched on `server`, and each
 * of those branches is a measurement rather than a precaution:
 * `eagerLoads` and `introspects` below, and the column spellings of
 * `dialect.spec.js`. `mariadb.spec.js` is where the differences are
 * asserted instead of skipped.
 *
 * The url in the environment is only used to connect and to create
 * databases: every store gets its own `henri_test_*` database so the test
 * files, which vitest runs in parallel, never share a table. They are
 * dropped when the file is done (`cleanup()`, called by the helpers).
 */

const ENV = {
  mariadb: 'HENRI_TEST_MARIADB_URL',
  mysql: 'HENRI_TEST_MYSQL_URL',
  postgres: 'HENRI_TEST_POSTGRES_URL',
};

/** What `HENRI_TEST_SQL_DIALECT` may name, and the server it picks */
const SERVERS = {
  mariadb: 'mariadb',
  mysql: 'mysql',
  pg: 'postgres',
  postgres: 'postgres',
  postgresql: 'postgres',
};

/** The order the servers are taken in when the environment names none */
const ORDER = ['postgres', 'mysql', 'mariadb'];

// One prefix per process, so parallel workers never pick the same name
const RUN = `${process.pid.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The server asked for in the environment
 *
 * @returns {string} sqlite, postgres, mysql or mariadb
 */
const selected = () => {
  const wanted = SERVERS[String(process.env.HENRI_TEST_SQL_DIALECT || '')];
  const names = wanted ? [wanted] : ORDER;

  return names.find((entry) => process.env[ENV[entry]]) || 'sqlite';
};

const server = selected();
const name = server === 'mariadb' ? 'mysql' : server;
const baseUrl = process.env[ENV[server]] || null;
const dialect = dialects.get(name);
const created = new Set();
const databases = new Map();

let sequence = 0;
let admin = null;

/**
 * The url of the environment, pointed at another database
 *
 * @param {string} database A database name
 * @returns {string} A connection url
 */
const urlFor = (database) => {
  const url = new URL(baseUrl);

  url.pathname = `/${database}`;

  return url.toString();
};

/**
 * The database name of a store, memoized by key so two stores built with
 * the same key (the sqlite file of the suites) share one database
 *
 * @param {string} [key] A stable key, or nothing for a brand new database
 * @returns {string} A database name
 */
const databaseFor = (key) => {
  if (typeof key === 'undefined') {
    sequence += 1;

    return `henri_test_${RUN}_${sequence}`;
  }

  if (!databases.has(key)) {
    sequence += 1;
    databases.set(key, `henri_test_${RUN}_${sequence}`);
  }

  return databases.get(key);
};

/**
 * The connection to the server itself, opened once per test file
 *
 * @returns {Promise<object>} A driver client
 */
const adminClient = async () => {
  if (!admin) {
    admin = await dialect.connect({ url: baseUrl });
  }

  return admin;
};

/**
 * Creates the database of a store when it is missing
 *
 * @param {string} database A database name
 * @returns {Promise<void>} Resolves when it exists
 */
const createDatabase = async (database) => {
  const client = await adminClient();

  if (name === 'postgres') {
    const rows = await dialect.query(
      client,
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database]
    );

    if (rows.length === 0) {
      await dialect.query(client, `CREATE DATABASE "${database}"`);
    }
  } else {
    await dialect.query(
      client,
      `CREATE DATABASE IF NOT EXISTS \`${database}\``
    );
  }

  created.add(database);
};

/**
 * Drops a database once the driver let go of it
 *
 * Postgres refuses to drop a database another connection still holds, and
 * a pool that was just closed can take a moment to disappear: the drop is
 * retried, then given up on (a leftover database is not a test failure,
 * and the servers of the CI are thrown away).
 *
 * @param {string} database A database name
 * @returns {Promise<void>} Resolves when done
 */
const dropDatabase = async (database) => {
  const client = await adminClient();
  const statement =
    name === 'postgres'
      ? `DROP DATABASE IF EXISTS "${database}"`
      : `DROP DATABASE IF EXISTS \`${database}\``;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await dialect.query(client, statement);

      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
};

/**
 * The database name of a connection url
 *
 * @param {string} url A connection url
 * @returns {?string} The database, or null
 */
const databaseOf = (url) => {
  try {
    return new URL(url).pathname.replace(/^\//, '') || null;
  } catch (error) {
    return null;
  }
};

/** Where a keyed sqlite database goes: a directory of this run, not the cwd */
const SQLITE_DIR = path.join(os.tmpdir(), `henri-sqlite-${RUN}`);

/**
 * The path of a keyed sqlite database
 *
 * @param {string} key The stable key
 * @returns {string} An absolute path inside this run's directory
 */
const fileFor = (key) => {
  fs.mkdirSync(SQLITE_DIR, { recursive: true });

  return path.join(SQLITE_DIR, `${key}.sqlite`);
};

const target = {
  /**
   * Drops the databases this file created and closes the connection
   *
   * @returns {Promise<void>} Resolves when done
   */
  cleanup: async () => {
    if (!baseUrl) {
      return;
    }

    for (const database of created) {
      await dropDatabase(database);
    }

    created.clear();

    if (admin) {
      const client = admin;

      admin = null;
      await dialect.close(client);
    }
  },

  dialect,

  /**
   * Does `include()` reach this server?
   *
   * drizzle-orm 0.45's MySQL relational query builder eager loads with
   * `LEFT JOIN LATERAL (...) ON TRUE` (`mysql-core/dialect.cjs`, the
   * `lateral: true` join it builds for a `with`). **MariaDB has no LATERAL
   * derived tables at all**, in any version through 11.8, so every
   * `include()` is a 1064 syntax error there. henri writes none of that SQL
   * and has no seam to write it differently (`Relation#toArray` hands the
   * `with` tree to `db.query.<table>.findMany`), so this is drizzle-orm's
   * to fix and the suites that eager load are skipped rather than made to
   * pass. `mariadb.spec.js` asserts the syntax error.
   */
  eagerLoads: server !== 'mariadb',

  /**
   * Can drizzle-kit read this server's schema back?
   *
   * `pushMySQLSchema` introspects before it diffs, and its check-constraint
   * pass reads `row["TABLE_NAME"]` out of rows a `SELECT tc.table_name ...`
   * labelled `table_name`. On MySQL 8 the pass is dead code -- the query
   * returns nothing -- and on **MariaDB every `json` column carries an
   * implicit `CHECK (json_valid(...))`**, so the pass runs, reads
   * `undefined`, throws a TypeError, and drizzle-kit answers it with
   * `process.exit(1)`. The first push of an empty database works and every
   * one after it kills the process; the user model's `roles` is a `json`
   * column, so this is every application. drizzle-kit's, measured against
   * 0.31.10 on MariaDB 10.11 and 11.8. henri now catches the exit
   * (`HENRI_MIGRATION_PUSH_FAILED`), which is what `mariadb.spec.js`
   * asserts.
   */
  introspects: server !== 'mariadb',

  live: Boolean(baseUrl),
  name,

  /**
   * Creates the database of a store before its first start
   *
   * @param {object} adapter A store adapter
   * @returns {object} The adapter
   */
  prepare: (adapter) => {
    // Nothing to prepare on sqlite, nor for a store the suite pointed
    // somewhere else itself
    const database = baseUrl && databaseOf(adapter.config.url);

    if (!database || !database.startsWith(`henri_test_${RUN}`)) {
      return adapter;
    }

    const start = adapter.start.bind(adapter);

    adapter.start = async () => {
      await createDatabase(database);

      return start();
    };

    return adapter;
  },

  // Which server answered: `name` is the dialect it speaks, this is what it
  // is. The two differ for mariadb alone
  server,

  /**
   * The store configuration of a database on the target
   *
   * @param {string} [key] A stable key: the same key gives the same
   *   database (and the same sqlite file), so a suite can stop a store and
   *   open another one on it
   * @returns {object} A store configuration
   */
  store: (key) => {
    if (!baseUrl) {
      // A keyed sqlite target is a *file*, because the point of a key is
      // that two stores can open the same database. A bare name would put
      // it in whatever directory vitest was started from -- the repository
      // root -- so it goes under a directory of this run instead, and the
      // process cleans up after itself
      return {
        dialect: 'sqlite',
        url: typeof key === 'undefined' ? ':memory:' : `file:${fileFor(key)}`,
      };
    }

    return { dialect: name, url: urlFor(databaseFor(key)) };
  },
};

module.exports = target;
