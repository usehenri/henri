#!/usr/bin/env node

const pkg = require('../package.json');

try {
  require('@usehenri/cli')(pkg, process.argv);
} catch (e) {
  // eslint-disable-next-line no-console
  console.log(' ');
  // eslint-disable-next-line no-console
  console.log('  Seems like henri is unable to load. Please, reinstall..');
  // eslint-disable-next-line no-console
  console.log(' ');
  // eslint-disable-next-line no-console
  console.log(e);
  process.exit(1);
}
