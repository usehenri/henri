const { stack } = require('./utils');
const BaseModule = require('./base/module');

class Modules {
  constructor(henri) {
    this.henri = henri;
    this.modules = {};
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
    const info = stack()[1];

    validate(func, info);

    this.has(func.name, info);

    this.modules[func.name] = {
      filename: info.getFileName(),
      line: info.getLineNumber(),
      func: info.getFunctionName() || 'anonymous',
      time: Date.now(),
    };
    if (func.runlevel <= this.henri.settings.runlevel) {
      this.store[func.runlevel].push(func);
    }
  }

  init() {
    if (this.henri.settings.runlevel < 6) {
      henri.log.warn(
        `running at limited level; ${this.henri.settings.runlevel}`
      );
    }

    this.order = this.store.reduce((a, b) => a.concat(b));
    this.stopOrder = this.store.reduceRight((a, b) => a.concat(b));

    if (this.order.length < 1) {
      throw new Error('available to load. why should I run?');
    }

    this.order.forEach(async (V, i, t) => {
      this.henri[V.name] = V;
      typeof V.init === 'function' && (await V.init());
      console.log(`> ${V.name} module is loaded (${i + 1}/${t.length}).`);
      // TODO: don't quite know if next statement removal will have consequences
      // this.henri[name] = this.henri[name].bind(this.henri);
    });
  }

  reload() {
    this.order.forEach(async (V, i, t) => {
      if (V.reloadable && typeof V.reload === 'function') {
        await V.reload();
      }
      console.log(`> ${V.name} module is reloaded (${i + 1}/${t.length}).`);
    });
  }

  has(name, info, force = false) {
    if (typeof this.henri[name] !== 'undefined' && !force) {
      const { log } = this.henri;
      const { time, filename, line } = this.modules[name];
      const timeDiff = Date.now() - time;
      log.fatalError(`unable to register module '${name}' as it already exists
  
      it was registered in ${filename}:${line} about ${timeDiff}ms ago
      
      you tried to register from ${info.getFileName()}:${info.getLineNumber()}`);
    }
    return false;
  }

  loader(func) {
    if (!this.isProduction && typeof func === 'function') {
      this.henri._loaders.push(func);
    }
  }

  unloader(func) {
    if (typeof func === 'function') {
      this.henri._unloaders.unshift(func);
    } else {
      this.henri.log.error(
        'you tried to register an unloader which is not a function'
      );
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
