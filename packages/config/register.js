// Registering some global functions & variables

const stack = require('callsite');
const readline = require('readline');

const { getDiff, log } = henri;

henri.addModule = (name, func, force) => {
  const info = stack()[1];

  // should check if func is a function?

  if (henri.hasOwnProperty(name) && !force) {
    const { time, filename, line } = henri._modules[name];
    const timeDiff = Date.now() - time;
    log.fatalError(`unable to register module '${name}' as it already exists

    it was registered in ${filename}:${line} about ${timeDiff}ms ago
    
    you tried to register from ${info.getFileName()}:${info.getLineNumber()}`);
    return;
  }
  henri[name] = func;

  /* istanbul ignore next */
  henri._modules[name] = {
    filename: info.getFileName(),
    line: info.getLineNumber(),
    func: info.getFunctionName() || 'anonymous',
    time: Date.now(),
  };

  log.info(`${name} module loaded.`);
};

henri.addLoader = func => {
  if (process.env.NODE_ENV !== 'production' && typeof func === 'function') {
    henri._loaders.push(func);
  }
};

henri.addUnloader = func => {
  if (typeof func === 'function') {
    henri._unloaders.unshift(func);
  } else {
    log.error('you tried to register an unloader which is not a function');
  }
};

henri.addMiddleware = func => {
  henri._middlewares.push(func);
};

henri.setStatus = (key, value = false) => {
  henri.status[key] = value;
};

henri.getStatus = key => {
  return henri.status[key] || false;
};

henri.reload = async () => {
  const start = process.hrtime();
  const loaders = henri._loaders;
  /* istanbul ignore next */
  Object.keys(require.cache).forEach(function(id) {
    delete require.cache[id];
  });
  try {
    /* istanbul ignore next */
    if (loaders.length > 0) {
      for (let loader of loaders) {
        await loader();
      }
    }
    log.info(`server hot reload completed in ${getDiff(start)}ms`);
    log.space();
    log.notify('Hot-reload', 'Server-side hot reload completed..');
  } catch (e) {
    /* istanbul ignore next */
    log.error(e);
  }
};

henri.stop = async () => {
  const start = process.hrtime();
  const reapers = henri._unloaders;
  try {
    /* istanbul ignore next */
    if (reapers.length > 0) {
      for (let reaper of reapers) {
        await reaper();
      }
    }
    log.warn(`server tear down completed in ${getDiff(start)}ms`);
  } catch (e) {
    /* istanbul ignore next */
    log.error(e);
  }
};

henri.clearConsole = () => {
  // Thanks to friendly-errors-webpack-plugin
  if (process.stdout.isTTY) {
    // Fill screen with blank lines. Then move to 0 (beginning of visible part) and clear it
    const blank = '\n'.repeat(process.stdout.rows);
    console.log(blank);
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  }
};
henri.passport = {
  authenticate: () =>
    log.error('passport is not initialized. missing user model?'),
};
