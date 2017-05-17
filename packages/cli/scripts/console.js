const repl = require('repl');
const chalk = require('chalk');
const path = require('path');

const server = require('./server');

let name = 'henri';

try {
  name = require(path.resolve(process.cwd(), 'package.json')).name || 'henri';
} catch (e) {}

const main = args => {
  const prompt = `${chalk.blue.bold(name)}${chalk.white.bold('> ')}`;

  server({ skipView: true }, () => {
    repl.start({ prompt, useGlobal: true });
  });
};

module.exports = main;
