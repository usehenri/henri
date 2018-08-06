const Henri = require('./henri');

const func = new Henri();

/**
 * Starts the application
 *
 * @returns {Henri} henri instance
 */
async function start() {
  await func.init();

  return func;
}

if (!module.parent) {
  func.pen.warn('boot', 'running from npm');
  start();
} else {
  func.pen.warn('boot', 'running from cli');
}

module.exports = start;
