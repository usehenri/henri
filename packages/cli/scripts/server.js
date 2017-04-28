const main = args => {
  global['_initialDelay'] = process.hrtime();

  async function init() {
    try {
      require('@usehenri/config');
      require('@usehenri/log');
      require('@usehenri/server');
      require('@usehenri/user');
      await require('@usehenri/model');
      await require('@usehenri/controller');
      await require('@usehenri/view');
      require('@usehenri/router');
    } catch (error) {
      console.dir(error, { colors: true });
    }
  }

  init();
};

module.exports = main;
