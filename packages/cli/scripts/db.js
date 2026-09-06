const path = require('path');
const fs = require('fs');

const { CliError } = require('./errors');
const database = require('./db-database');
const { usage } = require('./help');
const { validInstall } = require('./utils');

const COMMANDS = [
  'create',
  'drop',
  'generate',
  'migrate',
  'push',
  'reset',
  'seed',
  'status',
];

// Rails' db/seeds.rb
const SEEDS = path.join('db', 'seeds.js');

/**
 * Prefer the @usehenri/core the project depends on and fall back to the
 * one shipped with this CLI
 *
 * @returns {string} resolved path of the Henri class
 */
const resolveHenri = () => {
  try {
    return require.resolve('@usehenri/core/src/henri', {
      paths: [process.cwd()],
    });
  } catch {
    return require.resolve('@usehenri/core/src/henri');
  }
};

/**
 * Boots henri without the views, the router or the workers
 *
 * The migration commands stop at the models (runlevel 3) and skip the schema
 * sync of the boot, since they are the ones driving it. `henri db:seed` keeps
 * the sync, so the tables a seed writes to exist exactly like a `henri
 * server` boot would, and goes one level further (runlevel 4, the user
 * module): creating a user hashes its password with `henri.user.encrypt()`,
 * so seeds could not write one without it.
 *
 * @param {object} [options={}] Options
 * @param {boolean} [options.sync=false] Let the adapter sync the schema
 * @param {number} [options.runlevel=3] The level to boot to
 * @returns {Promise<object>} The henri instance
 */
const boot = async ({ sync = false, runlevel = 3 } = {}) => {
  process.env.SKIP_WORKERS = 'true';
  process.env.CONSOLE_ONLY = 'true';

  if (sync) {
    delete process.env.HENRI_SKIP_SYNC;
  } else {
    process.env.HENRI_SKIP_SYNC = 'true';
  }

  const Henri = require(resolveHenri());
  const henri = new Henri({ runlevel });

  await henri.init();

  return henri;
};

/**
 * The configuration of one store, read without connecting to it.
 *
 * `db:create` runs before there is a database to connect to, so this stops
 * at the configuration (runlevel 0), which is where `.env`, `DATABASE_URL`
 * and the encrypted credentials have already been applied.
 *
 * @param {string} name The store name
 * @returns {Promise<object>} The store configuration
 * @throws {CliError} USAGE when the application has no such store
 */
const storeConfig = async (name) => {
  const henri = await boot({ runlevel: 0 });

  try {
    const stores = henri.config.get('stores') || {};
    const config = stores[name];

    if (!config) {
      throw new CliError('USAGE', `Unknown store "${name}"`, {
        hint: `The application defines: ${Object.keys(stores).join(', ') || 'none'}`,
      });
    }

    return config;
  } finally {
    await henri.stop();
  }
};

/**
 * Refuses a destructive command against production unless it was asked for
 * twice: once by running it, once with --force
 *
 * @param {string} command The command name
 * @param {object} args CLI arguments
 * @param {string} what What is about to be removed
 * @returns {void}
 * @throws {CliError} FAILED in production without --force
 */
const guard = (command, args, what) => {
  if (process.env.NODE_ENV !== 'production' || args.force === true) {
    return;
  }

  throw new CliError(
    'FAILED',
    `henri db:${command} would remove ${what}, and NODE_ENV is production`,
    { hint: 'Run it again with --force if that is really what you want' }
  );
};

/**
 * Whether the application drives its schema with migrations
 *
 * @returns {boolean} true when db/migrations holds at least one migration
 */
const hasMigrations = () => {
  const folder = path.join(process.cwd(), 'db', 'migrations');

  return (
    fs.existsSync(folder) &&
    fs.readdirSync(folder).some((entry) => entry.endsWith('.sql'))
  );
};

/**
 * Creates the database a store points at, when it is not there yet
 *
 * @param {object} args CLI arguments
 * @param {string} name The store name
 * @returns {Promise<object>} The result
 */
const create = async (args, name) => {
  const config = await storeConfig(name);
  const dialect = database.dialectOf(config, name);
  const target =
    dialect === 'sqlite'
      ? database.sqliteFile(config) || ':memory:'
      : database.databaseOf(config, name);
  const existed = await database.DIALECTS[dialect].exists(config, target);
  const outcome = existed
    ? { created: false }
    : await database.DIALECTS[dialect].create(config, target);

  return {
    command: 'create',
    created: Boolean(outcome.created),
    database: target,
    dialect,
    ok: true,
    reason: outcome.reason || (existed ? 'exists' : null),
    store: name,
    where: database.describe(config, dialect),
  };
};

