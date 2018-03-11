const spawn = require('cross-spawn');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { cwd, validInstall } = require('./utils');

let output = '';

const main = async () => {
  const data = getData();

  l('About your henri setup:', true);
  l(`henri version:         ${data[0]}`);
  l(`Node version:          ${data[1]}`);
  l(`yarn version:          ${data[2]}`);
  l(`npm version:           ${data[3]}`);
  l(`henri project:         ${data[4] ? 'yes' : 'no'}`, true);
  l(`@usehenri/disk:        ${data[5]}`);
  l(`@usehenri/mongoose:    ${data[6]}`);
  l(`@usehenri/mysql:       ${data[7]}`);
  l(`@usehenri/postgresql:  ${data[8]}`);
  l(`@usehenri/mssql:       ${data[9]}`);
  l(`@usehenri/redis:       ${data[10]}`);
  l(`@usehenri/rabbitmq:    ${data[11]}`);
  l('');
  l(`next:                  ${data[12]}`);
  l(`nuxt:                  ${data[13]}`);
  l(`react:                 ${data[14]}`);
  l(`react-dom:             ${data[15]}`);
  l('');
  l(`models:                ${data[16]}`);
  l(`views:                 ${data[17]}`);
  l(`controllers:           ${data[18]}`);
  l(`helpers:               ${data[19]}`);
  digest();
};

const getData = async () => {
  const data = await Promise.all([
    require('../package.json').version,
    run('node -v'),
    run('yarn -v'),
    run('npm -v'),
    validInstall({ fatal: false }),
    packageResolve('disk'),
    packageResolve('mongoose'),
    packageResolve('mysql'),
    packageResolve('postgresql'),
    packageResolve('mssql'),
    packageResolve('redis'),
    packageResolve('rabbitmq'),
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

const digest = () => {
  const hmac = crypto.createHmac('sha256', 'henri about data');

  hmac.update(output);
  const result = hmac.digest('hex');
  l('');
  l(`You can share this key: ${result} `);
  l('');
};

const l = (text, pad) => {
  pad && console.log(' ');
  console.log(` ${text}`);
  output = output + text;
  pad && console.log(' ');
};

const run = cmd => {
  return new Promise((resolve, reject) => {
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

const ls = folder => {
  return new Promise(resolve => {
    fs.readdir(path.resolve(cwd, folder), (err, files) => {
      if (err) {
        return resolve('unreachable');
      }
      files = files.filter(v => v[0] !== '.');
      resolve(files.map(v => v.replace('.js', '')).join(', '));
    });
  });
};

const packageResolve = (name, scoped = false) => {
  try {
    const pkg = require(path.resolve(
      cwd,
      'node_modules',
      '@usehenri',
      name,
      'package.json'
    ));
    return pkg.version;
  } catch (e) {
    return 'Not installed';
  }
};

const depsResolve = name => {
  try {
    const pkg = require(path.resolve(
      cwd,
      'node_modules',
      name,
      'package.json'
    ));
    return pkg.version;
  } catch (e) {
    return 'Not installed';
  }
};

module.exports = main;
