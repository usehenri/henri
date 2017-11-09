#!/usr/bin/env node

const pkg = require('../package.json');

try {
  require('@usehenri/cli')(pkg, process.argv);
} catch (e) {
  console.log(' ');
  console.log('  Seems like henri is unable to load. Please, reinstall..');
  console.log(' ');
  console.log(e);
  process.exit(1);
}