/**
 * Drops the database a store points at
 *
 * @param {object} args CLI arguments
 * @param {string} name The store name
 * @returns {Promise<object>} The result
 */
const drop = async (args, name) => {
  const config = await storeConfig(name);
  const dialect = database.dialectOf(config, name);
  const target =
    dialect === 'sqlite'
      ? database.sqliteFile(config) || ':memory:'
      : database.databaseOf(config, name);

  guard('drop', args, target);

  const outcome = await database.DIALECTS[dialect].drop(config, target);

  return {
    command: 'drop',
    database: target,
    dialect,
    dropped: Boolean(outcome.dropped),
    ok: true,
    reason: outcome.reason || null,
    store: name,
    where: database.describe(config, dialect),
  };
};

/**
 * Drops the database, creates it again, brings the schema up and seeds it.
 *
 * The schema comes from the migrations when the application has any, and
 * from the adapter's own sync when it does not, which is the same choice
 * `henri server` makes on a fresh database. The seeds run when `db/seeds.js`
 * exists, because a reset with an empty database is rarely what was wanted.
 *
 * @param {object} args CLI arguments
 * @param {string} name The store name
 * @returns {Promise<object>} The result
 */
const reset = async (args, name) => {
  const dropped = await drop(args, name);
  const created = await create(args, name);
  const migrated = hasMigrations();
  const seeded = fs.existsSync(path.join(process.cwd(), SEEDS));

  const henri = await boot({ sync: !migrated });

  try {
    if (migrated) {
      const store = await migrations(henri, name);

      await run('migrate', store, args);
    }
  } finally {
    await henri.stop();
  }

  if (seeded) {
    await seed(args);
  }

  return {
    command: 'reset',
    database: created.database,
    dialect: created.dialect,
    dropped: dropped.dropped,
    migrated,
    ok: true,
    seeded,
    store: name,
    where: created.where,
  };
};

/**
 * A store by name
 *
 * @param {object} henri A booted instance
 * @param {string} name The store name
 * @returns {Promise<object>} The store adapter
 * @throws {CliError} USAGE when the application has no such store
 */
const storeOf = async (henri, name) => {
  const store = henri.model.stores[name];

  if (!store) {
    await henri.stop();
    throw new CliError('USAGE', `Unknown store "${name}"`, {
      hint: `The configured stores are: ${Object.keys(henri.model.stores).join(', ')}`,
    });
  }

  return store;
};

/**
 * The store of a migration command
 *
 * Only the drizzle adapter has migrations. A Sequelize store answers
 * `henri db:status`, which reads the database back and reports what it and
 * the models disagree about, and nothing else: henri does not keep a
 * migration history it cannot apply.
 *
 * @param {object} henri A booted instance
 * @param {string} name The store name
 * @returns {Promise<object>} The store adapter
 * @throws {CliError} USAGE when the store is unknown, MIGRATIONS_UNSUPPORTED
 *   when the adapter has none
 */
const migrations = async (henri, name) => {
  const store = await storeOf(henri, name);

  if (!store.migrations) {
    const drifts = typeof store.drift === 'function';

    await henri.stop();
    throw new CliError(
      'MIGRATIONS_UNSUPPORTED',
      `Store "${name}" (${store.adapterName}) has no migrations`,
      {
        hint: drifts
          ? 'The Sequelize adapters create the tables that are missing and never alter one. "henri db:status" says what the database and the models disagree about and "henri db:status --sql" writes the DDL to review; migrations need the drizzle adapter (see https://usehenri.io/upgrading/)'
          : 'henri db works with the drizzle adapter: set "adapter": "drizzle" on the store and install @usehenri/drizzle',
      }
    );
  }

  return store;
};

/**
 * Requires db/seeds.js and awaits what it exports (a function receives the
 * henri instance; a promise is awaited as is)
 *
 * @param {object} henri A booted instance
 * @param {string} file The absolute path of the seed file
 * @returns {Promise<void>} Resolves when the seeds ran
 * @throws {CliError} FAILED when the seed file throws
 */
const sow = async (henri, file) => {
  let seeds;

  try {
    seeds = require(file);
  } catch (error) {
    throw new CliError('FAILED', `${path.basename(file)}: ${error.message}`, {
      cause: error,
      hint: 'The seed file is required with the models loaded: check its syntax and its requires',
    });
  }

  try {
    await (typeof seeds === 'function' ? seeds(henri) : seeds);
  } catch (error) {
    throw new CliError('FAILED', `Seeding failed: ${error.message}`, {
      cause: error,
      hint: 'Seeds run again on every machine: make them idempotent (find, then create)',
    });
  }
};

