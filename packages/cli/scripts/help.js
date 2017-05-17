const { version, commands } = require('./utils');

const main = args => {
  console.log(
    `
    henri ${version}

    Usage
      $ henri <command>

    Available commands
      ${Array.from(commands).join(', ')}

    For more information run a command with the --help flag
      $ henri ${commands[0]} --help
  `
  );
  process.exit(0);
};

module.exports = main;
