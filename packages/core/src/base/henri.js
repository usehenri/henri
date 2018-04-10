class HenriBase {
  constructor({ cwd = '.', runlevel = 6 } = {}) {
    process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

    const { env: { NODE_ENV, CONSOLE_ONLY = false }, arch, platform } = process;

    this.env = NODE_ENV;
    this.isProduction = NODE_ENV === 'production';
    this.isDev = NODE_ENV !== 'production' && NODE_ENV !== 'test';
    this.isTest = NODE_ENV === 'test';
    this.consoleOnly = CONSOLE_ONLY || false;

    this.settings = {
      package: this.isTest ? '0.42.0' : require('../../package.json').version,
      arch: this.isTest ? 'x64' : arch,
      platform: this.isTest ? 'linux' : platform,
    };

    Object.freeze(this.settings);

    this.release = this.settings.package;
    this.runlevel = runlevel;
    this.prefix = this.isTest ? './packages/demo' : cwd;

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
