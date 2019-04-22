/* eslint-disable no-console */
const spawn = require('cross-spawn');
const fs = require('fs-extra');
const path = require('path');
const { version } = require('./utils');

const yarnExists = spawn.sync('yarn', ['help']).status === 0;
const cwd = process.cwd();

/**
 * Checks if a file exists
 *
 * @param {string} file A file to check in cwd
 * @returns {boolean} result
 */
const check = file => fs.existsSync(path.join(cwd, file));

/**
 * Initialize a new install
 *
 * @param {any} args CLI arguments
 * @param {any} name If true, called from new
 * @returns {void} Nothing
 */
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

/**
 * Creates a package.json file
 * @returns {void}
 */
const buildPackage = () => {
  let pkg = {};

  try {
    // eslint-disable-next-line
    pkg = require(path.resolve(cwd, 'package.json'));
  } catch (error) {
    // It does not exists... no worries, we'll create it.
  }

  console.log(' - Building new package file...');

  // Import existing dependencies if present
  pkg.dependencies = pkg.dependencies || {};

  // Import existing devDependencies if present
  pkg.devDependencies = pkg.devDependencies || {};

  // Add some runnable script
  pkg.scripts = {
    eject: 'henri eject',
    production: 'henri production',
    start: 'henri server',
    update: 'henri update',
  };

  pkg.henri = version;

  // Write package.json to filesystem
  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );
};

/**
 * Creates a readme
 * @returns {void}
 */
const createReadme = () => {
  console.log(' - Adding new readme file...');

  if (check('README.md')) {
    fs.renameSync(path.join(cwd, 'README.md'), path.join(cwd, 'README.old.md'));
  }
};

/**
 * Copies the template from @usehenri/cli/template
 * @returns {void}
 */
const copyTemplate = () => {
  console.log(' - Copying new directory structure...');

  const templatePath = path.resolve(__dirname, '../template/default/');

  fs.copySync(templatePath, cwd);
  fs.moveSync(path.resolve(cwd, 'gitignore'), path.resolve(cwd, '.gitignore'), {
    overwrite: true,
  });
  fs.moveSync(path.resolve(cwd, 'eslintrc'), path.resolve(cwd, '.eslintrc'), {
    overwrite: true,
  });
};

/**
 * Generate boilerplate henri configuration
 * @returns {void}
 */
const generateConfig = () => {
  console.log(' - Generating a new default.json config file...');

  // eslint-disable-next-line
  const buf = require('crypto').randomBytes(64);
  const configuration = {
    baseRole: 'guest',
    log: 'main.log',
    renderer: 'react',
    secret: `${buf.toString('hex')}`,
    stores: {
      default: {
        adapter: 'disk',
      },
    },
    user: 'user',
  };

  fs.writeFileSync(
    path.join(cwd, 'config', 'default.json'),
    JSON.stringify(configuration, null, 2)
  );
};

/**
 * Installs packages with yarn or npm
 * @returns {void}
 */
const installPackages = () => {
  if (yarnExists) {
    console.log(' - Installing needed packages using yarn...');
    spawn.sync('yarn');
  } else {
    console.log(' - Installing needed packages using npm...');
    spawn.sync('npm', ['install']);
  }
};

module.exports = main;
