const utils = require('../utils');

/**
 * Check defines the required packages and throws if they are not there
 * It is called when you use this engine
 *
 * @returns {void}
 */
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

module.exports = require(utils.resolveFrom(
  '@usehenri/react/engine/index',
  process.cwd()
));
