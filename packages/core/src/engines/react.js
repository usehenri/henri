const path = require('path');
const utils = require('../utils');

async function check() {
  try {
    await utils.checkPackages([
      'react',
      'react-dom',
      'sass-loader',
      'raw-loader',
      'cache-loader',
      'node-sass',
    ]);
  } catch (error) {
    henri.pen.fatal('view', error);
    process.exit(1);
  }
}

check();

module.exports = require(path.join(
  process.cwd(),
  './node_modules/@usehenri/react/engine/index'
));
