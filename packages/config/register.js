// Registering some global functions & variables

const stack = require('callsite');

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
  Object.keys(require.cache).forEach(function(id) {
    delete require.cache[id];
  });
  try {
    if (loaders.length > 0) {
      for (let loader of loaders) {
        await loader();
      }
    }
    log.info(`server hot reload completed in ${getDiff(start)}ms`);
    log.space();
    log.notify('Hot-reload', 'Server-side hot reload completed..');
  } catch (e) {
    log.error(e);
  }
};

henri.stop = async () => {
  const start = process.hrtime();
  const reapers = henri._unloaders;
  try {
    if (reapers.length > 0) {
      for (let reaper of reapers) {
        await reaper();
      }
    }
    log.warn(`server tear down completed in ${getDiff(start)}ms`);
  } catch (e) {
    log.error(e);
  }
};

henri.passport = {
  authenticate: () =>
    log.error('passport is not initialized. missing user model?'),
};
