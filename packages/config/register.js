// Registering some global functions & variables

const stack = require('callsite');

const { log } = henri;

henri.addModule = (name, func, force) => {
  const info = stack()[1];

  if (henri.hasOwnProperty(name) && !force) {
    const { time, filename, line } = henri._modules[name];
    const timeDiff = Date.now() - time;
    log.error(`unable to register module '${name}' as it already exists`);
    log.error(
      `it was registered in ${filename}:${line} about ${timeDiff}ms ago`
    );
    log.error(
      `you tried to register from ${info.getFileName()}:${info.getLineNumber()}`
    );
    process.exit(-1);
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
    henri._loaders.list.push(func);
  }
};

henri.addReaper = func => {
  if (typeof func === 'function') {
    henri._reapers.list.unshift(func);
  }
};

henri.release = henri.version = require('./package.json').version;

henri.isProduction = process.env.NODE_ENV === 'production';

henri.isTest = process.env.NODE_ENV === 'test';

henri.cwd = process.cwd();
