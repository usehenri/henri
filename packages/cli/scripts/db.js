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
 * @throws when the store is unknown or has no migrations
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
    throw new Error(
      `Unknown store "${name}"; the stores are ${Object.keys(henri.model.stores).join(', ')}`
    );
  }

  if (!store.migrations) {
    await henri.stop();
    throw new Error(
      `Store "${name}" (${store.adapterName}) has no migrations; henri db works with the drizzle adapter`
    );
  }

  return { henri, store };
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
 * Runs one db command on a store
 *
 * @param {string} command status, generate, migrate or push
 * @param {object} store The store adapter
 * @param {object} args CLI arguments
 * @returns {Promise<boolean>} false when the command refused to act
 */
const run = async (command, store, args) => {
  const { migrations } = store;

  console.log('');

  if (command === 'status') {
    const status = await migrations.status();

    console.log(
      `  Store ${store.name} (${store.dialect.name}), ${status.folder}`
    );
    console.log('');
    list('Applied', status.applied);
    list('Pending', status.pending);

    return true;
  }

  if (command === 'generate') {
    const name = typeof args.name === 'string' ? args.name : undefined;
    const result = await migrations.generate({ name });

    if (!result.file) {
      console.log('  No schema changes since the last migration');

      return true;
    }

    console.log(
      `  Wrote ${result.file} (${result.statements.length} statement(s))`
    );

    if (result.recorded.length > 0) {
      console.log('  The database already matches: recorded as applied');
    }

    return true;
  }

  if (command === 'migrate') {
    const result = await migrations.migrate();

    if (result.applied.length === 0) {
      console.log('  Migrations up to date');
    } else {
      list('Applied', result.applied);
    }

    return true;
  }

  const result = await migrations.push({
    force: args.force === true,
    interactive: true,
  });

  result.warnings.forEach((warning) => console.log(`  ! ${warning}`));

  if (!result.applied) {
    console.log('');
    console.log(
      '  These statements would lose data; run again with --force to apply them:'
    );
    result.statements.forEach((statement) =>
      console.log(`    ${statement.replace(/\n/g, '\n    ')}`)
    );

    return false;
  }

  console.log(
    result.statements.length === 0
      ? '  Database up to date'
      : `  Applied ${result.statements.length} statement(s)`
  );

  return true;
};

/**
 * Runs `henri db <status|generate|migrate|push>`
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 */
const main = async (args) => {
  const [command] = args._;

  if (!command || !COMMANDS.includes(command)) {
    console.log(usage('db'));

    if (command) {
      throw new Error(`Unknown db command "${command}"`);
    }

    return;
  }

  validInstall({ fatal: true });

  const name = typeof args.store === 'string' ? args.store : 'default';
  const { henri, store } = await boot(name);
  const ok = await run(command, store, args).finally(() => henri.stop());

  console.log('');
  process.exit(ok ? 0 : 1);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
