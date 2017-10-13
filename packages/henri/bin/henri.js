#!/usr/bin/env node

try {
  require('@usehenri/cli');
} catch (e) {
  console.log(' ');
  console.log('  Seems like henri is unable to load. Please, reinstall..');
  console.log(' ');
  process.exit(1);
}
