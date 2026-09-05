// @ts-check
/* eslint-disable no-console */

const chalk = require('chalk');
const debug = require('debug')('henri:cli');

const { commands, version } = require('./package.json');

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
 * as the folder name)
 */
const BOOLEAN_FLAGS = [
  'force',
  'force-build',
  'help',
  'json',
  'production',
  'skip-install',
  'skip-workers',
  'version',
  'wait',
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
    alias: { f: 'force', h: 'help', v: 'version' },
    boolean: BOOLEAN_FLAGS,
  });
  const help = require('./scripts/help');

  setGlobalEnv(argv);

  const command = argv._.shift();

  if (!command) {
    if (argv.version) {
      console.log((pkg && pkg.version) || version);

      return;
    }

    help();

    return;
  }

  if (command === 'help') {
    help(argv._[0]);

    return;
  }

  if (!commands.includes(command)) {
    console.error(`\n  Unknown command "${command}"`);
    help();
    process.exit(1);
  }

  if (argv.help) {
    help(command);

    return;
  }

  let cmd;

  try {
    cmd = require(`./scripts/${command}`);
  } catch (error) {
    fail(command, error);
  }

  Promise.resolve()
    .then(() => cmd(argv))
    .catch((error) => fail(command, error));
};

/**
 * Print a command failure and exit
 *
 * @param {string} command The command name
 * @param {Error} error What went wrong
 * @returns {never} Exits with 1
 */
function fail(command, error) {
  const message = (error && error.message) || String(error);

  debug(error);
  console.error(`\n  henri ${command} failed: ${message}\n`);

  if (process.env.DEBUG) {
    console.error(error && error.stack);
  } else {
    console.error('  Run the command with --debug=henri:* for the details.\n');
  }

  process.exit(1);
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
