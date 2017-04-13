const includeAll = require('include-all');
const path = require('path');

function load(location) {
  return new Promise((resolve, reject) => {
    includeAll.optional(
      {
        dirname: path.resolve(location),
        filter: /(.+)\.js$/,
        excludeDirs: /^\.(git|svn)$/,
        flatten: true,
        keepDirectoryPath: true
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
  if (!global['henri']) {
    global['henri'] = {};
  }

  global['henri'].controllers = configured;
}

async function init() {
  await configure(await load('./app/controllers'));
}

module.exports = init();
