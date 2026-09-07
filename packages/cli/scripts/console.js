const repl = require('repl');
const chalk = require('chalk');
const path = require('path');

const { CliError } = require('./errors');
const boot = require('./server');

/**
 * `henri console`: a REPL with the application booted around it, and
 * `--sandbox`, which rolls back everything the session wrote.
 *
 * ## What a sandbox has to be, and where it can be
 *
 * A sandbox is one transaction held open for the life of the console and
 * rolled back when it ends. That only works if a model call **joins the
 * transaction on its own**: a person typing `Task.destroy(...)` at a prompt
 * is not going to thread a transaction handle through it, and a flag that
 * silently kept the writes would be worse than no flag at all -- it is the
 * one thing somebody trusts before doing something destructive to
 * production data.
 *
 * So it is offered exactly where henri can honour it, and refused loudly
 * everywhere else. The adapters were checked one at a time:
 *
 * - **drizzle** (and `postgresql` and `mysql`, which are that adapter with
 *   a dialect chosen): supported. `Drizzle#database()` reads the
 *   transaction out of an `AsyncLocalStorage`, so every model call made
 *   inside the console's evaluation joins it with nothing threaded through.
 *   `Drizzle#sandbox()` is the seam.
 * - **mongoose** and **disk**: refused. A Mongoose write joins a
 *   transaction only when the call is passed the `session`, and there is no
 *   async-context path to hand it one; on top of that a MongoDB
 *   transaction needs a replica set, which `mongodb-memory-server` is not
 *   started as. Two reasons, either of them enough.
 * - **mssql** (`@usehenri/sequelize`): refused. Sequelize joins a
 *   transaction by async context only under `Sequelize.useCLS()`, which
 *   henri does not install -- turning it on for a console would change how
 *   every other transaction in the process behaves.
 *
 * A refusal happens **before the prompt is printed**, names the store and
 * its adapter, and exits non-zero.
 *
 * ## How the transaction reaches an evaluation
 *
 * Two ways, and both are used because the second is the guarantee:
 * `repl.start()` is called inside the transaction's context, so everything
 * the REPL creates inherits it, and the evaluation function is wrapped as
 * well, so each command runs inside it whatever the readline plumbing did.
 * The completer, which evaluates fragments of what is being typed, is
 * covered by the first.
 */

/** How a sandboxed prompt says what it is */
const SANDBOX_MARK = ' (sandbox)';

/**
 * The name of the application, for the prompt
 *
 * @param {string} [dir=process.cwd()] The application directory
 * @returns {string} The package name, `henri` when there is none
 */
const nameOf = (dir = process.cwd()) => {
  try {
    return require(path.resolve(dir, 'package.json')).name || 'henri';
  } catch {
    return 'henri';
  }
};

/**
 * The stores of a booted application, by name
 *
 * @param {object} henri The booted instance
 * @returns {object} `{ [name]: adapter }`
 */
const storesOf = (henri) => (henri && henri.model && henri.model.stores) || {};

/**
 * Opens a sandbox on every store, or refuses.
 *
 * Every store, not only the default: a console that rolled back one
 * database and committed the other would be the dishonest half of the
 * feature rather than half the feature.
 *
 * @param {object} henri The booted instance
 * @returns {Promise<Array<object>>} `{ name, adapter, handle }` per store
 * @throws {CliError} FAILED when a store cannot hold one
 */
const open = async (henri) => {
  const stores = storesOf(henri);
  const names = Object.keys(stores);

  if (names.length === 0) {
    throw new CliError(
      'HENRI_STORE_SANDBOX_UNSUPPORTED',
      'henri console --sandbox needs a store, and this application has none',
      {
        hint: 'Add one to config.stores, or run henri console without --sandbox',
      }
    );
  }

  const refused = names.filter(
    (name) => typeof stores[name].sandbox !== 'function'
  );

  if (refused.length > 0) {
    const listed = refused
      .map((name) => `${name} (${stores[name].adapterName || 'unknown'})`)
      .join(', ');

    throw new CliError(
      'HENRI_STORE_SANDBOX_UNSUPPORTED',
      `henri console --sandbox cannot be honoured on ${listed}`,
      {
        hint: 'A sandbox needs a model call to join the transaction of its async context, which only a drizzle store does. Run henri console without --sandbox rather than trust a rollback that would not happen.',
      }
    );
  }

  const opened = [];

  for (const name of names) {
    try {
      opened.push({
        adapter: stores[name],
        handle: await stores[name].sandbox(),
        name,
      });
    } catch (error) {
      // Whatever opened before this one is rolled back: leaving a
      // transaction open on the way out of a failure is how a console holds
      // a lock nobody can see
      await rollback(opened).catch(() => null);

      throw new CliError(
        'HENRI_STORE_SANDBOX_UNSUPPORTED',
        `henri console --sandbox could not open a transaction on ${name}: ${error.message}`,
        { cause: error }
      );
    }
  }

  return opened;
};

