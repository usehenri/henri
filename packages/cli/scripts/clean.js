const fs = require('fs-extra');
const path = require('path');
const { checkbox } = require('@inquirer/prompts');

const { abort, validInstall } = require('./utils');

/**
 * Bootstrapping function
 * @return {Promise<void>} Resolves when done
 */
const main = async () => {
  validInstall({ fatal: true });

  const choices = getExistingDirectories();

  if (choices.length < 1) {
    abort('Nothing to clean.');
  }

  let selected = [];

  try {
    selected = await checkbox({
      choices,
      message: 'Choose folders to delete',
    });
  } catch (error) {
    abort(error.message, true);
  }

  if (!selected || selected.length < 1) {
    abort('I will not delete anything.');
  }

  for (const dir of selected) {
    remove(dir);
  }
};

/**
 * Get the existing directories
 *
 * @returns {Array<{name: string, value: string}>} list of directories
 */
const getExistingDirectories = () => {
  // Base list of potential junk to clean
  const initials = [
    '.tmp',
    '.henri',
    'logs',
    'node_modules',
    'app/views/.cache',
    'app/views/.next',
  ];
  const existing = initials.filter((dir) =>
    fs.existsSync(path.resolve(process.cwd(), dir))
  );

  return existing.map((dir) => ({ name: dir, value: dir }));
};

/**
 * Remove the directory
 *
 * @param {string} dir The directory
 * @return {void}
 */
const remove = (dir) => {
  console.log(`> Deleting ${dir}`);
  fs.rmSync(path.resolve(process.cwd(), dir), { force: true, recursive: true });
  console.log(`> Touching ${dir}`);
  fs.ensureDirSync(path.resolve(process.cwd(), dir));
};

module.exports = main;
