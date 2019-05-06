#!/usr/bin/env node

const pkg = require('../package.json');

const MINIMUM_VERSION = 10.0;

const version = process.version;
const check = parseFloat(version.substr(1, version.length)) > MINIMUM_VERSION;

if (!check) {
  const isNVM = process.env['NVM_DIR'];

  console.log('');
  console.log(
    'You are using Node.js',
    version,
    isNVM !== 'undefined' ? 'with NVM' : ''
  );
  console.log('');

  if (typeof isNVM === 'undefined') {
    console.log('You should upgrade to a version higher than Node.js 10.x');

    console.log('');
    console.log('See https://nodejs.org/en/download/');
  } else {
    console.log(
      'You should switch to a higher version of node using "nvm install --lts"'
    );
    console.log('');
    console.log('See https://github.com/creationix/nvm');
  }
  console.log('');

  process.exit(1);
}

try {
  // eslint-disable-next-line global-require
  require('@usehenri/cli')(pkg, process.argv);
} catch (error) {
  // eslint-disable-next-line no-console
  console.log(' ');
  // eslint-disable-next-line no-console
  console.log('  Seems like henri is unable to load. Please, reinstall..');
  // eslint-disable-next-line no-console
  console.log(' ');
  // eslint-disable-next-line no-console
  console.log(error);
  process.exit(1);
}
