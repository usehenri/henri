const { Sequelize } = require('sequelize');

/**
 * The database the adapter suites run on.
 *
 * Nothing set: an in-memory sqlite database, as before, so `pnpm test`
 * stays fast and offline. With `HENRI_TEST_POSTGRES_URL`,
 * `HENRI_TEST_MYSQL_URL`, `HENRI_TEST_MARIADB_URL` or `HENRI_TEST_MSSQL_URL`
 * in the environment the same suites run against that server instead;
 * `HENRI_TEST_SQL_DIALECT` picks one when several are set (postgres, then
 * mysql, then mariadb, then mssql).
 *
 * MariaDB is a **server** rather than a dialect here: Sequelize's own
 * `mariadb` dialect needs the `mariadb` driver, which this package does not
 * carry, and what henri reaches a MariaDB server with is the MySQL dialect
 * over mysql2 (`mariadbRewrite` in `index.js` rewrites a `mariadb://` url
 * for exactly that). So `name` stays `mysql` and `server` says which of the
 * two answered -- and `Drift#serverDialect()` asks the server itself, which
 * is what makes `henri db:status` right on both.
 *
 * The one suite that reaches a MariaDB server on purpose is
 * `@usehenri/jobs`, whose helpers build their stores through this file: the
 * queue's claim, its concurrency slots and its batches are SQL henri wrote
 * itself, and running them on MariaDB is the whole point.
 *
 * The url in the environment is only used to connect and to create
 * databases: every store gets its own `henri_test_*` database so the test
 * files, which vitest runs in parallel, never share a table. They are
 * dropped when the file is done (`cleanup()`, called by the helpers).
 *
 * Only `@usehenri/mssql` reaches Sequelize now, so SQL Server is the server
 * that matters here and `compose.yaml` has one (`pnpm test:sql:mssql`). The
 * PostgreSQL and MySQL servers stay: they are what the CI runs, and they
 * exercise the same base class on the two dialects an application used to
 * reach through it.
 */

const ENV = {
  mariadb: 'HENRI_TEST_MARIADB_URL',
  mssql: 'HENRI_TEST_MSSQL_URL',
  mysql: 'HENRI_TEST_MYSQL_URL',
  postgres: 'HENRI_TEST_POSTGRES_URL',
};

const ALIASES = {
  mariadb: 'mariadb',
  mssql: 'mssql',
  mysql: 'mysql',
  pg: 'postgres',
  postgres: 'postgres',
  postgresql: 'postgres',
  sqlserver: 'mssql',
};

/** The order the servers are taken in when the environment names none */
const ORDER = ['postgres', 'mysql', 'mariadb', 'mssql'];

// One prefix per process, so parallel workers never pick the same name
const RUN = `${process.pid.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The server asked for in the environment
 *
 * @returns {string} sqlite, postgres, mysql, mariadb or mssql
 */
const selected = () => {
  const wanted = ALIASES[String(process.env.HENRI_TEST_SQL_DIALECT || '')];
  const names = wanted ? [wanted] : ORDER;

  return names.find((entry) => process.env[ENV[entry]]) || 'sqlite';
};

const server = selected();
const name = server === 'mariadb' ? 'mysql' : server;
const baseUrl = process.env[ENV[server]] || null;
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
 * the same key share one database
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
 * What SQL Server needs and the other two do not
 *
 * The driver: pnpm links strictly, so `require('tedious')` from inside the
 * sequelize package resolves to nothing. It is a devDependency of this one
 * and its path is handed over; `pg`, `mysql2` and `sqlite3` are found
 * because Sequelize declares them itself.
 *
 * And the timeouts: tedious gives a request 15 seconds, which is plenty for
 * one statement (a `CREATE DATABASE` takes 200ms on an idle server) and not
 * enough for thirty test files asking for one at the same moment --
 * SQL Server serializes those on the `model` database, and a run under
 * emulation queues behind itself. The statement is not slow, it is waiting,
 * so the answer is to wait for it rather than to run the files one at a
 * time.
 *
 * @returns {object} Sequelize options, empty on every other dialect
 */
const driverOptions = () =>
  name === 'mssql'
    ? {
        dialectModulePath: require.resolve('tedious'),
        dialectOptions: {
          options: { connectTimeout: 60000, requestTimeout: 120000 },
        },
      }
    : {};

/**
 * The connection to the server itself, opened once per test file
 *
 * @returns {object} A Sequelize instance
 */
const adminClient = () => {
  if (!admin) {
    admin = new Sequelize(baseUrl, { logging: false, ...driverOptions() });
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
  const client = adminClient();

  if (name === 'postgres') {
    const [rows] = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = '${database}'`
    );

    if (rows.length === 0) {
      await client.query(`CREATE DATABASE "${database}"`);
    }
  } else if (name === 'mssql') {
    // SQL Server has no `IF NOT EXISTS` on CREATE DATABASE
    await client.query(
      `IF DB_ID(N'${database}') IS NULL CREATE DATABASE [${database}]`
    );
  } else {
    await client.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
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
  const client = adminClient();
  // SQL Server refuses to drop a database a connection still holds and has
  // no `WITH (FORCE)`: SINGLE_USER is how the last pool is thrown out
  const statements = {
    mssql:
      `IF DB_ID(N'${database}') IS NOT NULL BEGIN ` +
      `ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; ` +
      `DROP DATABASE [${database}]; END`,
    mysql: `DROP DATABASE IF EXISTS \`${database}\``,
    postgres: `DROP DATABASE IF EXISTS "${database}"`,
  };
  const statement = statements[name] || statements.mysql;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await client.query(statement);

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

const target = {
  // The name the adapter logs with (the dialect packages set their own)
  adapterName: name === 'postgres' ? 'postgres' : name,

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
      await client.close();
    }
  },

  // The dialect keeps a native ENUM column type. SQL Server has none, so
  // like sqlite it takes the `isIn` path of ./schema.js
  enums: name !== 'sqlite' && name !== 'mssql',
  live: Boolean(baseUrl),
  name,

  /**
   * Creates the database of a store before its first start
   *
   * @param {object} adapter A store adapter
   * @returns {object} The adapter
   */
  prepare: (adapter) => {
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

  /**
   * Quotes an identifier for a raw query
   *
   * @param {string} identifier A table or column name
   * @returns {string} The quoted identifier
   */
  quote: (identifier) => {
    if (name === 'mysql') {
      return `\`${identifier}\``;
    }

    // SQL Server quotes with brackets unless QUOTED_IDENTIFIER is on, which
    // is not something a raw query in a suite should have to assume
    return name === 'mssql' ? `[${identifier}]` : `"${identifier}"`;
  },

  // Which server answered: `name` is the dialect it speaks, this is what it
  // is. The two differ for mariadb alone
  server,

  /**
   * The store configuration of a database on the target
   *
   * @param {string} [key] A stable key: the same key gives the same
   *   database (and the same sqlite file)
   * @returns {object} A store configuration
   */
  store: (key) => {
    if (!baseUrl) {
      return {
        dialect: 'sqlite',
        storage: typeof key === 'undefined' ? ':memory:' : key,
      };
    }

    return {
      dialect: name,
      ...driverOptions(),
      url: urlFor(databaseFor(key)),
    };
  },
};

module.exports = target;
