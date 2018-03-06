const BaseModuleClass = require('./base/module');
const henri = require('./henri');

const winston = require('winston');
const chalk = require('chalk');
const path = require('path');
const util = require('util');
const stringWidth = require('string-width');
const moment = require('moment');
const inquirer = require('inquirer');
const notifier = require('node-notifier');

class Log extends BaseModuleClass {
  constructor({ customWidth = null } = {}) {
    super();
    this.name = 'log';
    this.reloadable = false;
    this.since = Date.now();
    this.customWidth = customWidth;
    this.winston = new winston.Logger();
    this._time = process.uptime();
    this._timeSkipped = 0;
    this._inspections = [];
    this.setup();
    this.file = this.file.bind(this);
    this.time = this.time.bind(this);
    this.setup = this.setup.bind(this);
    this.error = this.error.bind(this);
    this.warn = this.warn.bind(this);
    this.info = this.info.bind(this);
    this.inspect = this.inspect.bind(this);
    this.verbose = this.verbose.bind(this);
    this.debug = this.debug.bind(this);
    this.silly = this.silly.bind(this);
    this.output = this.output.bind(this);
    return this;
  }

  setup() {
    this.winston.add(winston.transports.Console, {
      colorize: true,
      customWidth: this.customWidth,
      formatter: options => {
        const { dateString, fullMsg } = this.output(options);

        let space =
          // @ts-ignore
          (this.customWidth || process.stdout.columns) -
          stringWidth(fullMsg) -
          stringWidth(dateString);
        /* istanbul ignore if */
        if (space <= 0) {
          space = 10;
        }
        return `${fullMsg}${' '.repeat(space)}${dateString}`;
      },
    });
    this.file();
  }

  file() {
    const { config } = henri;
    /* istanbul ignore next */
    if (config.has('log') && typeof config.get('log') === 'string') {
      // eslint-disable-next-line no-console
      !henri.isTest && console.log('');
      !henri.isTest &&
        this.winston.info(
          `logger initialized. also logging to ${config.get('log')}`
        );
      this.winston.add(winston.transports.File, {
        filename: path.resolve(process.cwd(), 'logs', `${config.get('log')}`),
      });
    } else {
      this.winston.warn(
        'no file set in configuration file: logging to console only'
      );
    }
  }

  error(...args) {
    this.winston.error(...args);
  }

  warn(...args) {
    this.winston.warn(...args);
  }

  info(...args) {
    this.winston.info(...args);
  }

  verbose(...args) {
    this.winston.verbose(...args);
  }

  debug(...args) {
    this.winston.debug(...args);
  }

  silly(...args) {
    this.winston.silly(...args);
  }

  inspect(
    obj,
    doNotParse = false,
    msg = 'Something was added to inspection buffer',
    level = 'info'
  ) {
    if (henri.isProduction) {
      return;
    }

    let data;

    if (doNotParse) {
      data = obj;
    } else {
      data = util.inspect(obj, {
        depth: 8,
        colors: true,
        maxArrayLength: 8,
      });
    }

    const site = henri.utils.stack()[2];
    const inspection = {
      doNotParse,
      msg,
      level,
      date: new Date(),
      delta: process.uptime(),
      data,
      lines: doNotParse ? data.length : data.split('\n').length,
      stack: site,
      funcName: site.getFunctionName() || 'anonymous',
      filename: site.getFileName(),
      filePos: site.getLineNumber(),
    };
    this._inspections.push(inspection);
    let size =
      this._inspections.length > 1 ? ` [${this._inspections.length}]` : '';
    // @ts-ignore
    this[level](`${msg}${size}; Ctrl+I for infos...`);
  }
  // eslint-disable-next-line complexity
  getInspection() {
    if (this._inspections.length < 1) {
      return this.warn('inspection buffer is empty. nothing to show.');
    }
    if (this._inspections.length > 1) {
      henri.clearConsole();
      process.stdin.pause();
      const opts = {
        type: 'list',
        message: 'Choose from entries below',
        name: 'key',
        choices: this._inspections.map((v, i) => {
          return {
            name: `${v.msg} (${v.funcName}) => ${moment(v.date).fromNow()}`,
            value: i,
          };
        }),
      };
      opts.choices.push(new inquirer.Separator());
      // @ts-ignore
      opts.choices.push({ name: 'Clear all/empty list', value: 'clear' });

      inquirer
        .prompt([opts])
        .then(answer => {
          if (answer.key === 'clear') {
            this._inspections = [];
          } else {
            const line = this._inspections.splice(answer.key, 1);
            this.showInspection(line.pop());
          }
          process.stdin.resume();
          // @ts-ignore
          process.stdin && process.stdin.setRawMode(true);
        })
        .catch(err => {
          this.error('An error occurred while parsing the choices...', err);
          process.stdin.resume();
          // @ts-ignore
          process.stdin.setRawMode(true);
        });
    } else {
      const item = this._inspections.pop();
      this.showInspection(item);
    }
  }
  showInspection(data) {
    henri.clearConsole();
    console.log(chalk[getColor(data.level)](`> ${data.msg}`));
    console.log(
      '  ·',
      chalk.white(`${data.lines} ${data.doNotParse ? 'items' : 'lines'},`),
      chalk.green(`${moment(data.date).fromNow()}`)
    );
    if (data.doNotParse) {
      this.line();
      data.data.forEach(v => typeof v === 'function' && v());
      this.line(19);
    } else {
      console.log(
        '  ·',
        chalk.green(
          `${data.stack.getFileName()}:${data.stack.getLineNumber()}`
        ),
        '=>',
        chalk.blue(data.stack.getFunctionName() || 'anonymous')
      );

      this.line();
      console.log(data.data);
    }
    let ending =
      this._inspections.length > 0
        ? `${this._inspections.length} to go. Ctrl+I for more...`
        : 'Done!';
    console.log('>', chalk.green(ending));
    this.line();
  }

  getColor(color) {
    return getColor(color);
  }

  fatalError(msg) {
    // eslint-disable-next-line no-console
    console.log('');
    const lines = msg.split('\n');
    for (let line of lines) {
      /* istanbul ignore next */
      if (line.length > 2) {
        this.error(line);
      }
    }
    // eslint-disable-next-line no-console
    console.log('');
    throw new Error(msg);
  }

  /* istanbul ignore next */
  notify(title = 'No title', message = 'No message') {
    if (henri.isDev) {
      return notifier.notify({
        title,
        message,
        icon: path.join(__dirname, 'henri.png'),
      });
    }
  }

  /* istanbul ignore next */
  space() {
    // eslint-disable-next-line no-console
    return console.log(' ');
  }

  /* istanbul ignore next */
  line(times = 1) {
    // eslint-disable-next-line no-console
    times > 0 && console.log('\n') && this.line(times--);
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

  output(options) {
    const color = getColor(options.level);
    const dateString = chalk.grey(new Date().toLocaleTimeString());
    const title = chalk[color].inverse(` ${options.level.toUpperCase()} `);
    /* istanbul ignore next */
    const message = chalk[color](options.message ? options.message : '');
    /* istanbul ignore next */
    const meta = chalk[color](
      options.meta && Object.keys(options.meta).length
        ? '\n\t' + JSON.stringify(options.meta, null, 2)
        : ''
    );
    /* istanbul ignore next */
    const fullMsg = `${title} ${message || meta} ${chalk['grey'](this.time())}`;

    return { dateString, fullMsg };
  }
}

function getColor(level) {
  const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    verbose: 'white',
    debug: 'blue',
    silly: 'magenta',
  };
  return colors[level.toLowerCase()] || 'red';
}

module.exports = Log;
