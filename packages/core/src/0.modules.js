const path = require('path');
const { stack } = require('./utils');
const BaseModule = require('./base/module');

const debug = require('debug')('henri:modules');

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

    this.store = [[], [], [], [], [], [], [], []];
    this.order = [[], [], [], [], [], [], [], []];
    this.reloadable = [[], [], [], [], [], [], [], []];
    this.stopOrder = [];
    this.initialized = false;

    /** The reload in flight, if any */
    this._reloading = null;
    /** The single reload queued behind the one in flight, if any */
    this._reloadQueued = null;

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
   * @throws the error of the first module that fails to initialize
   * @returns {Promise<boolean>} results
   * @memberof Modules
   */
  async init() {
    debug('starting init');

    const { pen } = this.henri;

    this.store.splice(parseInt(this.henri.runlevel) + 1);

    this.stopOrder = this.store.reduceRight((prev, next) => prev.concat(next));

    if (this.stopOrder.length < 1) {
      throw pen.fatal('modules', 'init', 'no modules loaded before init');
    }

    let count = 0;
    const size = this.stopOrder.length;

    for (const level of this.store) {
      if (level.length < 1) {
        continue;
      }

      let runlevel = 0;

      for (const obj of level) {
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
            async (func) => typeof func === 'function' && (await func())
          )
        );
      } catch (error) {
        pen.error('modules', `runlevel ${runlevel}`, error && error.message);
        debug(`error in runlevel ${runlevel}`, error);
        throw error;
      }

      for (const name of result) {
        count++;
        pen.info(`modules`, name, `loaded`, `${count}/${size}`);
      }
    }

    pen.info('modules', 'loading', '...done!');

    this.initialized = true;

    return true;
  }

  /**
   * Reloads all the modules
   * Reloads are serialized: a call while one is in flight queues exactly one
   * more run (every caller in the meantime gets that same run).
   *
   * @async
   * @throws the error of the first module that fails to reload
   * @returns {Promise<boolean>} reload status
   * @memberof Modules
   */
  reload() {
    const { pen } = this.henri;

    if (!this.initialized) {
      pen.warn('modules', 'cannot reload when not initialized');

      return Promise.resolve(false);
    }

    if (this._reloading) {
      if (!this._reloadQueued) {
        debug('reload already in flight, queueing one more');

        const runNext = () => {
          this._reloadQueued = null;

          return this.reload();
        };

        this._reloadQueued = this._reloading.then(runNext, runNext);
      }

      return this._reloadQueued;
    }

    this._reloading = this._reload().finally(() => {
      this._reloading = null;
    });

    return this._reloading;
  }

  /**
   * The reload itself: evict the application files from the require cache
   * and call every reloadable module in runlevel order
   *
   * @private
   * @async
   * @throws
   * @returns {Promise<boolean>} reload status
   * @memberof Modules
   */
  async _reload() {
    const { pen } = this.henri;

    this.evictCache();

    let count = 0;
    const max = this.reloadable.reduce((prev, next) => prev.concat(next));

    for (const level of this.reloadable) {
      if (level.length < 1) {
        continue;
      }

      const result = await Promise.all(
        level.map(async (func) => typeof func === 'function' && (await func()))
      );

      for (const name of result) {
        count++;
        pen.info(`modules`, name, `reloaded`, `${count}/${max.length}`);
      }
    }

    return true;
  }

  /**
   * Remove the application files from the require cache
   * Only files under henri.cwd() and outside node_modules are evicted, so
   * dependencies (mongoose, sequelize, apollo...) keep a single instance.
   *
   * @param {object} [cache=require.cache] the cache to evict from
   * @returns {number} the number of evicted entries
   * @memberof Modules
   */
  evictCache(cache = require.cache) {
    const root = `${path.resolve(this.henri.cwd())}${path.sep}`;
    const skip = `${path.sep}node_modules${path.sep}`;
    let evicted = 0;

    for (const id of Object.keys(cache)) {
      if (id.startsWith(root) && !id.includes(skip)) {
        delete cache[id];
        evicted++;
      }
    }

    debug('evicted %d entries from the require cache', evicted);

    return evicted;
  }

  /**
   * Stops the modules
   * Every module is stopped, even when one of them fails; the failures are
   * returned so the caller can decide what to do.
   *
   * @async
   * @returns {Promise<Array<Error>>} the errors, empty when everything stopped
   * @memberof Modules
   */
  async stop() {
    const { pen } = this.henri;
    const errors = [];

    for (const mod of this.stopOrder) {
      if (typeof mod.stop !== 'function') {
        continue;
      }

      try {
        if (await mod.stop()) {
          pen.info(`modules`, mod.name, `stopped`);
        }
      } catch (error) {
        pen.error('modules', mod.name, 'failed to stop', error);
        error.module = mod.name;
        errors.push(error);
      }
    }

    return errors;
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

  if (obj.runlevel < 0 || obj.runlevel > 7) {
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
 * @throws always
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

  throw pen.fatal(
    'modules',
    'you have a module trying to load over another...',
    'check your modules? see: https://usehenri.io/e/dup_mods'
  );
}

module.exports = Modules;
