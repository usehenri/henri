const includeAll = require('include-all');
const path = require('path');

const { config, log } = henri;

function load(location) {
  return new Promise((resolve, reject) => {
    includeAll.optional(
      {
        dirname: path.resolve(location),
        filter: /(.+)\.js$/,
        excludeDirs: /^\.(git|svn)$/,
        flatten: true,
        keepDirectoryPath: true,
        force: true,
      },
      // with optional, it should silently fail...
      (none, modules) => {
        return resolve(modules);
      }
    );
  });
}

async function configure(controllers) {
  const configured = {};
  for (const id in controllers) {
    const controller = controllers[id];
    for (const key in controller) {
      const method = controller[key];
      if (typeof method === 'function') {
        configured[`${id}#${key}`] = method;
      }
    }
  }

  henri.controllers = configured;
}

async function init() {
  await configure(
    await load(
      config.has('location.controllers')
        ? path.resolve(config.get('location.controllers'))
        : './app/controllers'
    )
  );
}

async function reload() {
  delete henri.controllers;
  await init();
  log.warn('controllers reloaded');
}

henri.addLoader(reload);

module.exports = init();

log.info('controller module loaded.');
