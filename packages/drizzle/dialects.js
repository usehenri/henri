const fs = require('fs');
const path = require('path');
const { sql } = require('drizzle-orm');

/**
 * Everything that differs between sqlite, postgres and mysql: the driver,
 * the Drizzle core (table and column builders), the connection, raw
 * queries, and the drizzle-kit functions that snapshot, diff and push a
 * schema.
 *
 * A dialect is a plain object; `get(name)` resolves the aliases
 * (`postgresql`, `pg`, `mariadb`, `better-sqlite3`).
 */

const ALIASES = {
  'better-sqlite3': 'sqlite',
  mariadb: 'mysql',
  mysql: 'mysql',
  mysql2: 'mysql',
  pg: 'postgres',
  postgres: 'postgres',
  postgresql: 'postgres',
  sqlite: 'sqlite',
  sqlite3: 'sqlite',
};

/**
 * Requires a driver from the application first (an app installs the driver
 * it needs), then from this package (tests)
 *
 * @param {string} name Module name
 * @returns {*} The module
 * @throws {Error} When the driver is not installed
 */
const requireDriver = (name) => {
  try {
    return require(
      require.resolve(name, { paths: [process.cwd(), __dirname] })
    );
  } catch (error) {
    throw new Error(
      `drizzle: the '${name}' driver is not installed; add it to the dependencies of the application`,
      { cause: error }
    );
  }
};

/**
 * Resolves the sqlite file of a store configuration
 *
 * Accepts `:memory:`, `file:./path.db`, `file:///abs/path.db`,
 * `sqlite://path.db` and plain paths (relative to the working directory).
 *
 * @param {object} config Store configuration
 * @returns {string} A file path or `:memory:`
 */
