const BaseModule = require('./base/module');

const path = require('path');
const glob = require('glob');

/**
 * Workers management module
 *
 * @class Workers
 * @extends {BaseModule}
 */
class Workers extends BaseModule {
  /**
   * Creates an instance of Workers.
   * @memberof Workers
   */
  constructor() {
    super();

    this.reloadable = true;
    this.runlevel = 5;
    this.name = 'workers';
    this.henri = undefined;

    this.workers = {};
    this.files = [];

    this.init = this.init.bind(this);
    this.stop = this.stop.bind(this);
    this.reload = this.reload.bind(this);
    this.getFiles = this.getFiles.bind(this);
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof Workers
   */
  async init() {
    if (process.env.SKIP_WORKERS) {
      this.henri.pen.warn('workers', 'skipping workers thread');

      return this.name;
    }

    const workerPath = path.join(this.henri.cwd(), 'app/workers');

    this.files = await this.getFiles();

    this.files.map(async file => {
      // eslint-disable-next-line
      this.workers[file] = require(path.join(workerPath, file));

      if (typeof this.workers[file].start === 'function') {
        await this.workers[file].start(this.henri);
        this.henri.pen.info(
          'workers',
          this.workers[file].name || file,
          'started'
        );
      } else {
        this.henri.pen.warn(
          'workers',
          this.workers[file].name || file,
          'not started',
          'forgot to add a start function?'
        );
      }
    });

    return this.name;
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {(string|Promise|boolean)} Module name or false
   * @memberof Workers
   */
  async stop() {
    if (process.env.SKIP_WORKERS) {
      return;
    }

    return new Promise(resolve => {
      this.files.map(async file => {
        if (
          this.workers[file] &&
          typeof this.workers[file].stop === 'function'
        ) {
          try {
            await this.workers[file].stop(this.henri);
            this.henri.pen.info(
              'workers',
              this.workers[file].name || file,
              'stopped'
            );
          } catch (error) {
            this.henri.pen.error(
              'workers',
              this.workers[file].name || file,
              'failed to stop',
              error
            );
          }
        }
      });

      return resolve();
    });
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Workers
   */
  async reload() {
    if (process.env.SKIP_WORKERS) {
      this.henri.pen.warn('workers', 'workers are disabled');

      return this.name;
    }

    await this.stop();

    delete this.workers;
    this.files.map(
      file =>
        delete require.cache[path.join(this.henri.cwd(), 'app/workers', file)]
    );
    this.workers = {};
    this.files = [];

    await this.init();

    return this.name;
  }

  /**
   * Get the files from app/workers
   *
   * @returns {void}
   * @memberof Workers
   */
  async getFiles() {
    return new Promise(resolve => {
      const workerPath = path.join(this.henri.cwd(), 'app/workers');

      glob('**/*.js', { cwd: workerPath }, (err, files) => {
        resolve(files);
      });
    });
  }
}

module.exports = Workers;
