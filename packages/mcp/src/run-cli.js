// Runs one henri command in a child process (see cli.js): the CLI of the
// application when it has one, the CLI this package depends on otherwise.
const path = require('path');

/**
 * The package.json of the @usehenri/cli to run
 *
 * @returns {string} Absolute path
 */
const locate = () => {
  try {
    return require.resolve('@usehenri/cli/package.json', {
      paths: [process.cwd()],
    });
  } catch {
    return require.resolve('@usehenri/cli/package.json');
  }
};

const manifest = locate();

require(path.dirname(manifest))(require(manifest), process.argv);
