const fs = require('fs-extra');
const path = require('path');

const { CliError } = require('./errors');
const { usage } = require('./help');

/**
 * Create a new application in a folder
 *
 * @param {object} args CLI arguments (_[0] is the folder)
 * @returns {Promise<void>} Resolves when the application is ready
 * @throws {CliError} USAGE without a folder, EXISTS for a non-empty one
 */
const main = async (args) => {
  const force = args.force === true;
  const [folder] = args._;

  if (!folder) {
    if (!args.json) {
      console.log(usage('new'));
    }

    throw new CliError('USAGE', 'Missing folder: henri new <folder>', {
      hint: 'henri new --help',
    });
  }

  const newPath = path.resolve(process.cwd(), folder);

  // We won't create a new structure in a non-empty directory unless forced
  if (fs.existsSync(newPath) && fs.readdirSync(newPath).length > 0 && !force) {
    throw new CliError(
      'EXISTS',
      `The folder "${folder}" already exists and is not empty`,
      {
        hint: 'Use -f or --force if you really want to create an application there',
      }
    );
  }

  fs.mkdirpSync(newPath);
  process.chdir(newPath);

  const init = require('./init');

  await init(args, path.basename(newPath));
};

module.exports = main;
