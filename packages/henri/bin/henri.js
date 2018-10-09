#!/usr/bin/env node

const pkg = require('../package.json');

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
