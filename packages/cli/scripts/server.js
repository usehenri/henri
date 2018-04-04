const main = ({ skipView }, cb) => {
  process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

  async function init() {
    try {
      await require('@usehenri/core');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.dir(error, { colors: true });
      process.exit(1);
    }
  }

  init();
};

module.exports = main;
