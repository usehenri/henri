const spawn = require('cross-spawn');
const path = require('path');
const fs = require('fs');

const { cwd, validInstall } = require('./utils');

const main = async () => {
  l('About your henri setup:', true);
  l(`henri version:         ${require('../package.json').version}`);
  l(`Node version:          ${await run('node -v')}`);
  l(`yarn version:          ${await run('yarn -v')}`);
  l(`npm version:           ${await run('npm -v')}`);
  l(`henri project:         ${validInstall() ? 'yes' : 'no'}`, true);
  l(`@usehenri/disk:        ${packageResolve('disk')}`);
  l(`@usehenri/mongoose:    ${packageResolve('mongoose')}`);
  l(`@usehenri/mysql:       ${packageResolve('mysql')}`);
  l(`@usehenri/postgresql:  ${packageResolve('postgresql')}`);
  l(`@usehenri/mssql:       ${packageResolve('mssql')}`);
  l(`@usehenri/redis:       ${packageResolve('redis')}`);
  l(`@usehenri/rabbitmq:    ${packageResolve('rabbitmq')}`);
  l('');
  l(`next:                  ${depsResolve('next')}`);
  l(`nuxt:                  ${depsResolve('nuxt')}`);
  l(`react:                 ${depsResolve('react')}`);
  l(`react-dom:             ${depsResolve('react-dom')}`);
  l('');
  l(`models:                ${await ls('app/models')}`);
  l(`views:                 ${await ls('app/views/pages')}`);
  l(`controllers:           ${await ls('app/controllers')}`);
  l(`helpers:               ${await ls('app/helpers')}`);
  l('');
};

const l = (text, pad) => {
  pad && console.log(' ');
  console.log(` ${text}`);
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
