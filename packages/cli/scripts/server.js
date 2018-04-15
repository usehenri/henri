/**
 * Main entry point for henri cli
 * @param {object} param0 if console only
 * @param {function} cb a callback (we use this for console)
 * @returns {void}
 */
const main = ({ consoleOnly = false }, cb) => {
  if (consoleOnly) {
    process.env.CONSOLE_ONLY = 'true';
  }

  /**
   *  Init
   * @returns {void}
   */
  async function init() {
    try {
      // eslint-disable-next-line global-require
      const start = await require('@usehenri/core');

      await start();
      if (typeof cb === 'function') {
        cb();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.dir(error, { colors: true });
      process.exit(1);
    }
  }

  init();
};

module.exports = main;
