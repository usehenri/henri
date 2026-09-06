// @ts-check
/* eslint-disable no-console */

const chalk = require('chalk');
const debug = require('debug')('henri:cli');

const { commands, version } = require('./package.json');
const { toCliError } = require('./scripts/errors');

if (require.main === module) {
  const { detectPackageManager } = require('./scripts/utils');
  const pm = detectPackageManager();
  const install = pm === 'npm' ? 'npm install -g' : `${pm} add -g`;

  console.log(
    `
    This module should not be run directly.

    Please, use ${chalk.cyan('henri')} or install it via:

    # ${install} henri

    `
  );
  process.exit(1);
}

/**
 * Flags that never take a value (so `henri new --force app` keeps `app`
 * as the folder name). Not `git`: minimist handles `--no-git` on its own
 * and a declared boolean would default to false.
 */
const BOOLEAN_FLAGS = [
  'all',
  'checks',
  'dry-run',
  'force',
  'force-build',
  'help',
  'json',
  'now',
  'once',
  'production',
  'skip-install',
  'skip-workers',
  'sql',
  'version',
  'wait',
  'yes',
];

/**
 * Run a henri command
 *
 * @param {object} pkg The package.json of the `henri` package
 * @param {string[]} args process.argv
 * @returns {void}
 */
module.exports = (pkg, args) => {
  const argv = require('minimist')(args.slice(2), {
    // eslint-disable-next-line id-length
    alias: { f: 'force', h: 'help', v: 'version', y: 'yes' },
    boolean: BOOLEAN_FLAGS,
  });
  const help = require('./scripts/help');
  const json = argv.json === true;

  setGlobalEnv(argv);

  let command = argv._.shift();

  // Rails style: `henri db:migrate` is `henri db migrate`
  for (const group of ['credentials', 'db', 'privacy']) {
    if (command && command.startsWith(`${group}:`)) {
      argv._.unshift(command.slice(group.length + 1));
      command = group;
    }
  }

  // Same for `henri jobs:install`
  if (command && command.startsWith('jobs:')) {
    argv._.unshift(command.slice(5));
    command = 'jobs';
  }

  if (!command) {
    if (argv.version) {
      console.log((pkg && pkg.version) || version);

      return;
    }

    help(undefined, { json });

    return;
  }

  if (command === 'help') {
    help(argv._[0], { json });

    return;
  }

  if (!commands.includes(command)) {
    const { CliError } = require('./scripts/errors');

    if (!json) {
      help();
    }

    fail(
      command,
      new CliError('USAGE', `Unknown command "${command}"`, {
        hint: `Available commands: ${commands.join(', ')}`,
      }),
      json
    );
  }

  if (argv.help) {
    help(command, { json });

    return;
  }

  let cmd;

  try {
    cmd = require(`./scripts/${command}`);
  } catch (error) {
    fail(command, error, json);
  }

  Promise.resolve()
    .then(() => cmd(argv))
    .catch((error) => fail(command, error, json));
};

/**
 * Print a command failure and exit with its code
 *
 * Text: `henri <command> failed [<code>]: <message>` and the hint on stderr.
 * The code is one of henri's own (see @usehenri/core/error-codes.json), so
 * the terminal and the JSON name the failure the same way.
 * JSON (--json): `{ "error": { command, message, hint, code, exitCode } }`
 * on stderr.
 *
 * @param {string} command The command name
 * @param {Error} error What went wrong
 * @param {boolean} [json=false] Print the error as JSON
 * @returns {never} Exits with the error's exit code (1 by default)
 */
function fail(command, error, json = false) {
  const failure = toCliError(error);

  debug(error);

  if (json) {
    console.error(
      JSON.stringify({
        error: {
          code: failure.code,
          command,
          exitCode: failure.exitCode,
          hint: failure.hint,
          message: failure.message,
          ...(failure.problems ? { problems: failure.problems } : {}),
        },
      })
    );
  } else {
    console.error(
      `\n  henri ${command} failed ${chalk.grey(
        `[${failure.code}]`
      )}: ${failure.message}\n`
    );

    for (const problem of failure.problems || []) {
      console.error(
        `  ${problem.message}${problem.source ? ` (from ${problem.source})` : ''}`
      );

      if (problem.hint) {
        console.error(`    ${problem.hint}`);
      }
    }

    if (failure.problems && failure.problems.length > 0) {
      console.error('');
    }

    if (failure.hint) {
      console.error(`  ${failure.hint}\n`);
    }
  }

  if (process.env.DEBUG) {
    console.error((failure.cause || failure).stack);
  }

  process.exit(failure.exitCode);
}

/**
 * Set various global variables from arguments
 *
 * @param {*} argv arguments
 * @return {void}
 */
function setGlobalEnv(argv) {
  if (argv['production'] === true) {
    process.env.NODE_ENV = 'production';
  }

  if (typeof argv['debug'] !== 'undefined') {
    process.env.DEBUG =
      typeof argv['debug'] === 'boolean' ? '*' : argv['debug'];
  }

  if (typeof argv['inspect'] !== 'undefined') {
    const inspector = require('inspector');

    inspector.open(
      typeof argv['inspect'] === 'number' ? argv['inspect'] : 9229,
      '127.0.0.1',
      argv['wait'] === true
    );
  }

  if (argv['force-build'] === true) {
    process.env.FORCE_BUILD = 'true';
  }

  if (argv['skip-workers'] === true) {
    process.env.SKIP_WORKERS = 'true';
  }

  if (typeof argv['host'] === 'string' && argv['host']) {
    process.env.HENRI_HOST = argv['host'];
  }
}
