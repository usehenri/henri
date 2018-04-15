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

module.exports = start;
