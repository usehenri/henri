const spawn = require('cross-spawn');
const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const { version, commands } = require('./utils');

const yarnExists = spawn.sync('yarn', ['help']);
const cwd = process.cwd();
const templatePath = path.resolve(__dirname, '../template/');

const check = file => fs.existsSync(path.join(cwd, file));

const main = args => {
  let pkg = {};
  try {
    const pkg = require(path.resolve(cwd, 'package.json'));
  } catch (e) {}
  const force = args.force === true || args.f === true;
  console.log('');
  console.log(' - Building new package file...');
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies['next'] = pkg.dependencies['next'] || '2.2.0';
  pkg.dependencies['react'] = pkg.dependencies['react'] || '15.5.4';
  pkg.dependencies['react-dom'] = pkg.dependencies['react-dom'] || '15.5.4';
  pkg.devDependencies = pkg.devDependencies || {};

  pkg.scripts = {
    start: 'henri server',
    production: 'henri production',
    update: 'henri update',
    eject: 'henri eject'
  };

  fs.writeFileSync(
    path.join(cwd, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );
  console.log(' - Adding new readme file...');
  const readmeExists = check('README.md');
  if (readmeExists) {
    fs.renameSync(path.join(cwd, 'README.md'), path.join(cwd, 'README.old.md'));
  }

  if (check('app') && !force) {
    console.log(
      `
      It looks like you already have an 'app' folder. Use --force or -f to
      copy the new structure...
    `
    );
    process.exit(-1);
  }
  console.log(' - Copying new directory structure...');
  fs.copySync(templatePath, cwd);
  fs.moveSync(path.resolve(cwd, 'gitignore'), path.resolve(cwd, '.gitignore'), {
    overwrite: true
  });
  console.log(' - Generating a new default.json config file...');
  const buf = require('crypto').randomBytes(64);

  const configuration = {
    log: 'main.log',
    stores: {
      default: {
        adapter: 'disk'
      }
    },
    secret: `${buf.toString('hex')}`
  };
  fs.writeFileSync(
    path.join(cwd, 'config', 'default.json'),
    JSON.stringify(configuration, null, 2)
  );
  console.log(' - Installing needed packages...');
  if (yarnExists) {
    spawn.sync('yarn');
  } else {
    spawn.sync('npm', ['install']);
  }
  console.log(
    `
    Your new project is ready to run!

    You can start coding right away with:

    # henri server

  `
  );
};

const help = args => {
  console.log(
    `
    henri (${version})

    Usage
      $ henri init [-f | --force]

    Available commands
      ${Array.from(commands).join(', ')}

    For more information run a command with the --help flag
      $ henri ${commands[0]} --help
  `
  );
  process.exit(0);
};
module.exports = main;
