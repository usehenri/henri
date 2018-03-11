const { stack } = require('./utils');
const BaseModule = require('./base/module');
const path = require('path');

class Modules {
  constructor(henri) {
    this.henri = henri;
    this.modules = new Map();
    this.store = [[], [], [], [], [], [], []];
    this.order = [];

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.add = this.add.bind(this);
    this.has = this.has.bind(this);
    this.loader = this.loader.bind(this);
    this.unloader = this.unloader.bind(this);
  }

  async add(func) {
    const { pen } = this.henri;

    const info = stack()[1];

    validate(func, info);

    const existing = this.modules.get(func.name);

    if (existing) {
      crashOnDuplicateModule(existing, func, info, pen);
    }

    this.modules.set(func.name, {
      filename: info.getFileName(),
      line: info.getLineNumber(),
      func: info.getFunctionName() || 'anonymous',
      time: Date.now(),
    });

    this.store[func.runlevel].push(func);
  }

  async init(prefix, level) {
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
  }

  has(name, info, force = false) {
    if (typeof this.henri[name] !== 'undefined' && !force) {
      const { log } = this.henri;
      const { time, filename, line } = this.modules[name];
      const timeDiff = Date.now() - time;
      log.fatalError(
        `unable to register module '${name}' as it already exists
  
      it was registered in ${filename}:${line} about ${timeDiff}ms ago
      
      you tried to register from ${info.getFileName()}:${info.getLineNumber()}`
      );
    }
    return false;
  }

  loader(func) {
    if (!this.isProduction && typeof func === 'function') {
      this.henri._loaders.push(func);
    }
  }

  unloader(func) {
    const { pen } = this.henri;
    if (typeof func === 'function') {
      this.henri._unloaders.unshift(func);
    } else {
      pen.error('you tried to register an unloader which is not a function');
    }
  }
}

function validate(obj, info) {
  const file = info.getFileName();
  const line = info.getLineNumber();
  const func = info.getFunctionName() || 'anonymous';
  const label = `${file}:${line} :: ${func}`;

  if (!(obj instanceof BaseModule)) {
    throw new Error(`${label} is not extending BaseModule`);
  }

  if (typeof obj.runlevel !== 'number') {
    throw new Error(`${label} runlevel is not defined`);
  }

  if (typeof obj.name !== 'string') {
    throw new Error(`${label} name is not a string`);
  }

  if (obj.runlevel < 0 || obj.runlevel > 6) {
    throw new Error(`${obj.name} runlevel is out of range`);
  }

  if (typeof obj.init !== 'function') {
    throw new Error(`${obj.name} init is not a function`);
  }

  if (obj.reloadable) {
    if (typeof obj.reload !== 'function') {
      throw new Error(
        `${obj.name} has no valid reload function. Is it reloadable?`
      );
    }
  }
}

module.exports = Modules;

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
