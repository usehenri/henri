const main = ({ skipView }, cb) => {
  global['_initialDelay'] = process.hrtime();
  process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

  async function init() {
    try {
      await require('@usehenri/core')();
      require('@usehenri/user');
      !skipView && (await require('@usehenri/view'));
      require('@usehenri/router');
      if (typeof cb === 'function') {
        cb();
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.dir(error, { colors: true });
      process.exit(-1);
    }
  }

  init();
};

module.exports = main;
