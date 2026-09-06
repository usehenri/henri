const fs = require('fs');
const path = require('path');

const { CliError } = require('./errors');

/**
 * Creating and dropping the database itself, which is the one step every
 * other `henri db:` command assumes has already happened.
 *
 * `henri db:migrate` connects to a database; it cannot make one. Until now
 * an application wrote that step by hand -- the showcase carried a
 * `db/create.js` doing exactly this -- which is a framework telling on
 * itself, since it is the same twenty lines for everybody.
 *
 * The work happens without booting past the configuration: a store cannot
 * connect to a database that does not exist yet, so `db:create` reads
 * `config/<env>.json`, the environment, `DATABASE_URL` and the credentials
 * the way henri does, and then talks to the server with the driver the
 * application already installed.
 *
 * PostgreSQL and MySQL are created by connecting to the server's own
 * maintenance database and issuing a `CREATE DATABASE`. SQLite is a file, so
 * creating it is making its directory and dropping it is removing it.
 * MongoDB has nothing to create: it makes a database on the first write, and
 * saying so is more useful than pretending to act.
 */

/** The identifier characters a database name may carry, per dialect */
const NAME = /^[A-Za-z0-9_$-]+$/u;

/**
 * Requires a driver from the application, then from this package
 *
 * @param {string} name The module name
 * @param {string} dialect The dialect asking for it
 * @returns {*} The module
 * @throws {CliError} FAILED when the driver is not installed
 */
const driver = (name, dialect) => {
  try {
    return require(
      require.resolve(name, { paths: [process.cwd(), __dirname] })
    );
  } catch (error) {
    throw new CliError(
      'FAILED',
      `The ${name} driver is not installed, and ${dialect} needs it`,
      {
        cause: error,
        hint: `Add ${name} to the dependencies of the application`,
      }
    );
  }
};

/**
 * A connection string, parsed, or null when it is not one.
 *
 * A sqlite store's `url` is a file path, which is not a URL and is not
 * meant to be read as one.
 *
 * @param {*} url what the store calls its url
 * @returns {?URL} the parsed url
 */
