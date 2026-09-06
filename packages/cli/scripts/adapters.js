const { CliError } = require('./errors');
const { readConfig } = require('./utils');

/**
 * The store adapters of henri, what an application needs to use one, and
 * the model API each one exposes.
 *
 * `api` is the flavour of the controllers `henri generate scaffold|crud`
 * writes: `mongoose` (disk and mongoose stores), `drizzle` (drizzle, and
 * the postgresql, mysql and mariadb adapters, which are that adapter with
 * a dialect chosen) or `sequelize`, which is now only mssql. It is read
 * back from `config/default.json`, so a generator always writes code the
 * configured store can run.
 *
 * `henri new --adapter <name>` scaffolds the ones in `SCAFFOLDS`: the store
 * block of `config/default.json`, the packages to install and the pnpm
 * build allowances the driver needs.
 *
 * Drizzle is henri's SQL data layer. `--adapter postgresql` and
 * `--adapter drizzle --dialect postgres` both reach it: the first through
 * `@usehenri/postgresql`, which brings the `pg` driver with it, the second
 * through `@usehenri/drizzle`, where the application installs the driver.
 * `@usehenri/sequelize` is behind `mssql` alone, because Drizzle has no
 * SQL Server dialect.
 */

/** The adapter `henri new` uses when `--adapter` is not given */
const DEFAULT_ADAPTER = 'drizzle';

/** The drizzle dialect `henri new --adapter drizzle` uses by default */
const DEFAULT_DIALECT = 'sqlite';

/**
 * The model API of every adapter core can load. `mariadb` is served by
 * `@usehenri/mysql` and has no scaffold of its own; `mssql` is the one
 * adapter left on Sequelize.
 */
const APIS = {
  disk: 'mongoose',
  drizzle: 'drizzle',
  mariadb: 'drizzle',
  mongoose: 'mongoose',
  mssql: 'sequelize',
  mysql: 'drizzle',
  postgresql: 'drizzle',
};

/** The henri package that provides each adapter */
const PACKAGES = {
  disk: '@usehenri/disk',
  drizzle: '@usehenri/drizzle',
  mariadb: '@usehenri/mysql',
  mongoose: '@usehenri/mongoose',
  mssql: '@usehenri/mssql',
  mysql: '@usehenri/mysql',
  postgresql: '@usehenri/postgresql',
};

/**
 * The drizzle dialect each adapter name fixes. These are the packages that
 * are `@usehenri/drizzle` with the choice already made, so a store that
 * names one needs no `dialect` key and installs no driver of its own.
 *
 * `mssql` is not in here: Drizzle has no SQL Server dialect (drizzle-orm
 * 0.45 ships pg, mysql, sqlite, singlestore and gel; drizzle-kit 0.31
 * generates for postgresql, mysql, sqlite, turso, singlestore and gel), so
 * `@usehenri/mssql` is on `@usehenri/sequelize` and stays there.
 */
const PRESET_DIALECTS = {
  mariadb: 'mysql',
  mysql: 'mysql',
  postgresql: 'postgres',
};

/**
 * The drizzle dialects: the driver the application installs (it is an
 * optional peer dependency of `@usehenri/drizzle`), the dependency build
 * scripts pnpm has to allow for it, and the url of a fresh application.
 */
const DIALECTS = {
  mysql: {
    builds: {},
    driver: { mysql2: '^3.24.3' },
    url: (name) => `mysql://root@127.0.0.1:3306/${name}`,
  },
  postgres: {
    builds: {},
    driver: { pg: '^8.23.0' },
    url: (name) => `postgres://postgres@127.0.0.1:5432/${name}`,
  },
  sqlite: {
    // `false`, not `true`: better-sqlite3 13 ships the compiled addon in
    // its tarball, for darwin, linux, linuxmusl and win32 on arm64 and
    // x64, and that is what loads. pnpm would otherwise run `node-gyp
    // rebuild` on it anyway (a package carrying a binding.gyp gets a
    // default install script), which needs a C++ toolchain the machine may
    // not have, doubles the install and produces nothing that gets used.
    // A platform with no prebuild flips this to `true` and builds.
    builds: { 'better-sqlite3': false },
    driver: { 'better-sqlite3': '^13.0.3' },
    // Sqlite keeps the test database in memory, like the disk adapter
    testUrl: () => ':memory:',
    url: () => 'file:.henri/app.db',
  },
};

