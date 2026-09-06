const { Sequelize } = require('sequelize');

/**
 * The database the adapter suites run on.
 *
 * Nothing set: an in-memory sqlite database, as before, so `pnpm test`
 * stays fast and offline. With `HENRI_TEST_POSTGRES_URL` or
 * `HENRI_TEST_MYSQL_URL` in the environment the same suites run against
 * that server instead; `HENRI_TEST_SQL_DIALECT` picks one when both are
 * set (postgres wins otherwise).
 *
 * The url in the environment is only used to connect and to create
 * databases: every store gets its own `henri_test_*` database so the test
 * files, which vitest runs in parallel, never share a table. They are
 * dropped when the file is done (`cleanup()`, called by the helpers).
 *
 * Only `@usehenri/mssql` reaches Sequelize now, and no CI job runs a SQL
 * Server. The PostgreSQL and MySQL servers are what is available to
 * exercise the base class that adapter rides on, which is why these suites
 * still run against them.
 */

const ENV = {
  mysql: 'HENRI_TEST_MYSQL_URL',
  postgres: 'HENRI_TEST_POSTGRES_URL',
};

const ALIASES = {
  mariadb: 'mysql',
  mysql: 'mysql',
  pg: 'postgres',
  postgres: 'postgres',
  postgresql: 'postgres',
};

// One prefix per process, so parallel workers never pick the same name
const RUN = `${process.pid.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The dialect asked for in the environment
 *
 * @returns {string} sqlite, postgres or mysql
 */
const selected = () => {
  const wanted = ALIASES[String(process.env.HENRI_TEST_SQL_DIALECT || '')];
  const names = wanted ? [wanted] : ['postgres', 'mysql'];

  return names.find((entry) => process.env[ENV[entry]]) || 'sqlite';
};

const name = selected();
const baseUrl = process.env[ENV[name]] || null;
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
 * The connection to the server itself, opened once per test file
 *
 * @returns {object} A Sequelize instance
 */
const adminClient = () => {
  if (!admin) {
    admin = new Sequelize(baseUrl, { logging: false });
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
  const statement =
    name === 'postgres'
      ? `DROP DATABASE IF EXISTS "${database}"`
      : `DROP DATABASE IF EXISTS \`${database}\``;

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

  // The dialect keeps a native ENUM column type
  enums: name !== 'sqlite',
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
  quote: (identifier) =>
    name === 'mysql' ? `\`${identifier}\`` : `"${identifier}"`,

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

    return { dialect: name, url: urlFor(databaseFor(key)) };
  },
};

module.exports = target;
