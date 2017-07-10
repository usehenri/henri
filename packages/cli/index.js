const spawn = require('cross-spawn');
const chalk = require('chalk');
const yarnExists = spawn.sync('yarn', ['help']);

if (!module.parent) {
  // eslint-disable-next-line no-console
  console.log(
    `
    This module should not be run directly. 
    
    Please, use ${chalk.cyan('henri')} or install it via:

    # ${yarnExists ? 'yarn add global' : 'npm install -g'} henri

    `
  );
  process.exit(1);
}

const argv = require('minimist')(process.argv.slice(2));

const command = argv._.shift();

switch (command) {
  case 'server':
  case 'init':
  case 'new':
  case 'console':
  case 'start-henri':
    const cmd = require(`./scripts/${command}`);
    cmd(argv);
    break;
  default:
    const help = require('./scripts/help');
    help();
}