/**
 * What `henri new --adapter <name>` writes. `store` builds the block of
 * `config/default.json` (`test` gives the one of `config/test.json`, which
 * is only written when it differs), `summary` says what it is -- the same
 * set `henri new --help` lists.
 */
const SCAFFOLDS = {
  disk: {
    store: () => ({ adapter: 'disk' }),
    summary: 'local MongoDB, nothing to install',
  },
  drizzle: {
    store: (name, dialect, test) => ({
      adapter: 'drizzle',
      dialect,
      url: url(DIALECTS[dialect], name, test),
    }),
    summary: 'Drizzle ORM with migrations: sqlite, postgres, mysql (default)',
  },
  mongoose: {
    store: (name, dialect, test) => ({
      adapter: 'mongoose',
      url: `mongodb://127.0.0.1:27017/${database(name, test)}`,
    }),
    summary: 'MongoDB server (mongoose)',
  },
  mssql: {
    store: (name, dialect, test) => ({
      adapter: 'mssql',
      url: `mssql://sa@127.0.0.1:1433/${database(name, test)}`,
    }),
    summary: 'Microsoft SQL Server (sequelize; drizzle has no mssql dialect)',
  },
  mysql: {
    store: (name, dialect, test) => ({
      adapter: 'mysql',
      url: DIALECTS.mysql.url(database(name, test)),
    }),
    summary: 'MySQL or MariaDB (drizzle, mysql2 included)',
  },
  postgresql: {
    store: (name, dialect, test) => ({
      adapter: 'postgresql',
      url: DIALECTS.postgres.url(database(name, test)),
    }),
    summary: 'PostgreSQL (drizzle, pg included)',
  },
};

/**
 * The database name of an application, `<name>_test` under NODE_ENV=test
 *
 * @param {string} name The application name
 * @param {boolean} [test] The test database
 * @returns {string} The database name
 */
const database = (name, test) => (test ? `${name}_test` : name);

/**
 * The url of a drizzle dialect for an application
 *
 * @param {object} dialect A DIALECTS entry
 * @param {string} name The application name
 * @param {boolean} [test] The test database
 * @returns {string} The url
 */
const url = (dialect, name, test) =>
  test && dialect.testUrl
    ? dialect.testUrl()
    : dialect.url(database(name, test));

/** The adapters `henri new --adapter` accepts, sorted */
const list = () => Object.keys(SCAFFOLDS).sort();

/** The drizzle dialects `henri new --dialect` accepts, sorted */
const dialects = () => Object.keys(DIALECTS).sort();

/**
 * The drizzle dialect of a store: the one its adapter fixes
 * (`@usehenri/postgresql` is postgres), else the configured one, else the
 * one its url points at, `sqlite` otherwise
 *
 * @param {object} [store={}] A store block of config/default.json
 * @returns {string} sqlite, postgres or mysql
 */
const dialectOf = (store = {}) => {
  const preset = PRESET_DIALECTS[String((store && store.adapter) || '')];

  if (preset) {
    return preset;
  }

  const wanted = String((store && store.dialect) || '').toLowerCase();
  const aliases = {
    'better-sqlite3': 'sqlite',
    mariadb: 'mysql',
    mysql2: 'mysql',
    pg: 'postgres',
    postgresql: 'postgres',
    sqlite3: 'sqlite',
  };
  const named = aliases[wanted] || wanted;

  if (DIALECTS[named]) {
    return named;
  }

  const target = String((store && store.url) || '').toLowerCase();

  if (/^(postgres|postgresql|pg):/.test(target)) {
    return 'postgres';
  }

  if (/^(mysql|mysql2|mariadb):/.test(target)) {
    return 'mysql';
  }

  return DEFAULT_DIALECT;
};

/**
 * The packages a configured store needs in the application package.json
 *
 * @param {object} [store] A store block of config/default.json
 * @returns {Array<string>} Package names (empty for an unknown adapter)
 */
