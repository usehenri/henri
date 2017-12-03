/* eslint-disable no-console */
const fs = require('fs-extra');
const path = require('path');

const { version, commands } = require('../package.json');

const cwd = process.cwd();

const check = file => fs.existsSync(path.join(cwd, file));

// Will validate if it's an henri install (more or less)
const validInstall = args => {
  try {
    const pkg = require(path.resolve(process.cwd(), 'package.json'));
    if (pkg && !pkg.henri) {
      return notHenri(args);
    }
    if (!fs.existsSync(process.cwd(), 'app/views/pages')) {
      return notHenri(args);
    }
    return true;
  } catch (e) {
    return notHenri(args);
  }
};

const notHenri = ({ fatal = false }) => {
  if (abort) {
    abort(
      `
    Seems like you are not in an henri project.
    
    Aborting...
    `,
      true
    );
  }
  return false;
};

const abort = (msg, fail = false) => {
  console.log(`
  ${msg}
  `);
  process.exit(fail ? 1 : 0);
};

module.exports = { abort, version, commands, cwd, check, validInstall };
