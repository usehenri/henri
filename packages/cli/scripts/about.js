 
const spawn = require('cross-spawn');
const path = require('path');
const fs = require('fs');

const { cwd, resolvePackageJson, validInstall } = require('./utils');

/**
 * Initial function
 * @return {Promise<void>} Resolves when printed
 */
const main = async () => {
  const data = await getData();

  line('About your henri setup:', true);
  line(`henri version:         ${data.cli}`);
  line(`Node version:          ${data.node}`);
  line(`pnpm version:          ${data.pnpm}`);
  line(`yarn version:          ${data.yarn}`);
  line(`npm version:           ${data.npm}`);
  line(`henri project:         ${data.project ? 'yes' : 'no'}`, true);
  line(`@usehenri/core:        ${data.core}`);
  line(`@usehenri/disk:        ${data.disk}`);
  line(`@usehenri/mongoose:    ${data.mongoose}`);
  line(`@usehenri/mysql:       ${data.mysql}`);
  line(`@usehenri/postgresql:  ${data.postgresql}`);
  line(`@usehenri/mssql:       ${data.mssql}`);
  line(`@usehenri/react:       ${data.react}`);
  line('');
  line(`next:                  ${data.next}`);
  line(`nuxt:                  ${data.nuxt}`);
  line(`react:                 ${data.reactLib}`);
  line(`react-dom:             ${data.reactDom}`);
  line('');
  line(`models:                ${data.models}`);
  line(`views:                 ${data.views}`);
  line(`controllers:           ${data.controllers}`);
  line(`helpers:               ${data.helpers}`);
};

/**
 * Gets the data concurrently
 *
 * @returns {Promise<object>} The collected information
 */
const getData = async () => {
  const [node, pnpm, yarn, npm, models, views, controllers, helpers] =
    await Promise.all([
      run('node -v'),
      run('pnpm -v'),
      run('yarn -v'),
      run('npm -v'),
      ls('app/models'),
      ls('app/views/pages'),
      ls('app/controllers'),
      ls('app/helpers'),
    ]);

  return {
    cli: require('../package.json').version,
    controllers,
    core: installed('@usehenri/core'),
    disk: installed('@usehenri/disk'),
    helpers,
    models,
    mongoose: installed('@usehenri/mongoose'),
    mssql: installed('@usehenri/mssql'),
    mysql: installed('@usehenri/mysql'),
    next: installed('next'),
    node,
    npm,
    nuxt: installed('nuxt'),
    pnpm,
    postgresql: installed('@usehenri/postgresql'),
    project: validInstall({ fatal: false }),
    react: installed('@usehenri/react'),
    reactDom: installed('react-dom'),
    reactLib: installed('react'),
    views,
    yarn,
  };
};

/**
 * Pads line of text
 *
 * @param {*} text The text
 * @param {number} pad Amount to pad
 * @return {void}
 */
const line = (text, pad) => {
  pad && console.log(' ');
  console.log(` ${text}`);
  pad && console.log(' ');
};

/**
 * Runs the command and returns its output
 *
 * @param {*} cmd Command to run
 * @returns {Promise<string>} Output or "Not installed"
 */
const run = (cmd) => {
  return new Promise((resolve) => {
    let data = '';
    const args = cmd.split(' ');
    const program = args.shift();
    const output = spawn(program, args);

    output.stdout.on('data', (out) => (data += out));
    output.on('close', () =>
      resolve((data && data.toString().trim()) || 'Not installed')
    );
    output.on('error', () => resolve('Not installed'));
  });
};

/**
 * Lists the folder content
 *
 * @param {*} folder Folder
 * @returns {Promise<string>} Comma separated entries
 */
const ls = (folder) => {
  return new Promise((resolve) => {
    fs.readdir(path.resolve(cwd, folder), (err, files) => {
      if (err) {
        return resolve('unreachable');
      }
      files = files.filter((val) => val[0] !== '.');
      resolve(files.map((val) => val.replace('.js', '')).join(', '));
    });
  });
};

/**
 * Version of a package installed in the current project
 *
 * @param {string} name Package name
 * @returns {string} Package version or "Not installed"
 */
const installed = (name) => {
  const pkg = resolvePackageJson(name, cwd);

  return (pkg && pkg.version) || 'Not installed';
};

module.exports = main;
