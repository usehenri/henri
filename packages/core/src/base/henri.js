const fs = require('fs');
const path = require('path');

const VERSION = require('../../package.json').version;

/** Package names of this repository: tests boot the demo application */
const MONOREPO = ['henri-monorepo', '@usehenri/demo'];

/**
 * Are we running inside the henri monorepo (or its demo application)?
 * Core's own tests chdir into packages/demo; an application running its
 * tests with NODE_ENV=test must stay where it is.
 *
 * @returns {boolean} inside the monorepo or not
 */
function inMonorepo() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    );

    return MONOREPO.includes(pkg.name);
  } catch (error) {
    return false;
  }
}

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
      env: { NODE_ENV, CONSOLE_ONLY = false, HENRI_TESTING = false },
      arch,
      platform,
    } = process;

    this.env = NODE_ENV;
    this.isProduction = NODE_ENV === 'production';
    this.isDev = NODE_ENV !== 'production' && NODE_ENV !== 'test';
    this.isTest = NODE_ENV === 'test';
    this.isTesting = HENRI_TESTING || false;
    this.consoleOnly = CONSOLE_ONLY || false;

    this.settings = {
      arch: this.isTest ? 'x64' : arch,
      package: this.isTest ? '0.42.0' : VERSION,
      platform: this.isTest ? 'linux' : platform,
    };

    Object.freeze(this.settings);

    this.release = this.settings.package;
    this.runlevel = runlevel;

    if (this.isTesting) {
      this.runlevel = 7;
    }

    this.prefix = this.isTest && inMonorepo() ? './packages/demo' : cwd;

    this.cwd = () => process.cwd();

    /* istanbul ignore next */
    if (!this.isTest) {
      process.on('unhandledRejection', (reason, prom) => {
        const error = toError(reason);
        const hint = promiseMsgs(error.message);

        if (hint) {
          this.pen.info('debug', hint);
        }

        this.pen.fatal('promise', error, null, prom);
      });
    }
  }
}

/**
 * Normalize an unhandled rejection reason into an Error
 * Promises can be rejected with anything (strings, objects, undefined...)
 *
 * @param {any} reason the rejection reason
 * @returns {Error} an error
 */
const toError = (reason) => {
  if (reason instanceof Error) {
    return reason;
  }

  if (typeof reason === 'string') {
    return new Error(reason);
  }

  let message;

  try {
    message = JSON.stringify(reason);
  } catch (error) {
    message = String(reason);
  }

  return new Error(`Promise rejected with a non-error value: ${message}`);
};

const promiseMsgs = (msg) => {
  if (
    msg ===
    'Transaction numbers are only allowed on storage engines that support document-level locking'
  ) {
    return 'You should add \'"retryWrites": false\' to your store adapter option (mongodb)';
  }

  return null;
};

module.exports = HenriBase;