/**
 * Runs `henri db:seed`: boots the models and awaits the seed file
 *
 * @param {object} args CLI arguments (`file` overrides db/seeds.js)
 * @returns {Promise<object>} The result of the command
 * @throws {CliError} USAGE when the seed file is missing
 */
const seed = async (args) => {
  const relative = typeof args.file === 'string' ? args.file : SEEDS;
  const file = path.resolve(process.cwd(), relative);

  // Checked before the boot: no point starting a database to find this out
  if (!fs.existsSync(file)) {
    throw new CliError('USAGE', `No seed file at ${relative}`, {
      hint: `Create ${SEEDS} (henri new writes one) or pass --file=<path>`,
    });
  }

  const started = Date.now();
  const henri = await boot({ runlevel: 4, sync: true });

  try {
    await sow(henri, file);
  } finally {
    await henri.stop();
  }

  return {
    command: 'seed',
    duration: Date.now() - started,
    file: relative,
    ok: true,
  };
};

/**
 * Runs one db command on a store and describes what happened
 *
 * @param {string} command status, generate, migrate or push
 * @param {object} store The store adapter
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result, `{ ok: false }` when push refused to act
 */
const run = async (command, store, args) => {
  const { migrations } = store;
  const base = {
    command,
    dialect: store.dialect.name,
    ok: true,
    store: store.name,
  };

  if (command === 'status') {
    const status = await migrations.status();

    return {
      ...base,
      applied: status.applied,
      folder: status.folder,
      pending: status.pending,
      schema: 'migrations',
    };
  }

  if (command === 'generate') {
    const name = typeof args.name === 'string' ? args.name : undefined;
    const result = await migrations.generate({ name });

    return {
      ...base,
      file: result.file || null,
      recorded: result.recorded || [],
      statements: result.statements || [],
    };
  }

  if (command === 'migrate') {
    const result = await migrations.migrate();

    return { ...base, applied: result.applied };
  }

  const result = await migrations.push({
    force: args.force === true,
    interactive: args.json !== true,
  });

  return {
    ...base,
    applied: result.applied,
    ok: result.applied,
    statements: result.statements,
    warnings: result.warnings,
  };
};

/**
 * Runs `henri db:status`, whichever adapter the store uses
 *
 * A store with migrations (drizzle) answers what is applied and what is
 * pending. A store without them (the Sequelize adapters) answers what the
 * database and the models disagree about, which is the same question asked
 * of an adapter that keeps no history: `schema` says which of the two came
 * back.
 *
 * @param {object} store The store adapter
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 * @throws {CliError} MIGRATIONS_UNSUPPORTED when the adapter answers neither
 */
const status = async (store, args) => {
  if (store.migrations) {
    return run('status', store, args);
  }

  if (typeof store.drift !== 'function') {
    throw new CliError(
      'MIGRATIONS_UNSUPPORTED',
      `Store "${store.name}" (${store.adapterName}) has no schema of its own`,
      {
        hint: 'henri db:status reads a SQL store back: MongoDB has no schema to compare the models with',
      }
    );
  }

  const report = await store.drift();

  return {
    clean: report.clean,
    command: 'status',
    dialect: report.dialect,
    differences: report.differences,
    ok: true,
    schema: 'models',
    sql: args.sql === true,
    statements: report.statements,
    store: store.name,
    unsupported: report.unsupported,
  };
};

/**
 * Prints a list of migrations
 *
 * @param {string} label The heading
 * @param {Array<string>} tags The migration tags
 * @returns {void}
 */
const list = (label, tags) => {
  console.log(`  ${label}: ${tags.length === 0 ? 'none' : ''}`);
  tags.forEach((tag) => console.log(`    ${tag}`));
};

/**
 * Prints a result for humans
 *
 * @param {object} result What run() returned
 * @returns {void}
 */
