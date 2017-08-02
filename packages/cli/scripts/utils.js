const fs = require('fs-extra');
const path = require('path');

const { version, commands } = require('../package.json');

const cwd = process.cwd();

const check = file => fs.existsSync(path.join(cwd, file));

// Will validate if it's an henri install (more or less)
const validInstall = () => {
  try {
    const pkg = require(path.resolve(process.cwd(), 'package.json'));
    if (pkg && !pkg.henri) {
      return false;
    }
    if (!fs.existsSync(process.cwd(), 'app/views/pages')) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
};

module.exports = { version, commands, cwd, check, validInstall };
