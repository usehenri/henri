const BaseModule = require('./base/module');
const chalk = require('chalk');
const stringWidth = require('string-width');
const util = require('util');
const { getColor, stack } = require('./utils');
const { currentRequestId } = require('./base/request-id');
const { stamp, url: codeUrl } = require('./base/errors');
const { filterParameters, redact } = require('./base/redact');
const { recorder } = require('./base/runtime');

/**
 * Write stuff in the console...
 * @module Pen
 * @extends BaseModule
 */
class Pen extends BaseModule {
  /**
   * Creates an instance of Pen.
   * @param {boolean} [inTesting=true] Are we testing?
   * @param {Henri} [henri=null] The henri instance (for the banner and notify)
   * @memberof Pen
   */
  constructor(inTesting = true, henri = null) {
    super();
    this.henri = henri;
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
   * Logs the error (with its stack) and returns an Error the caller should
   * throw: `throw pen.fatal('view', 'unknown renderer')`.
   *
   * A failure henri raises on its own behalf names itself: the last argument
   * is one of the codes of `error-codes.json`, printed before the summary and
   * stamped on the Error that comes back (see base/errors.js).
   *
   * @param {!string} [name='fatal'] name of the module
   * @param {(!string|!Error)} [summary='unknown error']  snall summary
   * @param {?string} [full=null]  long description (multi-line)
   * @param {?object} [obj=null]  object to be displayed nicely
   * @param {?string} [code=null]  the henri error code of this failure
   * @returns {Error} the error to throw
   * @memberof Pen
   */
  fatal(
    name = 'fatal',
    summary = 'unknown error',
    full = null,
    obj = null,
    code = null
  ) {
    const link = code ? codeUrl(code, this.henri || global.henri) : null;

    this.line(2);
    this.error(name, ...(code ? [chalk.bold(code)] : []), summary);
    link && this.error(name, chalk.grey(link));
    this.line(1);
    if (summary instanceof Error) {
      (summary.stack || '').split('\n').forEach((line, index) => {
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
        util.inspect(this.redact(obj), {
          colors: true,
          depth: 2,
          maxArrayLength: 8,
        })
      );
      this.line(1);
      this.error(name, 'See error stack before the object, up there!');
    }
    this.line(2);

    if (summary instanceof Error) {
      return code ? stamp(summary, code) : summary;
    }

    const message = full ? `${summary}\n${full}` : String(summary);
    const error = new Error(message);

    error.module = name;

    return code ? stamp(error, code) : error;
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
   * A copy of a value with the filtered parameters masked
   * (`config.filterParameters`, `password`, `token`, `secret` and
   * `authorization` by default), and with the fields the models marked
   * personal masked by name (`henri.privacy`, see `base/privacy.js`)
   *
   * @param {*} value anything
   * @returns {*} the redacted copy
   * @memberof Pen
   */
  redact(value) {
    const inst = this.henri || global.henri;

    return redact(value, filterParameters(inst && inst.config), {
      keys: (inst && inst.privacy && inst.privacy.keys) || undefined,
    });
  }

  /**
   * One argument of a log line: objects are inspected (redacted first),
   * everything else is printed as is
   *
   * @param {*} value the argument
   * @returns {*} something `join()` can print
   * @memberof Pen
   */
  format(value) {
    if (value === null || typeof value !== 'object' || value instanceof Error) {
      return value;
    }

    return util.inspect(this.redact(value), {
      breakLength: Infinity,
      colors: false,
      depth: 3,
    });
  }

  /**
   * Internal formatting method
   * Lines written while a request is handled carry its id (`req.id`).
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
    const id = currentRequestId();
    const tag = id
      ? chalk.grey(`[${id.length > 12 ? id.slice(0, 8) : id}] `)
      : '';
    const parts = args.map((arg) => this.format(arg));
    const fullMsg = `${title} ${tag}${parts.join(sep)} ${chalk['grey'](
      this.time()
    )}`;

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
    // Recorded before anything is printed, and whether or not it is: the
    // runtime tools of `henri mcp` read the same lines a terminal shows
    // (see base/runtime.js; production keeps none)
    const record = recorder(this.henri || global.henri);

    record && record.log(name, level, args);

    if (!this.notTest && this.inTesting) {
      return;
    }
    if (!this.initialized) {
      const inst = this.henri || global.henri;

      this.initialized = true;
      this.line(1);
      if (inst) {
        this.info(
          'henri',
          inst.release,
          inst.isProduction ? chalk.green('production') : chalk.red('dev')
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
   * Development-time notification (printed to the console)
   *
   * @param {string} title title of notification
   * @param {string} message message displayed
   * @returns {({title: string, message: string}|boolean)} For testing or status
   * @memberof Pen
   */

  notify(title = null, message = null) {
    const inst = this.henri || global.henri;

    if (!title && !message) {
      return false;
    }
    if (inst && inst.isDev) {
      this.warn('notify', title, message);

      return { message, title };
    }

    return false;
  }
}

module.exports = Pen;