const packagesFor = (store) => {
  const adapter = store && store.adapter;

  if (!PACKAGES[adapter]) {
    return [];
  }

  const needed = [PACKAGES[adapter]];

  // A preset adapter brings its driver; `@usehenri/drizzle` leaves it to
  // the application, which is why the driver is an optional peer there
  if (adapter === 'drizzle') {
    needed.push(...Object.keys(DIALECTS[dialectOf(store)].driver));
  }

  return needed;
};

/**
 * The model API of the default store of an application, so a generator
 * writes controllers the store can run
 *
 * @param {string} [dir=process.cwd()] The application directory
 * @returns {string} drizzle (the default), mongoose or sequelize
 */
const apiOf = (dir = process.cwd()) => APIS[adapterOf(dir)] || 'mongoose';

/**
 * The adapter of the default store of an application
 *
 * @param {string} [dir=process.cwd()] The application directory
 * @returns {string} An adapter name, the default when there is nothing to read
 */
const adapterOf = (dir = process.cwd()) => {
  let config = {};

  try {
    config = readConfig(dir, undefined);
  } catch {
    // An unreadable configuration: the default adapter will do
  }

  const stores = (config && config.stores) || {};
  const store = stores.default || Object.values(stores)[0] || {};

  return String(store.adapter || DEFAULT_ADAPTER).toLowerCase();
};

/**
 * Pick the adapter and its dialect from the CLI arguments
 *
 * @param {object} [args={}] CLI arguments (--adapter, --dialect)
 * @returns {{adapter: string, dialect: string}} The selection
 * @throws {CliError} USAGE on an unknown adapter or dialect
 */
const select = (args = {}) => {
  const adapter = String(args.adapter || DEFAULT_ADAPTER).toLowerCase();
  const wanted = args.dialect ? String(args.dialect).toLowerCase() : null;

  if (!SCAFFOLDS[adapter]) {
    throw new CliError('USAGE', `Unknown adapter '${adapter}'`, {
      hint: `Valid values: ${list().join(', ')}`,
    });
  }

  if (wanted && adapter !== 'drizzle') {
    throw new CliError(
      'USAGE',
      `--dialect only applies to --adapter drizzle (got '${adapter}')`,
      { hint: `henri new <folder> --adapter drizzle --dialect ${wanted}` }
    );
  }

  if (wanted && !DIALECTS[wanted]) {
    throw new CliError('USAGE', `Unknown dialect '${wanted}'`, {
      hint: `Valid values: ${dialects().join(', ')}`,
    });
  }

  return { adapter, dialect: wanted || DEFAULT_DIALECT };
};

/**
 * Everything `henri init` needs to scaffold an application on an adapter
 *
 * @param {object} options Options
 * @param {string} options.adapter The adapter name
 * @param {string} [options.dialect] The drizzle dialect
 * @param {string} options.name The application name (the database name)
 * @returns {object} `{ adapter, api, builds, dialect, drivers, package,
 *   store, test }`
 */
const describe = ({ adapter, dialect = DEFAULT_DIALECT, name }) => {
  const scaffold = SCAFFOLDS[adapter];
  const preset = PRESET_DIALECTS[adapter];
  const flavour = preset || (adapter === 'drizzle' ? dialect : null);
  const store = scaffold.store(name, dialect, false);
  const test = scaffold.store(name, dialect, true);

  return {
    adapter,
    api: APIS[adapter],
    builds: flavour ? DIALECTS[flavour].builds : {},
    dialect: flavour,
    // A preset adapter carries its own driver, so the application declares
    // one only when it depends on @usehenri/drizzle directly
    drivers: preset || !flavour ? {} : DIALECTS[flavour].driver,
    package: PACKAGES[adapter],
    store,
    // Only useful when config/test.json says something new
    test: JSON.stringify(test) === JSON.stringify(store) ? null : test,
  };
};

module.exports = {
  APIS,
  DEFAULT_ADAPTER,
  DEFAULT_DIALECT,
  DIALECTS,
  PACKAGES,
  PRESET_DIALECTS,
  SCAFFOLDS,
  adapterOf,
  apiOf,
  describe,
  dialectOf,
  dialects,
  list,
  packagesFor,
  select,
};