const print = (result) => {
  console.log('');

  if (result.command === 'seed') {
    console.log(`  Seeded from ${result.file} (${result.duration}ms)`);
  }

  if (result.command === 'create') {
    if (result.created) {
      console.log(`  Created ${result.where}`);
    } else if (result.reason === 'first-write') {
      console.log(
        `  ${result.dialect} makes a database on its first write: nothing to create`
      );
    } else if (result.reason === 'memory') {
      console.log('  The store is in memory: nothing to create');
    } else {
      console.log(`  ${result.where} is already there`);
    }
  }

  if (result.command === 'drop') {
    if (result.dropped) {
      console.log(`  Dropped ${result.where}`);
    } else if (result.reason === 'unsupported') {
      console.log(
        `  henri does not drop a ${result.dialect} database: use its own tools`
      );
    } else {
      console.log('  The store is in memory: nothing to drop');
    }
  }

  if (result.command === 'reset') {
    console.log(`  Reset ${result.where}`);
    console.log(
      `  Schema from ${result.migrated ? 'db/migrations' : 'the models'}${result.seeded ? `, seeded from ${SEEDS}` : ''}`
    );
  }

  if (result.command === 'status' && result.schema === 'migrations') {
    console.log(
      `  Store ${result.store} (${result.dialect}), ${result.folder}`
    );
    console.log('');
    list('Applied', result.applied);
    list('Pending', result.pending);
  }

  if (result.command === 'status' && result.schema === 'models') {
    console.log(
      `  Store ${result.store} (${result.dialect}), compared with the models`
    );
    console.log('');

    if (result.clean) {
      console.log('  The database matches the models');
    } else {
      console.log(`  ${result.differences.length} difference(s):`);
      result.differences.forEach((difference) =>
        console.log(`    ${difference.description}`)
      );
    }

    result.unsupported.forEach((line) => console.log(`  ! ${line}`));

    if (!result.clean && !result.sql) {
      console.log('');
      console.log(
        '  henri does not change a Sequelize schema for you: run it again'
      );
      console.log('  with --sql for the DDL that would close the difference.');
    }

    if (result.sql && result.statements.length > 0) {
      console.log('');
      console.log('  Review every statement before you run it:');
      console.log('');
      result.statements.forEach((statement) =>
        console.log(`    ${statement.replace(/;(?=.)/g, ';\n    ')}`)
      );
    }
  }

  if (result.command === 'generate') {
    if (!result.file) {
      console.log('  No schema changes since the last migration');
    } else {
      console.log(
        `  Wrote ${result.file} (${result.statements.length} statement(s))`
      );
    }

    if (result.recorded.length > 0) {
      console.log('  The database already matches: recorded as applied');
    }
  }

  if (result.command === 'migrate') {
    if (result.applied.length === 0) {
      console.log('  Migrations up to date');
    } else {
      list('Applied', result.applied);
    }
  }

  if (result.command === 'push') {
    result.warnings.forEach((warning) => console.log(`  ! ${warning}`));

    if (!result.applied) {
      console.log('');
      console.log('  These statements would lose data:');
      result.statements.forEach((statement) =>
        console.log(`    ${statement.replace(/\n/g, '\n    ')}`)
      );
    } else {
      console.log(
        result.statements.length === 0
          ? '  Database up to date'
          : `  Applied ${result.statements.length} statement(s)`
      );
    }
  }

  console.log('');
};

/**
 * Runs `henri db <status|generate|migrate|push|seed>` (`henri db:<command>`
 * too)
 *
 * With --json the result is printed as one JSON object on stdout.
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE without a command, FAILED when push refused to act
 */
const main = async (args) => {
  const [command] = args._;

  if (!command || !COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('db'));
    }

    throw new CliError(
      'USAGE',
      command ? `Unknown db command "${command}"` : 'Missing db command',
      { hint: `Available commands: ${COMMANDS.join(', ')}` }
    );
  }

  validInstall({ fatal: true });

  const name = typeof args.store === 'string' ? args.store : 'default';
  const log = console.log;

  // With --json stdout is the result only: the boot log goes to stderr
  if (args.json) {
    console.log = (...parts) => console.error(...parts);
  }

  let result;

  try {
    if (command === 'seed') {
      result = await seed(args);
    } else if (command === 'create') {
      result = await create(args, name);
    } else if (command === 'drop') {
      result = await drop(args, name);
    } else if (command === 'reset') {
      result = await reset(args, name);
    } else if (command === 'status') {
      const henri = await boot();
      const store = await storeOf(henri, name);

      result = await status(store, args).finally(() => henri.stop());
    } else {
      const henri = await boot();
      const store = await migrations(henri, name);

      result = await run(command, store, args).finally(() => henri.stop());
    }
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    print(result);
  }

  if (result.command === 'push' && !result.ok) {
    throw new CliError('FAILED', 'Push refused: statements would lose data', {
      hint: 'Run again with --force to apply them, or write a migration with henri db:generate',
    });
  }

  // The drivers are closed by henri.stop(); leave nothing behind
  process.exit(0);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.create = create;
module.exports.drop = drop;
module.exports.migrations = migrations;
module.exports.reset = reset;
module.exports.run = run;
module.exports.seed = seed;
module.exports.sow = sow;
module.exports.status = status;
module.exports.storeOf = storeOf;
