const includeAll = require('include-all');
const path = require('path');

const { log } = henri;

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
      (err, modules) => {
        if (err) {
          return reject(err);
        }
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
  await configure(await load('./app/controllers'));
}

async function reload() {
  delete henri.controllers;
  await init();
  log.warn('controllers reloaded');
}

henri.addLoader(reload);

module.exports = init();

log.info('controller module loaded.');
