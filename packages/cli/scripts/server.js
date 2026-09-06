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
 *
 * A boot failure is thrown, not printed here: `henri <command> failed: ...`
 * and `--json` are the command line's own envelope (index.js), and an error
 * that names one of the codes -- an invalid configuration, for one -- keeps
 * its message, its hint and its exit code through it.
 *
 * @param {object} param0 if console only
 * @param {function} cb a callback (we use this for console)
 * @returns {Promise<void>} resolves once the application is up
 * @throws whatever the boot threw
 */
const main = async ({ consoleOnly = false }, cb) => {
  if (consoleOnly) {
    process.env.CONSOLE_ONLY = 'true';
  }

  const start = await require(resolveCore());

  await start();

  if (typeof cb === 'function') {
    cb();
  }
};

module.exports = main;
