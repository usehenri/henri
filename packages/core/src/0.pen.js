const BaseModule = require('./base/module');
const chalk = require('chalk');
const stringWidth = require('string-width');
const stack = require('callsite');
const util = require('util');
const notifier = require('node-notifier');
const path = require('path');
const { getColor } = require('./utils');

/**
 * Write stuff in the console...
 * @module Pen
 * @extends BaseModule
 */
class Pen extends BaseModule {
  /**
   * Creates an instance of Pen.
   * @param {boolean} [inTesting=true] Are we testing?
   * @memberof Pen
   */
  constructor(inTesting = true) {
    super();
    this.notTest = process.env.NODE_ENV !== 'test';
    this.longest = 12;
    this.buffer = [];
    this._time =
      process.env.NODE_ENV === 'test' ? '42424242' : process.uptime();
    this._timeSkipped = 0;
    this.initialized = false;
    this.inTesting = inTesting;
  }

  /**
   * Error display (console-only)
   *
   * @param {string} name name of the module
   * @param {...any} args extra arguments
   * @returns {void}
   * @memberof Pen
   */
  error(name, ...args) {
    this.shout(name, 'error', ...args);
  }

  /**
   * Warning display (console-only)
   *
   * @param {string} name name of the module
   * @param {...any} args extra arguments
   * @returns {void}
   * @memberof Pen
   */
  warn(name, ...args) {
    this.shout(name, 'warn', ...args);
  }

  /**
   * Information display (console-only)
   *
   * @param {string} name name of the module
   * @param {...any} args extra arguments
   * @returns {void}
   * @memberof Pen
   */
  info(name, ...args) {
    this.shout(name, 'info', ...args);
  }

  /**
   * Verbose-level display (console-only)
   *
   * @param {string} name name of the module
   * @param {...any} args extra arguments
   * @returns {void}
   * @memberof Pen
   */
  verbose(name, ...args) {
    this.shout(name, 'verbose', ...args);
  }

  /**
   * Debug display (console-only)
   *
   * @param {string} name name of the module
   * @param {...any} args extra arguments
   * @returns {void}
   * @memberof Pen
   */
  debug(name, ...args) {
    this.shout(name, 'debug', ...args);
  }

  /**
   * Silly display (console-only)
   *
   * @param {string} name name of the module
   * @param {...any} args extra arguments
   * @returns {void}
   * @memberof Pen
   */
  silly(name, ...args) {
    this.shout(name, 'silly', ...args);
  }

  /**
   * Fatal error handling
   *
   * @param {!string} [name='fatal'] name of the module
   * @param {(!string|!Error)} [summary='unknown error']  snall summary
   * @param {?string} [full=null]  long description (multi-line)
   * @param {?object} [obj=null]  object to be displayed nicely
   * @returns {void}
   * @memberof Pen
   */
  fatal(name = 'fatal', summary = 'unknown error', full = null, obj = null) {
    this.line(2);
    this.error(name, summary);
    this.line(1);
    if (summary instanceof Error) {
      summary.stack.split('\n').forEach((line, index) => {
        if (index > 0 && line.indexOf('(module.js:') < 0) {
          this.error(name, line);
        }
      });
    } else {
      stack().forEach((site, index) => {
        const file = site.getFileName();

        if (index > 0 && file !== 'module.js') {
          const func = site.getFunctionName()
            ? chalk.green.bold(site.getFunctionName())
            : chalk.grey('<anonymous>');

          this.error(
            name,
            `fatal`,
            func,
            chalk.grey(`${site.getFileName()}:${site.getLineNumber()}`)
          );
        }
      });
    }
    if (full) {
      this.line(1);
      const lines = full.split('\n');

      for (let line of lines) {
        if (line.length > 2) {
          this.error(name, line);
        }
      }
    }
    if (obj && !(summary instanceof Error)) {
      this.line(1);
      // eslint-disable-next-line no-console
      console.log(
        util.inspect(obj, {
          colors: true,
          depth: 2,
          maxArrayLength: 8,
        })
      );
      this.line(1);
      this.error(name, 'See error stack before the object, up there!');
    }
    this.line(2);
    // REMOVED: this.inTesting && process.exit();

    return true;
  }

  /**
   * Record time and returns ms since last call (if > 6 or skipped 3x)
   *
   * @returns {string} time since last call (ex: 3ms)
   * @memberof Pen
   */
  time() {
    const delta = Math.round((process.uptime() - this._time) * 1000);

    if (delta < 6 && this._timeSkipped < 3) {
      this._timeSkipped++;

      return '';
    }
    this._timeSkipped = 0;
    this._time = process.uptime();

    return `+${delta}ms`;
  }

  /**
   * Prints new lines to console for spacing
   *
   * @param {number} [times=1]  Number of new lines required
   * @returns {void} Recursive if needed
   * @memberof Pen
   */
  line(times = 1) {
    this.notTest &&
      times > 0 &&
      // eslint-disable-next-line no-console
      console.log(' ') &&
      times-- &&
      this.line(times);
  }

  /**
   * Internal formatting method
   *
   * @private
   * @param {string} name Module name
   * @param {string} level The level (error, info, etc.)
   * @param {...any} args Any leftoever arguments (will be joined)
   * @returns {{ dateString: string, fullMsg: string}} Formatted message
   * @memberof Pen
   */
  output(name, level, ...args) {
    const dateString = chalk.grey(new Date().toLocaleTimeString());
    const title = `${chalk[getColor(level)].bold(name)} ${chalk['grey'].bold(
      '✏'
    )} `;
    const sep = ` ${chalk['grey'].bold('=>')} `;
    const fullMsg = `${title} ${args.join(sep)} ${chalk['grey'](this.time())}`;

    return { dateString, fullMsg };
  }

  /**
   * Internal console formatting method
   *
   * @private
   * @param {string} name Module name
   * @param {string} level The level (error, info, etc.)
   * @param {...any} args Any leftoever arguments (will be joined)
   * @returns {{data: string, space: number}} For testing purposes
   * @memberof Pen
   */
  shout(name, level, ...args) {
    if (!this.notTest && this.inTesting) {
      return;
    }
    if (!this.initialized) {
      this.initialized = true;
      this.line(1);
      if (typeof global['henri'] !== 'undefined') {
        this.info(
          'henri',
          henri.release,
          henri.isProduction ? chalk.green('production') : chalk.red('dev')
        );
      }
      this.line(1);
    }
    if (this.longest < name.length) {
      this.longest = name.length;
    }
    const { dateString, fullMsg } = this.output(
      name.padStart(this.longest, ' '),
      level,
      ...args
    );

    let space =
      (this.customWidth || process.stdout.columns) -
      stringWidth(fullMsg) -
      stringWidth(dateString);

    if (space <= 0) {
      space = 10;
    }
    const data = `${fullMsg}${' '.repeat(space)}${dateString}`;

    // eslint-disable-next-line no-console
    this.inTesting && console.log(data);

    return { data, space };
  }

  /**
   * Desktop notification
   *
   * @param {string} title title of notification
   * @param {string} message message displayed
   * @returns {({title: string, message: string}|boolean)} For testing or status
   * @memberof Pen
   */
  // eslint-disable-next-line
  notify(title = null, message = null) {
    if (!title && !message) {
      return false;
    }
    if (henri && henri.isDev) {
      notifier.notify({
        icon: path.join(__dirname, 'henri.png'),
        message,
        title,
      });

      return { message, title };
    }

    return false;
  }
}

module.exports = Pen;
