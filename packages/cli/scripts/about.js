const spawn = require('cross-spawn');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { cwd, validInstall } = require('./utils');

let output = '';

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
  digest();
};

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

const digest = () => {
  const hmac = crypto.createHmac('sha256', 'henri about data');

  hmac.update(output);
  const result = hmac.digest('hex');

  line('');
  line(`You can share this key: ${result} `);
  line('');
};

const line = (text, pad) => {
  pad && console.log(' ');
  console.log(` ${text}`);
  output = output + text;
  pad && console.log(' ');
};

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
