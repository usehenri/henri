const { commands, helpHeader } = require('./utils');

/**
 * Show help
 *
 * @param {any} args CLI arguements
 * @returns {void}
 */
const main = () => {
  // eslint-disable-next-line
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
      --force-build   force a production rebuild (views)

    For more information run a command with the --help flag
      $ henri ${commands[0]} --help
  `
  );
  process.exit(0);
};

module.exports = main;
