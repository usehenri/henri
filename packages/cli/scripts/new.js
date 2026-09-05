const fs = require('fs-extra');
const path = require('path');

const { usage } = require('./help');

/**
 * Create a new application in a folder
 *
 * @param {object} args CLI arguments (_[0] is the folder)
 * @returns {Promise<void>} Resolves when the application is ready
 */
const main = async (args) => {
  const force = args.force === true;
  const [folder] = args._;

  if (!folder) {
    console.log(usage('new'));
    process.exit(1);
  }

  const newPath = path.resolve(process.cwd(), folder);

  // We won't create a new structure in a non-empty directory unless forced
  if (fs.existsSync(newPath) && fs.readdirSync(newPath).length > 0 && !force) {
    console.log(
      `
      The folder "${folder}" already exists and is not empty. Use -f or
      --force if you really want to create an application there.
    `
    );
    process.exit(1);
  }

  fs.mkdirpSync(newPath);
  process.chdir(newPath);

  const init = require('./init');

  await init(args, path.basename(newPath));
};

module.exports = main;
