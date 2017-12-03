/* eslint-disable no-console */
// Adding henri:clean cli
// might have to add inquirer

const path = require('path');

const inquirer = require('inquirer');
const fs = require('fs-extra');
const rimraf = require('rimraf');

const { abort, validInstall } = require('./utils');

const main = async () => {
  validInstall({ fail: true });

  const opts = {
    type: 'checkbox',
    message: 'Choose folders to delete',
    name: 'ans',
    choices: getExistingDirectories(),
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

const getExistingDirectories = () => {
  // Base list of potential junk to clean
  const initials = [
    '.tmp',
    'logs',
    'node_modules',
    'app/views/.cache',
    'app/views/.next',
    'app/something',
  ];
  const existing = initials.filter(dir =>
    fs.existsSync(path.resolve(process.cwd(), dir))
  );
  const choices = existing.map(dir => {
    return { name: dir };
  });

  return choices;
};

const remove = dir => {
  console.log(`> Deleting ${dir}`);
  rimraf.sync(path.resolve(process.cwd(), dir));
  console.log(`> Touching ${dir}`);
  fs.ensureDirSync(path.resolve(process.cwd(), dir));
};

module.exports = main;
