const main = ({ skipView }, cb) => {
  global['_initialDelay'] = process.hrtime();

  async function init() {
    try {
      require('@usehenri/config');
      require('@usehenri/server');
      require('@usehenri/user');
      await require('@usehenri/model');
      await require('@usehenri/controller');
      !skipView && (await require('@usehenri/view'));
      require('@usehenri/router');
      if (typeof cb === 'function') {
        cb();
      }
    } catch (error) {
      console.dir(error, { colors: true });
    }
  }

  init();
};

module.exports = main;
