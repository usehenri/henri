const { commands, helpHeader } = require('./utils');

const main = args => {
  console.log(
    `
    ${helpHeader()}
    Usage
      $ henri <command>

    Available commands
      ${Array.from(commands).join(', ')}

    Available flags
      --production    same as NODE_ENV=production
      --debug[=*]     same as DEBUG. ex: --debug=express:*

    For more information run a command with the --help flag
      $ henri ${commands[0]} --help
  `
  );
  process.exit(0);
};

module.exports = main;