const parse = (url) => {
  if (
    typeof url !== 'string' ||
    url === '' ||
    !/^[a-z][a-z0-9+.-]*:\/\//iu.test(url)
  ) {
    return null;
  }

  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/**
 * The connection settings of a store, url or fields
 *
 * @param {object} config The store configuration
 * @returns {object} `{ database, host, password, port, user }`
 * @throws {CliError} USAGE when the store names no database
 */
const connection = (config) => {
  const url = parse(config.url);

  if (url) {
    return {
      database: decodeURIComponent(url.pathname.replace(/^\//u, '')),
      host: url.hostname || '127.0.0.1',
      password: decodeURIComponent(url.password || '') || undefined,
      port: url.port ? Number(url.port) : null,
      user: decodeURIComponent(url.username || '') || undefined,
    };
  }

  return {
    database: config.database,
    host: config.host || '127.0.0.1',
    password: config.password,
    port: config.port ? Number(config.port) : null,
    user: config.username || config.user,
  };
};

/**
 * The database name of a store, checked before it reaches a statement.
 *
 * A name is an identifier, not a value, so it cannot be bound as a
 * parameter: it is validated against a character set and quoted instead.
 *
 * @param {object} config The store configuration
 * @param {string} store The store name, for the error
 * @returns {string} The database name
 * @throws {CliError} USAGE when there is no name, or it is not an identifier
 */
const databaseOf = (config, store) => {
  const { database } = connection(config);

  if (!database) {
    throw new CliError(
      'USAGE',
      `Store ${store} names no database: its url has no path and it has no "database" key`,
      { hint: 'postgres://user:password@host:5432/the_database_name' }
    );
  }

  if (!NAME.test(database)) {
    throw new CliError(
      'USAGE',
      `"${database}" is not a database name henri will create`,
      {
        hint: 'Letters, digits, underscores, dollars and dashes only. Create it by hand if the server really has a name like that.',
      }
    );
  }

  return database;
};

/** PostgreSQL: the maintenance database every server has */
const POSTGRES_MAINTENANCE = 'postgres';

/**
 * Runs one statement against a PostgreSQL server, on the maintenance
 * database rather than the one being created or dropped
 *
 * @param {object} config The store configuration
 * @param {string} statement The statement
 * @returns {Promise<object>} The pg result
 */
const postgresQuery = async (config, statement) => {
  const { Client } = driver('pg', 'postgres');
  const settings = connection(config);
  const client = new Client({
    database: POSTGRES_MAINTENANCE,
    host: settings.host,
    password: settings.password,
    port: settings.port || 5432,
    user: settings.user,
  });

  await client.connect();

  try {
    return await client.query(statement);
  } finally {
    await client.end();
  }
};

/**
 * Runs one statement against a MySQL server, connected to no database
 *
 * @param {object} config The store configuration
 * @param {string} statement The statement
 * @returns {Promise<*>} What the driver answered
 */
const mysqlQuery = async (config, statement) => {
  const mysql = driver('mysql2/promise', 'mysql');
  const settings = connection(config);
  const client = await mysql.createConnection({
    host: settings.host,
    multipleStatements: false,
    password: settings.password,
    port: settings.port || 3306,
    user: settings.user,
  });

  try {
    return await client.query(statement);
  } finally {
    await client.end();
  }
};

/**
 * The sqlite file of a store, or null when it is in memory
 *
 * @param {object} config The store configuration
 * @returns {?string} An absolute path, or null for `:memory:`
 */
const sqliteFile = (config) => {
  const raw =
    config.url || config.storage || config.file || config.database || '';

  if (raw === '' || /^(file:|sqlite:\/?\/?)?:memory:/iu.test(raw)) {
    return null;
  }

  const stripped = String(raw)
    .replace(/^(sqlite|file):\/\//iu, '')
    .replace(/^(sqlite|file):/iu, '')
    .split('?')[0];

  return path.resolve(process.cwd(), stripped);
};

/** What each dialect does to create, drop and look for a database */
const DIALECTS = {
  mongodb: {
    create: async () => ({ created: false, reason: 'first-write' }),
    drop: async () => ({ dropped: false, reason: 'unsupported' }),
    exists: async () => null,
  },
  mysql: {
    create: async (config, name) => {
      const [rows] = await mysqlQuery(
        config,
        `CREATE DATABASE IF NOT EXISTS \`${name}\``
      );

      return { created: (rows.affectedRows || 0) > 0 };
    },
    drop: async (config, name) => {
      const [rows] = await mysqlQuery(
        config,
        `DROP DATABASE IF EXISTS \`${name}\``
      );

      return { dropped: (rows.affectedRows || 0) >= 0 };
    },
    exists: async (config, name) => {
      const [rows] = await mysqlQuery(
        config,
        `SHOW DATABASES LIKE ${JSON.stringify(name).replace(/"/gu, "'")}`
      );

      return rows.length > 0;
    },
  },
  postgres: {
    create: async (config, name) => {
      await postgresQuery(config, `CREATE DATABASE "${name}"`);

      return { created: true };
    },
    drop: async (config, name) => {
      await postgresQuery(config, `DROP DATABASE IF EXISTS "${name}"`);

      return { dropped: true };
    },
    exists: async (config, name) => {
      const result = await postgresQuery(
        config,
        `SELECT 1 FROM pg_database WHERE datname = ${JSON.stringify(name).replace(/"/gu, "'")}`
      );

      return result.rowCount > 0;
    },
  },
  sqlite: {
    create: async (config) => {
      const file = sqliteFile(config);

      if (!file) {
        return { created: false, reason: 'memory' };
      }

      if (fs.existsSync(file)) {
        return { created: false };
      }

      fs.mkdirSync(path.dirname(file), { recursive: true });
      // A zero length file is an empty SQLite database, so the file exists
      // from now on and a second `db:create` says so instead of repeating
      fs.writeFileSync(file, '');

      return { created: true };
    },
    drop: async (config) => {
      const file = sqliteFile(config);

      if (!file) {
        return { dropped: false, reason: 'memory' };
      }

      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-journal`, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });

      return { dropped: true };
    },
    exists: async (config) => {
      const file = sqliteFile(config);

      return file ? fs.existsSync(file) : false;
    },
  },
};

/** What an adapter's `dialect` or `adapter` name means here */
const ALIASES = {
  disk: 'mongodb',
  mariadb: 'mysql',
  mongo: 'mongodb',
  mongodb: 'mongodb',
  mongoose: 'mongodb',
  mssql: 'mssql',
  mysql: 'mysql',
  mysql2: 'mysql',
  pg: 'postgres',
  postgres: 'postgres',
  postgresql: 'postgres',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
};

/**
 * The dialect of a store: what it says, then what its url says
 *
 * @param {object} config The store configuration
 * @param {string} store The store name, for the error
 * @returns {string} A key of DIALECTS
 * @throws {CliError} USAGE when the dialect is unknown or has no lifecycle
 */
const dialectOf = (config, store) => {
  const scheme =
    typeof config.url === 'string' ? config.url.split(':')[0] : null;
  const name =
    ALIASES[String(config.dialect || '').toLowerCase()] ||
    ALIASES[String(scheme || '').toLowerCase()] ||
    ALIASES[String(config.adapter || '').toLowerCase()] ||
    null;

  if (!name || !DIALECTS[name]) {
    throw new CliError(
      'USAGE',
      `henri db:create does not know how to create the database of store ${store}${name ? ` (${name})` : ''}`,
      {
        hint: 'PostgreSQL, MySQL and SQLite are handled; MongoDB creates a database on its first write. Create the others by hand.',
      }
    );
  }

  return name;
};

/**
 * A connection string with its password replaced, safe to print
 *
 * @param {object} config The store configuration
 * @returns {string} What the store points at
 */
const describe = (config, dialect) => {
  if (dialect === 'sqlite') {
    return sqliteFile(config) || ':memory:';
  }

  const { database, host, port, user } = connection(config);

  if (!parse(config.url)) {
    return database || String(config.url || '');
  }

  return `${database} on ${host}${port ? `:${port}` : ''}${user ? ` as ${user}` : ''}`;
};

module.exports = {
  DIALECTS,
  connection,
  databaseOf,
  describe,
  dialectOf,
  sqliteFile,
};
