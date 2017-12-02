/* eslint-disable no-console */
const spawn = require('cross-spawn');
const fs = require('fs-extra');
const path = require('path');
const { version } = require('./utils');

const yarnExists = spawn.sync('yarn', ['help']);
const cwd = process.cwd();

const check = file => fs.existsSync(path.join(cwd, file));

// command line arguments, name (if it's called from new command)
const main = (args, name) => {
  // Check the force flag
  const force = args.force === true || args.f === true;

  console.log('');

  buildPackage();

  createReadme();

  if (check('app') && !force) {
    console.log(
      `
      It looks like you already have an 'app' folder. Use --force or -f to
      copy the new structure...
    `
    );
    process.exit(-1);
  }

  copyTemplate();

  generateConfig();

  installPackages();

  console.log(`
    Your new project is ready to run!

    You can start coding right away with:

    # cd ${name} && henri server

  `);
};

const buildPackage = () => {
  let pkg = {};
  try {
    pkg = require(path.resolve(cwd, 'package.json'));
  } catch (e) {}

  console.log(' - Building new package file...');

  // Import existing dependencies if present
  pkg.dependencies = pkg.dependencies || {};

  // Import existing devDependencies if present
  pkg.devDependencies = pkg.devDependencies || {};

  // Add some runnable script
  pkg.scripts = {
    start: 'henri server',
    production: 'henri production',
    update: 'henri update',
    eject: 'henri eject',
  };

  pkg.henri = version;

  // Write package.json to filesystem
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );
};

const createReadme = () => {
  console.log(' - Adding new readme file...');

  if (check('README.md')) {
    fs.renameSync(path.join(cwd, 'README.md'), path.join(cwd, 'README.old.md'));
  }
};

const copyTemplate = () => {
  console.log(' - Copying new directory structure...');

  const templatePath = path.resolve(__dirname, '../template/default/');

  fs.copySync(templatePath, cwd);
  fs.moveSync(path.resolve(cwd, 'gitignore'), path.resolve(cwd, '.gitignore'), {
    overwrite: true,
  });
};

const generateConfig = () => {
  console.log(' - Generating a new default.json config file...');

  const buf = require('crypto').randomBytes(64);
  const configuration = {
    log: 'main.log',
    stores: {
      default: {
        adapter: 'disk',
      },
    },
    renderer: 'react',
    baseRole: 'guest',
    user: 'user',
    secret: `${buf.toString('hex')}`,
  };

  fs.writeFileSync(
    path.join(cwd, 'config', 'default.json'),
    JSON.stringify(configuration, null, 2)
  );
};

const installPackages = () => {
  console.log(' - Installing needed packages...');

  if (yarnExists) {
    spawn.sync('yarn');
  } else {
    spawn.sync('npm', ['install']);
  }
};

module.exports = main;
