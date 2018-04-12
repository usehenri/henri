const Henri = require('./henri');

const func = new Henri();

/**
 * Starts the application
 *
 * @returns {Promise<void>} none
 */
async function start() {
  await func.init();
}

start();
