#!/usr/bin/env node

/* eslint-disable no-console */
const pkg = require('../package.json');

const MINIMUM_MAJOR = 22;

const major = parseInt(process.versions.node.split('.')[0], 10);

if (Number.isNaN(major) || major < MINIMUM_MAJOR) {
  const isNVM = typeof process.env['NVM_DIR'] !== 'undefined';

  console.log('');
  console.log(
    'You are using Node.js',
    process.version,
    isNVM ? 'with NVM' : ''
  );
  console.log('');
  console.log(`henri requires Node.js ${MINIMUM_MAJOR} or newer.`);
  console.log('');

  if (isNVM) {
    console.log('Switch to a supported version with "nvm install --lts"');
    console.log('See https://github.com/nvm-sh/nvm');
  } else {
    console.log('See https://nodejs.org/en/download/');
  }
  console.log('');

  process.exit(1);
}

try {
  require('@usehenri/cli')(pkg, process.argv);
} catch (error) {
  console.log(' ');
  console.log('  Seems like henri is unable to load. Please, reinstall..');
  console.log(' ');
  console.log(error);
  process.exit(1);
}
