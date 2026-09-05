const dialects = require('../dialects');

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
 */

const ENV = {
  mysql: 'HENRI_TEST_MYSQL_URL',
  postgres: 'HENRI_TEST_POSTGRES_URL',
};

// One prefix per process, so parallel workers never pick the same name
const RUN = `${process.pid.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The dialect asked for in the environment
 *
 * @returns {string} sqlite, postgres or mysql
 */
const selected = () => {
  const wanted = dialects.get(process.env.HENRI_TEST_SQL_DIALECT);
  const names = wanted ? [wanted.name] : ['postgres', 'mysql'];

  return names.find((name) => process.env[ENV[name]]) || 'sqlite';
};

const name = selected();
const baseUrl = process.env[ENV[name]] || null;
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
      return {
        dialect: 'sqlite',
        url: typeof key === 'undefined' ? ':memory:' : `file:${key}`,
      };
    }

    return { dialect: name, url: urlFor(databaseFor(key)) };
  },
};

module.exports = target;
