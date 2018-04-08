const main = ({ consoleOnly = false }, cb) => {
  process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';
  if (consoleOnly) {
    process.env.CONSOLE_ONLY = 'true';
  }

  async function init() {
    try {
      await require('@usehenri/core');
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
