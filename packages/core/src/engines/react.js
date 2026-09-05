const utils = require('../utils');

/**
 * Check that the packages the React (Next.js) engine needs are installed in
 * the application. The engine itself validates optional ones (ex: sass).
 * It is called when you use this engine
 *
 * @returns {void}
 */
async function check() {
  try {
    await utils.checkPackages(['react', 'react-dom']);
  } catch (error) {
    henri.pen.fatal('view', error);
    process.exit(1);
  }
}

check();

module.exports = require(
  utils.resolveFrom('@usehenri/react/engine/index', process.cwd())
);
