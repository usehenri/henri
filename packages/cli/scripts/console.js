const repl = require('repl');
const chalk = require('chalk');
const path = require('path');

const server = require('./server');

let name = 'henri';

try {
  // eslint-disable-next-line global-require
  name = require(path.resolve(process.cwd(), 'package.json')).name || 'henri';
} catch (error) {
  // Do nothing
}

/**
 * Starts henri server then repl
 *
 * @return {void}
 */
const main = async () => {
  const prompt = `${chalk.blue.bold(name)}${chalk.white.bold('> ')}`;

  await server({ consoleOnly: true }, () => {
    repl.start({ prompt, useGlobal: true });
  });
};

module.exports = main;
