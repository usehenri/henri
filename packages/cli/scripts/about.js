// eslint-disable no-console

const spawn = require('cross-spawn');
const path = require('path');
const fs = require('fs');

const { cwd, validInstall } = require('./utils');

let output = '';

/**
 * Initial function
 * @return {void}
 */
const main = async () => {
  const data = await getData();

  line('About your henri setup:', true);
  line(`henri version:         ${data[0]}`);
  line(`Node version:          ${data[1]}`);
  line(`yarn version:          ${data[2]}`);
  line(`npm version:           ${data[3]}`);
  line(`henri project:         ${data[4] ? 'yes' : 'no'}`, true);
  line(`@usehenri/core:        ${data[5]}`);
  line(`@usehenri/disk:        ${data[6]}`);
  line(`@usehenri/mongoose:    ${data[7]}`);
  line(`@usehenri/mysql:       ${data[8]}`);
  line(`@usehenri/postgresql:  ${data[9]}`);
  line(`@usehenri/mssql:       ${data[10]}`);
  line(`@usehenri/redis:       ${data[11]}`);
  line(`@usehenri/rabbitmq:    ${data[12]}`);
  line(`@usehenri/react:       ${data[13]}`);
  line('');
  line(`next:                  ${data[14]}`);
  line(`nuxt:                  ${data[15]}`);
  line(`react:                 ${data[16]}`);
  line(`react-dom:             ${data[17]}`);
  line('');
  line(`models:                ${data[18]}`);
  line(`views:                 ${data[19]}`);
  line(`controllers:           ${data[20]}`);
  line(`helpers:               ${data[21]}`);
};

/**
 * Gets the data concurrently
 *
 * @returns {Promise<any>} The promise
 */
const getData = async () => {
  const data = await Promise.all([
    // eslint-disable-next-line
    require('../package.json').version,
    run('node -v'),
    run('yarn -v'),
    run('npm -v'),
    validInstall({ fatal: false }),
    packageResolve('core'),
    packageResolve('disk'),
    packageResolve('mongoose'),
    packageResolve('mysql'),
    packageResolve('postgresql'),
    packageResolve('mssql'),
    packageResolve('redis'),
    packageResolve('rabbitmq'),
    packageResolve('react'),
    depsResolve('next'),
    depsResolve('nuxt'),
    depsResolve('react'),
    depsResolve('react-dom'),
    ls('app/models'),
    ls('app/views/pages'),
    ls('app/controllers'),
    ls('app/helpers'),
  ]);

  return data;
};

/**
 * Pads line of text
 *
 * @param {*} text The text
 * @param {number} pad Amount to pad
 * @return {void}
 */
const line = (text, pad) => {
  // eslint-disable-next-line no-console
  pad && console.log(' ');
  // eslint-disable-next-line no-console
  console.log(` ${text}`);
  output = output + text;
  // eslint-disable-next-line no-console
  pad && console.log(' ');
};

/**
 * Runs the command and returns status
 *
 * @param {*} cmd Command to run
 * @returns {Promise<any>} A promise
 */
const run = cmd => {
  return new Promise(resolve => {
    let data = '';
    const args = cmd.split(' ');
    const program = args.shift();
    const output = spawn(program, args);

    output.stdout.on('data', out => (data += out));
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
 * @returns {Promise<any>} A promise
 */
const ls = folder => {
  return new Promise(resolve => {
    fs.readdir(path.resolve(cwd, folder), (err, files) => {
      if (err) {
        return resolve('unreachable');
      }
      files = files.filter(val => val[0] !== '.');
      resolve(files.map(val => val.replace('.js', '')).join(', '));
    });
  });
};

/**
 * Tries to resolve a package
 *
 * @param {*} name Package name
 * @returns {string} Package version or Not Installed
 */
const packageResolve = name => {
  try {
    // eslint-disable-next-line
    const pkg = require(path.resolve(
      cwd,
      'node_modules',
      '@usehenri',
      name,
      'package.json'
    ));

    return pkg.version;
  } catch (error) {
    return 'Not installed';
  }
};

/**
 * Tries to resolve a package deps
 *
 * @param {*} name Package name
 * @returns {string} Package version or Not Installed
 */
const depsResolve = name => {
  try {
    // eslint-disable-next-line
    const pkg = require(path.resolve(
      cwd,
      'node_modules',
      name,
      'package.json'
    ));

    return pkg.version;
  } catch (error) {
    return 'Not installed';
  }
};

module.exports = main;
