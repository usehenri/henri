const { stack } = require('./utils');
const BaseModule = require('./base/module');

class Modules {
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
      line: info.getLineNumber(),
      func: info.getFunctionName(),
      time: Date.now(),
    });

    this.store[obj.runlevel].push(obj);

    return true;
  }

  async init() {
    const { pen } = this.henri;

    this.store.splice(parseInt(this.henri.runlevel) + 1);

    // this.order = this.store.reduce((a, b) => a.concat(b));
    this.stopOrder = this.store.reduceRight((a, b) => a.concat(b));

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

        let result = await Promise.all(this.order[runlevel].map(f => f()));
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
    const max = this.reloadable.reduce((a, b) => a.concat(b));
    for (let level of this.reloadable) {
      if (level.length > 0) {
        const result = await Promise.all(level.map(f => f()));
        for (let name of result) {
          count++;
          pen.info(`modules`, name, `reloaded`, `${count}/${max.length}`);
        }
      }
    }

    return true;
  }

  async stop() {
    const { pen } = this.henri;

    for (let mod of this.stopOrder) {
      this.henri[mod.name] = mod;
      if (typeof mod.stop === 'function') {
        if (await mod.stop()) {
          pen.info(`modules`, mod.name, `stopped`);
        }
      }
    }
  }
}

function validate(obj, info, pen) {
  const file = info.getFileName();
  const line = info.getLineNumber();
  const func = info.getFunctionName();
  const label = `${file}:${line} :: ${func}`;

  if (!(obj instanceof BaseModule)) {
    pen.fatal('modules', `${label} is not extending BaseModule`);
    return false;
  }

  if (typeof obj.runlevel !== 'number') {
    pen.fatal('modules', `${label} runlevel is not defined`);
    return false;
  }

  if (typeof obj.name !== 'string') {
    pen.fatal('modules', `${label} name is not a string`);
    return false;
  }

  if (obj.runlevel < 0 || obj.runlevel > 6) {
    pen.fatal('modules', `${obj.name} runlevel is out of range`);
    return false;
  }

  if (typeof obj.init !== 'function') {
    pen.fatal('modules', `${obj.name} init is not a function`);
    return false;
  }

  if (obj.reloadable) {
    if (typeof obj.reload !== 'function') {
      pen.fatal(
        'modules',
        `${obj.name} has no valid reload function. Is it reloadable?`
      );
      return false;
    }
  }
  return obj;
}

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
