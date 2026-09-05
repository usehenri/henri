/**
 * Prefer the @usehenri/core the project depends on (so an app pins its own
 * henri version) and fall back to the one shipped with this CLI.
 *
 * @returns {string} resolved path of @usehenri/core
 */
const resolveCore = () => {
  try {
    return require.resolve('@usehenri/core', { paths: [process.cwd()] });
  } catch {
    return require.resolve('@usehenri/core');
  }
};

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
      const start = await require(resolveCore());

      await start();
      if (typeof cb === 'function') {
        cb();
      }
    } catch (error) {
       
      console.dir(error, { colors: true });
      process.exit(1);
    }
  }

  init();
};

module.exports = main;
