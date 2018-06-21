/* eslint-disable no-console */
const fs = require('fs-extra');
const path = require('path');

const { version, commands } = require('../package.json');

const cwd = process.cwd();

/**
 * Check if a file exists
 *
 * @param {*} file Filename
 * @returns {boolean} True or false?
 */
const check = file => fs.existsSync(path.join(cwd, file));

/**
 * Will validate if it's an henri install (more or less)
 *
 * @param {*} args Fatal or no
 * @returns {boolean|void} If fatal is specified, exit the process
 */
const validInstall = args => {
  try {
    // eslint-disable-next-line
    const pkg = require(path.resolve(process.cwd(), 'package.json'));

    if (pkg && !pkg.henri) {
      return notHenri(args);
    }
    if (!fs.existsSync(process.cwd(), 'app/views/pages')) {
      return notHenri(args);
    }

    return true;
  } catch (error) {
    return notHenri(args);
  }
};

/**
 * Abort or return false
 *
 * @param {*} args Aguments
 * @returns {boolean|void} Good or not?
 */
const notHenri = ({ fatal = false } = {}) => {
  if (fatal) {
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

/**
 * Print error and exit
 *
 * @param {*} msg The message
 * @param {boolean} [fail=false] If fail, exit with 1 instead of 0
 * @return {void}
 */
const abort = (msg, fail = false) => {
  console.log(`
  ${msg}
  `);
  process.exit(fail ? 1 : 0);
};

/**
 * Helper function to print headers (with version)
 * @return {string} the header
 */
const helpHeader = () =>
  `
  henri (${version})
  `;

module.exports = {
  abort,
  check,
  commands,
  cwd,
  helpHeader,
  validInstall,
  version,
};
