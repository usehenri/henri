const { stack } = require('./utils');
const BaseModule = require('./base/module');
const path = require('path');

class Modules {
  constructor(henri) {
    this.henri = henri;
    this.modules = new Map();
    this.store = [[], [], [], [], [], [], []];
    this.order = [];

    // legacy stores
    this._loaders = [];
    this._unloaders = [];

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.add = this.add.bind(this);
    this.loader = this.loader.bind(this);
    this.unloader = this.unloader.bind(this);
  }

  add(func) {
    const { pen } = this.henri;

    const info = stack()[1];

    const obj = validate(func, info, pen);

    if (!obj) {
      return false;
    }

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

  async init(prefix = '.', level = 6) {
    const { pen } = this.henri;

    if (prefix !== this.henri.prefix) {
      changeCurrentDirectory(prefix, pen);
      pen.warn('modules', 'cwd change', this.henri.cwd, process.cwd());
      this.henri.cwd = process.cwd();
    }

    this.henri.prefix = prefix;
    this.henri.runlevel = level;
    this.store.splice(parseInt(level) + 1);

    return new Promise(async resolve => {
      if (this.henri.runlevel < 6) {
        pen.warn('modules', 'running at limited level', this.henri.runlevel);
      }

      this.order = this.store.reduce((a, b) => a.concat(b));
      this.stopOrder = this.store.reduceRight((a, b) => a.concat(b));

      if (this.order.length < 1) {
        throw new Error('available to load. why should I run?');
      }

      let count = 0;
      let size = this.order.length;
      for (let mod of this.order) {
        count++;
        this.henri[mod.name] = mod;
        if (typeof mod.init === 'function') {
          await mod.init();
        }
        pen.info(mod.name, `module`, `loaded`, `${count}/${size}`);
      }
      pen.info('modules', 'loading', '...done!');
      resolve();
    });
  }

  reload() {
    const { pen } = this.henri;

    this.order.forEach(async (V, i, t) => {
      if (V.reloadable && typeof V.reload === 'function') {
        await V.reload();
      }
      pen.info(V.name, `module is reloaded`, `${i + 1}/${t.length}`);
    });

    return true;
  }

  loader(func) {
    if (!this.isProduction && typeof func === 'function') {
      this._loaders.push(func);
    }
  }

  unloader(func) {
    const { pen } = this.henri;
    if (typeof func === 'function') {
      this._unloaders.unshift(func);
    } else {
      pen.error(
        'modules',
        'you tried to register an unloader which is not a function'
      );
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

function changeCurrentDirectory(prefix, pen) {
  try {
    process.chdir(path.resolve(process.cwd(), prefix));
  } catch (e) {
    pen.fatal('modules', `unable to change current directory to ${prefix}`);
  }
}

module.exports = Modules;