const sqliteFile = (config) => {
  const raw = config.url || config.storage || config.file || config.database;

  if (!raw || /^(file:|sqlite:\/?\/?)?:memory:/i.test(raw)) {
    return ':memory:';
  }

  // file:///abs, sqlite://relative, file:/abs, file:relative, plain paths
  const stripped = String(raw)
    .replace(/^(sqlite|file):\/\//i, '')
    .replace(/^(sqlite|file):/i, '')
    .split('?')[0];

  return path.resolve(process.cwd(), stripped);
};

/**
 * Connection options from a store configuration (`host`, `port`,
 * `database`, `username`, `password`, `ssl`, `pool`)
 *
 * @param {object} config Store configuration
 * @returns {object} Driver options
 */
const credentials = (config) => {
  const options = { ...(config.pool || {}) };

  ['host', 'port', 'database', 'password', 'ssl'].forEach((key) => {
    if (typeof config[key] !== 'undefined') {
      options[key] = config[key];
    }
  });

  if (typeof config.username !== 'undefined') {
    options.user = config.username;
  }

  return options;
};

/**
 * The driver error behind a wrapper: drizzle-orm reports the failures of
 * the asynchronous drivers as a `DrizzleQueryError` carrying the driver
 * error as its `cause`
 *
 * @param {Error} error The error thrown by drizzle
 * @returns {Error} The first error of the chain with a `code`
 */
const driverError = (error) => {
  let current = error;

  while (current && !current.code && current.cause) {
    current = current.cause;
  }

  return current || error;
};

/**
 * Unique constraint violations are turned into validation errors by the
 * model layer; each dialect extracts the column names from its driver error
 *
 * @param {object} error A driver error
 * @param {object} details Parsed details (`columns`)
 * @returns {object} The error, flagged
 */
const uniqueViolation = (error, details) =>
  Object.assign(error, {
    henri: { columns: details.columns, key: details.key, kind: 'unique' },
  });

const sqlite = {
  /**
   * How many rows a run() touched
   *
   * @param {object} result A better-sqlite3 run result
   * @returns {number} The number of rows
   */
  affected: (result) => Number((result && result.changes) || 0),

  /**
   * Closes the database
   *
   * @param {object} client A better-sqlite3 database
   * @returns {Promise<void>} Resolves when closed
   */
  close: async (client) => {
    client.close();
  },

  /**
   * Opens the database (the directory of a file database is created)
   *
   * @param {object} config Store configuration
   * @returns {Promise<object>} The better-sqlite3 database
   */
  connect: async (config) => {
    const Database = requireDriver('better-sqlite3');
    const file = sqliteFile(config);

    if (file !== ':memory:') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }

    const client = new Database(file, config.options || {});

    client.pragma('foreign_keys = ON');

    if (file !== ':memory:' && config.wal !== false) {
      client.pragma('journal_mode = WAL');
    }

    return client;
  },

  core: () => require('drizzle-orm/sqlite-core'),

  /**
   * Describes the connection for the logs
   *
   * @param {object} config Store configuration
   * @returns {string} The file
   */
  describe: (config) => sqliteFile(config),

  /**
   * Builds the Drizzle instance
   *
   * @param {object} client A better-sqlite3 database
   * @param {object} schema Tables, relations and enums by key
   * @returns {object} A Drizzle database
   */
  drizzle: (client, schema) =>
    require('drizzle-orm/better-sqlite3').drizzle(client, { schema }),

  /**
   * Runs a DDL statement
   *
   * @param {object} db A Drizzle database
   * @param {string} statement The statement
   * @returns {Promise<void>} Resolves when run
   */
  exec: async (db, statement) => {
    db.run(sql.raw(statement));
  },

  /**
   * The primary key column of a model
   *
   * @param {object} core drizzle-orm/sqlite-core
   * @returns {object} A column builder
   */
  id: (core) => core.integer('id').primaryKey({ autoIncrement: true }),

  kit: {
    dialect: 'sqlite',
    migration: 'generateSQLiteMigration',
    push: 'pushSQLiteSchema',
    snapshot: 'generateSQLiteDrizzleJson',
  },

  /**
   * Lists the tables of the database
   *
   * @param {object} client A better-sqlite3 database
   * @returns {Promise<Array<string>>} Table names
   */
  listTables: async (client) =>
    client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
      .all()
      .map((row) => row.name),

  migrations: {
    create: [
      'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    ],
    ref: '__drizzle_migrations',
  },
  migrator: 'drizzle-orm/better-sqlite3/migrator',
  name: 'sqlite',

  /**
   * Checks the connection
   *
   * @param {object} client A better-sqlite3 database
   * @returns {Promise<boolean>} true
   */
  ping: async (client) => {
    client.prepare('SELECT 1').get();

    return true;
  },

  placeholder: () => '?',

  /**
   * Runs a raw query
   *
   * @param {object} client A better-sqlite3 database
   * @param {string} text SQL with `?` placeholders
   * @param {Array} params The parameters
   * @returns {Promise<*>} The rows, or the run result for writes
   */
  query: async (client, text, params = []) => {
    const statement = client.prepare(text);
    const args = Array.isArray(params) ? params : [params];

    return statement.reader ? statement.all(...args) : statement.run(...args);
  },

  returning: true,

  // The better-sqlite3 driver is synchronous: transactions are BEGIN/COMMIT
  synchronous: true,

  /**
   * Flags unique constraint violations
   *
   * @param {Error} error A driver error
   * @returns {Error} The error
   */
  translate: (error) => {
    const driver = driverError(error);

    if (driver && driver.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const prefix = 'UNIQUE constraint failed: ';
      const message = String(driver.message || '');
      const start = message.indexOf(prefix);
      const columns =
        start >= 0
          ? message
              .slice(start + prefix.length)
              .split(',')
              .map((entry) => entry.trim().split('.').pop())
          : [];

      return uniqueViolation(error, { columns });
    }

    return error;
  },

  /**
   * Column builder for a normalized field
   *
   * @param {object} core drizzle-orm/sqlite-core
   * @param {string} column The column name
   * @param {object} field The normalized field
   * @returns {object} A column builder
   */
  type: (core, column, field) => {
    switch (field.type) {
      case 'integer':
        return core.integer(column);
      case 'number':
      case 'float':
        return core.real(column);
      case 'boolean':
        return core.integer(column, { mode: 'boolean' });
      case 'date':
        return core.integer(column, { mode: 'timestamp_ms' });
      case 'json':
        return core.text(column, { mode: 'json' });
      default:
        return field.enum && field.type === 'string'
          ? core.text(column, { enum: field.enum })
          : core.text(column);
    }
  },

  /**
   * Inserts or updates a row (express-session)
   *
   * @param {object} db A Drizzle database
   * @param {object} table The table
   * @param {object} values The row
   * @param {object} target The conflict column
   * @param {object} set The columns to update on conflict
   * @returns {Promise<void>} Resolves when written
   */
  upsert: async (db, table, values, target, set) => {
    await db.insert(table).values(values).onConflictDoUpdate({ set, target });
  },
};

const postgres = {
  affected: (result) => Number((result && result.rowCount) || 0),

  close: async (client) => {
    await client.end();
  },

  /**
   * Opens a connection pool (nothing connects before the first query)
   *
   * @param {object} config Store configuration
   * @returns {Promise<object>} A pg Pool
   */
  connect: async (config) => {
    const { Pool } = requireDriver('pg');
    const options = credentials(config);

    if (config.url) {
      options.connectionString = config.url;
    }

    return new Pool(options);
  },

  core: () => require('drizzle-orm/pg-core'),

  describe: (config) =>
    config.url || `${config.host || 'localhost'}/${config.database || ''}`,

  drizzle: (client, schema) =>
    require('drizzle-orm/node-postgres').drizzle(client, { schema }),

  exec: async (db, statement) => {
    await db.execute(sql.raw(statement));
  },

  id: (core) => core.integer('id').primaryKey().generatedByDefaultAsIdentity(),

  kit: {
    dialect: 'postgresql',
    migration: 'generateMigration',
    push: 'pushSchema',
    snapshot: 'generateDrizzleJson',
  },

  listTables: async (client) =>
    (
      await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
      )
    ).rows.map((row) => row.table_name),

  migrations: {
    create: [
      'CREATE SCHEMA IF NOT EXISTS "drizzle"',
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    ],
    ref: '"drizzle"."__drizzle_migrations"',
  },
  migrator: 'drizzle-orm/node-postgres/migrator',
  name: 'postgres',

  ping: async (client) => {
    await client.query('SELECT 1');

    return true;
  },

  placeholder: (index) => `$${index}`,

  query: async (client, text, params = []) =>
    (await client.query(text, params)).rows,

  returning: true,
  synchronous: false,

  translate: (error) => {
    const driver = driverError(error);

    if (driver && driver.code === '23505') {
      const detail = String(driver.detail || '');
      const start = detail.indexOf('Key (');
      const end = start >= 0 ? detail.indexOf(')=', start) : -1;
      const columns =
        end > start
          ? detail
              .slice(start + 'Key ('.length, end)
              .split(',')
              .map((entry) => entry.trim().replace(/"/g, ''))
          : [];

      return uniqueViolation(error, { columns });
    }

    return error;
  },

  type: (core, column, field, context) => {
    switch (field.type) {
      case 'integer':
        return core.integer(column);
      case 'number':
        return core.doublePrecision(column);
      case 'float':
        return core.real(column);
      case 'boolean':
        return core.boolean(column);
      case 'date':
        return core.timestamp(column, { mode: 'date', withTimezone: true });
      case 'json':
        return core.jsonb(column);
      case 'uuid':
        return core.uuid(column);
      case 'text':
        return core.text(column);
      default:
        if (field.enum && field.type === 'string') {
          const type = core.pgEnum(
            `${context.tableName}_${column}`,
            field.enum
          );

          context.enums[`${context.key}_${column}_enum`] = type;

          return type(column);
        }

        return core.varchar(column, { length: field.length || 255 });
    }
  },

  upsert: async (db, table, values, target, set) => {
    await db.insert(table).values(values).onConflictDoUpdate({ set, target });
  },
};

const mysql = {
  affected: (result) =>
    Number((Array.isArray(result) ? result[0] : result).affectedRows || 0),

  close: async (client) => {
    await client.end();
  },

  /**
   * Opens a connection pool; `mariadb://` urls are served by mysql2
   *
   * @param {object} config Store configuration
   * @returns {Promise<object>} A mysql2 pool
   */
  connect: async (config) => {
    const driver = requireDriver('mysql2/promise');
    const options = credentials(config);

    if (config.url) {
      options.uri = config.url.replace(/^mariadb:/i, 'mysql:');
    }

    return driver.createPool(options);
  },

  core: () => require('drizzle-orm/mysql-core'),

  describe: (config) =>
    config.url || `${config.host || 'localhost'}/${config.database || ''}`,

  drizzle: (client, schema) =>
    require('drizzle-orm/mysql2').drizzle(client, { mode: 'default', schema }),

  exec: async (db, statement) => {
    await db.execute(sql.raw(statement));
  },

  id: (core) => core.int('id').autoincrement().primaryKey(),

  kit: {
    dialect: 'mysql',
    migration: 'generateMySQLMigration',
    push: 'pushMySQLSchema',
    snapshot: 'generateMySQLDrizzleJson',
  },

  listTables: async (client) =>
    (
      await client.query(
        'SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE()'
      )
    )[0].map((row) => row.table_name),

  migrations: {
    create: [
      'CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (id serial primary key, hash text not null, created_at bigint)',
    ],
    ref: '`__drizzle_migrations`',
  },
  migrator: 'drizzle-orm/mysql2/migrator',
  name: 'mysql',

  ping: async (client) => {
    await client.query('SELECT 1');

    return true;
  },

  placeholder: () => '?',

  query: async (client, text, params = []) =>
    (await client.query(text, params))[0],

  returning: false,
  synchronous: false,

  translate: (error) => {
    const driver = driverError(error);

    if (driver && driver.code === 'ER_DUP_ENTRY') {
      const message = String(driver.message || '');
      const marker = "for key '";
      const start = message.indexOf(marker);
      const end = start >= 0 ? message.indexOf("'", start + marker.length) : -1;
      const key =
        end > start
          ? message
              .slice(start + marker.length, end)
              .split('.')
              .pop()
          : '';

      return uniqueViolation(error, { columns: [], key });
    }

    return error;
  },

  type: (core, column, field) => {
    switch (field.type) {
      case 'integer':
        return core.int(column);
      case 'number':
        return core.double(column);
      case 'float':
        return core.float(column);
      case 'boolean':
        return core.boolean(column);
      case 'date':
        return core.datetime(column, { fsp: 3, mode: 'date' });
      case 'json':
        return core.json(column);
      case 'uuid':
        return core.varchar(column, { length: 36 });
      case 'text':
        return core.text(column);
      default:
        return field.enum && field.type === 'string'
          ? core.mysqlEnum(column, field.enum)
          : core.varchar(column, { length: field.length || 255 });
    }
  },

  upsert: async (db, table, values, target, set) => {
    await db.insert(table).values(values).onDuplicateKeyUpdate({ set });
  },
};

const DIALECTS = { mysql, postgres, sqlite };

/**
 * Resolves a dialect by name or alias
 *
 * @param {string} name sqlite, postgres, postgresql, mysql, mariadb, ...
 * @returns {?object} The dialect or null
 */
const get = (name) => {
  const key = ALIASES[String(name || '').toLowerCase()];

  return key ? DIALECTS[key] : null;
};

/**
 * Guesses the dialect from a connection url
 *
 * @param {string} url A connection url
 * @returns {?object} The dialect or null
 */
const fromUrl = (url) => {
  const text = String(url || '');
  const colon = text.indexOf(':');
  const candidate = colon > 0 ? text.slice(0, colon).toLowerCase() : '';
  const isScheme =
    candidate.length > 0 &&
    [...candidate].every((char) => /[a-z0-9+-]/.test(char));

  if (!isScheme) {
    return /\.(db|sqlite|sqlite3)$/i.test(text) ? sqlite : null;
  }

  const [scheme] = candidate.split('+');

  if (scheme === 'file') {
    return sqlite;
  }

  return get(scheme);
};

module.exports = { DIALECTS, driverError, fromUrl, get, sqliteFile };
