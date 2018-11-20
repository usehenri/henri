const { commands, helpHeader } = require('./utils');

/**
 * Show help
 *
 * @param {void} args CLI arguements
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
      --inspect       start with debugging / profiling
      --wait          force wait / use with --inspect
      --force-build   force a production rebuild (views)
      --skip-workers  do not start workers

    For more information run a command with the --help flag
      $ henri ${commands[0]} --help
  `
  );
  process.exit(0);
};

module.exports = main;
