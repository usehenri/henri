// Adding henri:clean cli
// might have to add inquirer

const path = require('path');

const inquirer = require('inquirer');
const fs = require('fs-extra');
const rimraf = require('rimraf');

const { validInstall } = require('./utils');

const main = async () => {
  if (!validInstall()) {
    console.log(`
      Seems like you are not in an henri project.

      Aborting...
    `);
    process.exit(1);
  }
  // Base list of potential junk to clean
  const initials = [
    '.tmp',
    'node_modules',
    'app/views/.cache',
    'app/views/.next',
    'app/something',
  ];

  // Keep only existing directories/files
  const existing = initials.filter(dir =>
    fs.existsSync(path.resolve(process.cwd(), dir))
  );
  const choices = existing.map(dir => {
    return { name: dir };
  });

  inquirer
    .prompt([
      {
        type: 'checkbox',
        message: 'Choose folders to delete',
        name: 'ans',
        choices: choices,
      },
    ])
    .then(answer => {
      if (answer.ans && answer.ans.lenght < 1) {
        console.log(`
          I will not delete anything.
        `);
        process.exit(0);
      }
      for (let dir of answer.ans) {
        console.log(`> Deleting ${dir}`);
        rimraf.sync(path.resolve(process.cwd(), dir));
      }
    })
    .catch(err => {
      console.dir(err);
      process.exit(1);
    });
  // Check if valid project and wipe temp folders
};

module.exports = main;
