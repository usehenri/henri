const BaseModule = require('./base/module');
const chalk = require('chalk');
const stringWidth = require('string-width');
const stack = require('callsite');
const util = require('util');
const notifier = require('node-notifier');
const path = require('path');
const { getColor } = require('./utils');

/**
 * Pen
 *
 * write stuff in the console...
 */
class Pen extends BaseModule {
  constructor(inTesting = true) {
    super();
    this.notTest = process.env.NODE_ENV !== 'test';
    this.longest = 12;
    this.buffer = [];
    this._time = process.uptime();
    this._timeSkipped = 0;
    this.initialized = false;
    this.inTesting = inTesting;

    this.time = this.time.bind(this);
    this.error = this.error.bind(this);
    this.warn = this.warn.bind(this);
    this.info = this.info.bind(this);
    this.verbose = this.verbose.bind(this);
    this.debug = this.debug.bind(this);
    this.silly = this.silly.bind(this);
    this.output = this.output.bind(this);
    this.dequeue = this.dequeue.bind(this);
  }

  error(name, ...args) {
    this.shout(name, 'error', ...args);
  }

  warn(name, ...args) {
    this.shout(name, 'warn', ...args);
  }

  info(name, ...args) {
    this.shout(name, 'info', ...args);
  }

  verbose(name, ...args) {
    this.shout(name, 'verbose', ...args);
  }

  debug(name, ...args) {
    this.shout(name, 'debug', ...args);
  }

  silly(name, ...args) {
    this.shout(name, 'silly', ...args);
  }

  fatal(name, summary = 'unknown error', full = null, obj = null) {
    this.line(2);
    this.error(name, summary);
    this.line(1);
    if (summary instanceof Error) {
      summary.stack.split('\n').forEach((v, i) => {
        if (i > 0 && v.indexOf('(module.js:') < 0) {
          this.error(name, v);
        }
      });
    } else {
      stack().forEach((site, i) => {
        const file = site.getFileName();
        if (i > 0 && file !== 'module.js') {
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
          depth: 2,
          colors: true,
          maxArrayLength: 8,
        })
      );
      this.line(1);
      this.error(name, 'See error stack before the object, up there!');
    }
    this.line(2);
    this.inTesting && process.exit();
    return true;
  }

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

  line(times = 1) {
    this.notTest &&
      times > 0 &&
      // eslint-disable-next-line no-console
      console.log(' ') &&
      times-- &&
      this.line(times);
  }

  output(name, level, ...args) {
    const dateString = chalk.grey(new Date().toLocaleTimeString());
    const title = `${chalk[getColor(level)].bold(name)} ${chalk['grey'].bold(
      '✏'
    )} `;
    const sep = ` ${chalk['grey'].bold('=>')} `;
    const fullMsg = `${title} ${args.join(sep)} ${chalk['grey'](this.time())}`;

    return { dateString, fullMsg };
  }

  shout(name, level, ...args) {
    if (!this.notTest && this.inTesting) {
      return;
    }
    if (!this.initialized) {
      this.initialized = true;
      this.line(1);
      this.info(
        'henri',
        henri.release,
        henri.isProduction ? chalk.green('production') : chalk.red('dev')
      );
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

  queue(data) {
    this.buffer.push(data);
  }

  dequeue() {
    const data = this.buffer.splice(0);
    if (data.length > 0) {
      // eslint-disable-next-line no-console
      data.map(v => console.log(v));
    }
  }

  notify(title = 'No title', message = 'No message') {
    if (henri.isDev) {
      return notifier.notify({
        title,
        message,
        icon: path.join(__dirname, 'henri.png'),
      });
    }
  }
}

module.exports = Pen;
