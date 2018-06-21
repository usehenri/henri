const path = require('path');

const inquirer = require('inquirer');
const fs = require('fs-extra');
const rimraf = require('rimraf');

const { abort, validInstall } = require('./utils');

/**
 * Bootstrapping function
 * @return {void}
 */
const main = async () => {
  validInstall({ fail: true });

  const opts = {
    choices: getExistingDirectories(),
    message: 'Choose folders to delete',
    name: 'ans',
    type: 'checkbox',
  };

  inquirer
    .prompt([opts])
    .then(answer => {
      if (answer.ans && answer.ans.lenght < 1) {
        abort('I will not delete anything.');
      }
      for (let dir of answer.ans) {
        remove(dir);
      }
    })
    .catch(err => {
      abort(err, true);
    });
};

/**
 * Get the existing directories
 *
 * @returns {object} list of directories
 */
const getExistingDirectories = () => {
  // Base list of potential junk to clean
  const initials = [
    '.tmp',
    'logs',
    'node_modules',
    'app/views/.cache',
    'app/views/.next',
  ];
  const existing = initials.filter(dir =>
    fs.existsSync(path.resolve(process.cwd(), dir))
  );
  const choices = existing.map(dir => {
    return { name: dir };
  });

  return choices;
};

/**
 * Remove the directory
 *
 * @param {string} dir The directory
 * @return {void}
 */
const remove = dir => {
  // eslint-disable-next-line no-console
  console.log(`> Deleting ${dir}`);
  rimraf.sync(path.resolve(process.cwd(), dir));
  // eslint-disable-next-line no-console
  console.log(`> Touching ${dir}`);
  fs.ensureDirSync(path.resolve(process.cwd(), dir));
};

module.exports = main;
