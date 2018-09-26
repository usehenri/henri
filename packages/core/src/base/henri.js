const VERSION = require('../../package.json').version;

/**
 * The base of Henri
 *
 * @class HenriBase
 */
class HenriBase {
  /**
   * Creates an instance of HenriBase.
   *
   * @param {any} {} [{ cwd = '.', runlevel = 6 }={}] Options for henri initialization
   * @memberof HenriBase
   */
  constructor({ cwd = '.', runlevel = 6 } = {}) {
    const {
      env: { NODE_ENV, CONSOLE_ONLY = false },
      arch,
      platform,
    } = process;

    this.env = NODE_ENV;
    this.isProduction = NODE_ENV === 'production';
    this.isDev = NODE_ENV !== 'production' && NODE_ENV !== 'test';
    this.isTest = NODE_ENV === 'test';
    this.consoleOnly = CONSOLE_ONLY || false;

    this.settings = {
      arch: this.isTest ? 'x64' : arch,
      package: this.isTest ? '0.42.0' : VERSION,
      platform: this.isTest ? 'linux' : platform,
    };

    Object.freeze(this.settings);

    this.release = this.settings.package;
    this.runlevel = runlevel;
    this.prefix = this.isTest ? './packages/demo' : cwd;

    this.cwd = () => process.cwd();

    /* istanbul ignore next */
    if (!this.isTest) {
      process.on('unhandledRejection', (reason, prom) =>
        this.pen.fatal('promise', reason, null, prom)
      );
    }
  }
}

module.exports = HenriBase;
