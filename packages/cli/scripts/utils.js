const fs = require('fs-extra');
const path = require('path');

const { version, commands } = require('../package.json');

const cwd = process.cwd();

const check = file => fs.existsSync(path.join(cwd, file));

module.exports = { version, commands, cwd, check };
