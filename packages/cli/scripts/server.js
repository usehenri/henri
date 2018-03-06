const main = ({ skipView }, cb) => {
  global['_initialDelay'] = process.hrtime();

  async function init() {
    try {
      require('@usehenri/core');
      require('@usehenri/server');
      await require('@usehenri/model');
      require('@usehenri/user');
      !skipView && (await require('@usehenri/view'));
      require('@usehenri/router');
      if (typeof cb === 'function') {
        cb();
      }
    } catch (error) {
      console.dir(error, { colors: true });
      process.exit(-1);
    }
  }

  init();
};

module.exports = main;
