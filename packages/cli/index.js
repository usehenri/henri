const spawn = require('cross-spawn');
const chalk = require('chalk');
const updateNotifier = require('update-notifier');
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

// eslint-disable-next-line complexity
module.exports = (pkg, args) => {
  const argv = require('minimist')(args.slice(2));
  updateNotifier({ pkg, updateCheckInterval: 1000 }).notify({
    defer: false,
    isGlobal: true,
  });

  if (typeof argv['production'] !== 'undefined') {
    process.env.NODE_ENV = 'production';
  }

  if (typeof argv['debug'] !== 'undefined') {
    process.env.DEBUG =
      typeof argv['debug'] === 'boolean' ? '*' : argv['debug'];
  }

  const command = argv._.shift();

  switch (command) {
    case 'about':
    case 'clean':
    case 'console':
    case 'g':
    case 'generate':
    case 'init':
    case 'new':
    case 'server':
    case 'start-henri':
      const cmd = require(`./scripts/${command}`);
      cmd(argv);
      break;
    default:
      const help = require('./scripts/help');
      help();
  }
};
