const { CliError } = require('./errors');
const { usage } = require('./help');
const { validInstall } = require('./utils');

const COMMANDS = ['generate', 'migrate', 'push', 'status'];

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
 * Boots henri with the models only (runlevel 3, no views, no workers, no
 * schema sync) and returns the store
 *
 * @param {string} name The store name
 * @returns {Promise<{ henri: object, store: object }>} The instance and the store
 * @throws {CliError} USAGE when the store is unknown, FAILED when it has no migrations
 */
const boot = async (name) => {
  process.env.SKIP_WORKERS = 'true';
  process.env.CONSOLE_ONLY = 'true';
  process.env.HENRI_SKIP_SYNC = 'true';

  const Henri = require(resolveHenri());
  const henri = new Henri({ runlevel: 3 });

  await henri.init();

  const store = henri.model.stores[name];

  if (!store) {
    await henri.stop();
    throw new CliError('USAGE', `Unknown store "${name}"`, {
      hint: `The configured stores are: ${Object.keys(henri.model.stores).join(', ')}`,
    });
  }

  if (!store.migrations) {
    await henri.stop();
    throw new CliError(
      'FAILED',
      `Store "${name}" (${store.adapterName}) has no migrations`,
      {
        hint: 'henri db works with the drizzle adapter: set "adapter": "drizzle" on the store and install @usehenri/drizzle',
      }
    );
  }

  return { henri, store };
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

  if (result.command === 'status') {
    console.log(
      `  Store ${result.store} (${result.dialect}), ${result.folder}`
    );
    console.log('');
    list('Applied', result.applied);
    list('Pending', result.pending);
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
 * Runs `henri db <status|generate|migrate|push>` (`henri db:<command>` too)
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
    const { henri, store } = await boot(name);

    result = await run(command, store, args).finally(() => henri.stop());
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    print(result);
  }

  if (!result.ok) {
    throw new CliError('FAILED', 'Push refused: statements would lose data', {
      hint: 'Run again with --force to apply them, or write a migration with henri db:generate',
    });
  }

  // The drivers are closed by henri.stop(); leave nothing behind
  process.exit(0);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.run = run;