/**
 * Runs a function inside every open sandbox
 *
 * @param {Array<object>} sandboxes What open() answered
 * @param {function} fn What to run
 * @returns {*} What fn returned
 */
const inside = (sandboxes, fn) =>
  sandboxes.reduceRight(
    (next, sandbox) => () => sandbox.handle.run(next),
    fn
  )();

/**
 * Rolls every sandbox back
 *
 * @param {Array<object>} sandboxes What open() answered
 * @returns {Promise<Array<string>>} The stores that could not be rolled back
 */
const rollback = async (sandboxes) => {
  const failed = [];

  for (const sandbox of sandboxes.splice(0)) {
    try {
      await sandbox.handle.rollback();
    } catch (error) {
      failed.push(`${sandbox.name}: ${error.message}`);
    }
  }

  return failed;
};

/**
 * Starts the REPL, inside the sandboxes when there are any
 *
 * @param {string} prompt The prompt
 * @param {Array<object>} sandboxes What open() answered ([] without --sandbox)
 * @returns {object} The REPLServer
 */
const start = (prompt, sandboxes) => {
  const instance = inside(sandboxes, () =>
    repl.start({ prompt, useGlobal: true })
  );

  if (sandboxes.length === 0) {
    return instance;
  }

  // The guarantee: whatever the readline plumbing did with the async
  // context, each command is evaluated inside the transaction
  const evaluate = instance.eval.bind(instance);

  instance.eval = (cmd, context, filename, callback) =>
    inside(sandboxes, () => evaluate(cmd, context, filename, callback));

  return instance;
};

/**
 * Boots the application and opens a REPL
 *
 * @param {object} [args={}] CLI arguments
 * @returns {Promise<void>} Resolves when the console is open
 * @throws {CliError} When --sandbox cannot be honoured
 */
const main = async (args = {}) => {
  const wanted = args.sandbox === true;
  const name = nameOf();

  await boot({ consoleOnly: true }, async (henri) => {
    const sandboxes = wanted ? await open(henri) : [];
    const prompt = `${chalk.blue.bold(name)}${
      wanted ? chalk.yellow.bold(SANDBOX_MARK) : ''
    }${chalk.white.bold('> ')}`;

    if (wanted) {
      const where = sandboxes
        .map((sandbox) => `${sandbox.name} (${sandbox.adapter.adapterName})`)
        .join(', ');

      console.log('');
      console.log(
        chalk.yellow(
          `  sandbox: ${where} is in a transaction that is rolled back when you leave.`
        )
      );
      console.log(
        chalk.yellow(
          '  Nothing you write here survives, and nothing outside this session sees it.'
        )
      );
      console.log('');
    }

    const instance = start(prompt, sandboxes);

    if (!wanted) {
      return;
    }

    // Only in sandbox mode: the console has something to undo, so leaving
    // it is an event rather than the process running out of work
    instance.on('exit', () => {
      rollback(sandboxes)
        .then((failed) => {
          for (const line of failed) {
            console.error(`  sandbox: unable to roll back ${line}`);
          }
          console.log(
            failed.length === 0
              ? chalk.yellow('  sandbox: rolled back.')
              : chalk.red('  sandbox: NOT fully rolled back, see above.')
          );

          return henri.stop().then(() => process.exit(failed.length ? 1 : 0));
        })
        .catch((error) => {
          console.error(error.stack || error);
          process.exit(1);
        });
    });
  });
};

module.exports = main;
module.exports.SANDBOX_MARK = SANDBOX_MARK;
module.exports.inside = inside;
module.exports.nameOf = nameOf;
module.exports.open = open;
module.exports.rollback = rollback;
module.exports.start = start;
module.exports.storesOf = storesOf;
