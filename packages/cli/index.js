// @ts-check

const chalk = require('chalk');
const debug = require('debug')('henri:cli');

if (require.main === module) {
  const { detectPackageManager } = require('./scripts/utils');
  const pm = detectPackageManager();
  const install = pm === 'npm' ? 'npm install -g' : `${pm} add -g`;

  // eslint-disable-next-line no-console
  console.log(
    `
    This module should not be run directly.

    Please, use ${chalk.cyan('henri')} or install it via:

    # ${install} henri

    `
  );
  process.exit(1);
}

module.exports = (pkg, args) => {
  const argv = require('minimist')(args.slice(2));

  setGlobalEnv(argv);

  const command = argv._.shift();

  switch (command) {
    case 'about':
    case 'build':
    case 'clean':
    case 'console':
    case 'd':
    case 'destroy':
    case 'g':
    case 'generate':
    case 'init':
    case 'new':
    case 's':
    case 'server':
    case 'test':
      try {
        const cmd = require(`./scripts/${command}`);

        Promise.resolve(cmd(argv)).catch((error) => {
          debug(error);
          // eslint-disable-next-line no-console
          console.error(`henri ${command} failed: ${error.message}`);
          process.exit(1);
        });
      } catch (error) {
        const help = require('./scripts/help');

        debug(error);

        help();
      }
      break;
    default: {
      const help = require('./scripts/help');

      help();
    }
  }
};

/**
 * Set various global variables from arguments
 *
 * @param {*} argv arguments
 * @return {void}
 */
function setGlobalEnv(argv) {
  if (typeof argv['production'] !== 'undefined') {
    process.env.NODE_ENV = 'production';
  }

  if (typeof argv['debug'] !== 'undefined') {
    process.env.DEBUG =
      typeof argv['debug'] === 'boolean' ? '*' : argv['debug'];
  }

  if (typeof argv['inspect'] !== 'undefined') {
    const inspector = require('inspector');

    inspector.open(
      argv['inspect'] || 9229,
      '127.0.0.1',
      typeof argv['wait'] !== 'undefined'
    );
  }

  if (typeof argv['force-build'] !== 'undefined') {
    process.env.FORCE_BUILD = 'true';
  }

  if (typeof argv['skip-workers'] !== 'undefined') {
    process.env.SKIP_WORKERS = 'true';
  }
}
