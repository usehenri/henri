const { stack } = require('./utils');
const BaseModule = require('./base/module');
const bounce = require('bounce');

/**
 * Modules handler
 *
 * @class Modules
 */
class Modules {
  /**
   * Creates an instance of Modules.
   * @param {Henri} henri Henri instance
   * @memberof Modules
   */
  constructor(henri) {
    this.henri = henri;
    this.modules = new Map();

    this.store = [[], [], [], [], [], [], []];
    this.order = [[], [], [], [], [], [], []];
    this.reloadable = [[], [], [], [], [], [], []];
    this.stopOrder = [];
    this.initialized = false;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.add = this.add.bind(this);
  }

  /**
   *  Adds a module to henri, not initialized yet
   *
   * @param {function} func Module constructor to be added
   * @returns {boolean} Result
   * @memberof Modules
   */
  add(func) {
    const { pen } = this.henri;

    if (this.henri.consoleOnly && func.consoleOnly) {
      return false;
    }

    const info = stack()[1];

    const obj = validate(func, info, pen);

    if (!obj) {
      return false;
    }

    obj.henri = this.henri;

    const existing =
      this.modules.get(obj.name) || typeof this.henri[obj.name] !== 'undefined';

    if (existing) {
      return crashOnDuplicateModule(existing, obj, info, pen);
    }

    this.modules.set(obj.name, {
      filename: info.getFileName(),
      func: info.getFunctionName(),
      line: info.getLineNumber(),
      time: Date.now(),
    });

    this.store[obj.runlevel].push(obj);

    return true;
  }

  /**
   * Initialize all the loaded modules
   * this method calls all then modules init() methods, in their runlevel order
   *
   * @async
   * @throws
   * @returns {boolean} results
   * @memberof Modules
   */
  async init() {
    const { pen } = this.henri;

    this.store.splice(parseInt(this.henri.runlevel) + 1);

    // REMOVED: this.order = this.store.reduce((a, b) => a.concat(b));
    this.stopOrder = this.store.reduceRight((prev, next) => prev.concat(next));

    if (this.stopOrder.length < 1) {
      pen.fatal('modules', 'init', 'no modules loaded before init');
    }

    let count = 0;
    let size = this.stopOrder.length;

    for (let level of this.store) {
      if (level.length > 0) {
        let runlevel = 0;

        for (let obj of level) {
          runlevel = obj.runlevel;
          this.order[obj.runlevel].push(obj.init);
          this.henri[obj.name] = obj;
          if (obj.reloadable && typeof obj.reload === 'function') {
            this.reloadable[obj.runlevel].push(obj.reload);
          }
        }
        let result;

        try {
          result = await Promise.all(
            this.order[runlevel].map(
              func => typeof func === 'function' && func()
            )
          );
        } catch (error) {
          bounce.rethrow(error, 'system');

          return false;
        }

        for (let name of result) {
          count++;
          pen.info(`modules`, name, `loaded`, `${count}/${size}`);
        }
      }
    }

    pen.info('modules', 'loading', '...done!');

    this.initialized = true;

    return true;
  }

  /**
   * Reloads all the modules
   *
   * @async
   * @throws
   * @returns {boolean} reload status
   * @memberof Modules
   */
  async reload() {
    const { pen } = this.henri;

    if (!this.initialized) {
      pen.warn('modules', 'cannot reload when not initialized');

      return false;
    }

    for (let id of Object.keys(require.cache)) {
      // istanbul ignore next
      delete require.cache[id];
    }

    let count = 0;
    const max = this.reloadable.reduce((prev, next) => prev.concat(next));

    for (let level of this.reloadable) {
      if (level.length > 0) {
        let result;

        try {
          result = await Promise.all(
            level.map(func => typeof func === 'function' && func())
          );
        } catch (error) {
          bounce.rethrow(error, 'system');

          return false;
        }

        for (let name of result) {
          count++;
          pen.info(`modules`, name, `reloaded`, `${count}/${max.length}`);
        }
      }
    }

    return true;
  }

  /**
   * Stops the modules
   *
   * @async
   * @returns {boolean} result
   * @memberof Modules
   */
  async stop() {
    const { pen } = this.henri;

    for (let mod of this.stopOrder) {
      this.henri[mod.name] = mod;
      if (typeof mod.stop === 'function') {
        try {
          if (await mod.stop()) {
            pen.info(`modules`, mod.name, `stopped`);
          }
        } catch (error) {
          bounce.rethrow(error, 'system');

          return false;
        }
      }
    }

    return true;
  }
}

/**
 * Validate new modules
 *
 * @throws Error
 * @param {BaseModule} obj a module
 * @param {stack} info the stack information
 * @returns {BaseModule} the valid module
 */
function validate(obj, info) {
  const file = info.getFileName();
  const line = info.getLineNumber();
  const func = info.getFunctionName();
  const label = `${file}:${line} :: ${func}`;

  if (!(obj instanceof BaseModule)) {
    throw new Error(`modules => ${label} is not extending BaseModule`);
  }

  if (typeof obj.runlevel !== 'number') {
    throw new Error(`modules => ${label} runlevel is not defined`);
  }

  if (typeof obj.name !== 'string') {
    throw new Error(`modules => ${label} name is not a string`);
  }

  if (obj.runlevel < 0 || obj.runlevel > 6) {
    throw new Error(`modules => ${obj.name} runlevel is out of range`);
  }

  if (typeof obj.init !== 'function') {
    throw new Error(`modules => ${obj.name} init is not a function`);
  }

  if (obj.reloadable) {
    if (typeof obj.reload !== 'function') {
      throw new Error(
        `modules => ${obj.name} has no valid reload function. Is it reloadable?`
      );
    }
  }

  return obj;
}

/**
 * Crash the application on duplicate modules (overlapping)
 *
 * @param {BaseModule} existing the existing module
 * @param {BaseModule} func the new module that collides
 * @param {stack} info the new module stack
 * @param {pen} pen the pen module (this.henri.pen)
 * @returns {void}
 */
function crashOnDuplicateModule(existing, func, info, pen) {
  pen.error(
    'modules',
    'duplicate',
    func.name,
    `original`,
    `${existing.filename}:${existing.line}`
  );
  pen.error(
    'modules',
    `duplicate`,
    func.name,
    'new',
    `${info.getFileName()}:${info.getLineNumber()}`
  );

  pen.fatal(
    'modules',
    'you have a module trying to load over another...',
    'check your modules? see: https://usehenri.io/e/dup_mods'
  );
}

module.exports = Modules;
