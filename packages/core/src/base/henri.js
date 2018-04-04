class HenriBase {
  constructor({ cwd = '.', runlevel = 6 } = {}) {
    process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

    const { env: { NODE_ENV }, arch, platform } = process;

    this.env = NODE_ENV;
    this.isProduction = NODE_ENV === 'production';
    this.isDev = NODE_ENV !== 'production' && NODE_ENV !== 'test';
    this.isTest = NODE_ENV === 'test';

    this.settings = {
      package: require('../../package.json').version,
      arch,
      platform,
    };

    Object.freeze(this.settings);

    this.release = this.settings.package;
    this.runlevel = runlevel;
    this.prefix = cwd;

    this.cwd = () => process.cwd();

    /* istanbul ignore next */
    if (!this.isTest) {
      process.on('unhandledRejection', (reason, p) =>
        this.pen.fatal('promise', reason, null, p)
      );
    }
  }
}

module.exports = HenriBase;
