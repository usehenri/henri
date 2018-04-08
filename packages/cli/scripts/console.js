const repl = require('repl');
const chalk = require('chalk');
const path = require('path');

const server = require('./server');

let name = 'henri';

try {
  name = require(path.resolve(process.cwd(), 'package.json')).name || 'henri';
} catch (e) {}

const main = async args => {
  const prompt = `${chalk.blue.bold(name)}${chalk.white.bold('> ')}`;

  await server({ consoleOnly: true }, () => {
    repl.start({ prompt, useGlobal: true });
  });
};

module.exports = main;
