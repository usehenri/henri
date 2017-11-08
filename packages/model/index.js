const { cwd, log } = henri;
const path = require('path');
const fs = require('fs');

function load(location) {
  const includeAll = require('include-all');
  return new Promise((resolve, reject) => {
    includeAll.optional(
      {
        dirname: path.resolve(location),
        filter: /(.+)\.js$/,
        excludeDirs: /^\.(git|svn)$/,
        flatten: true,
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

async function configure(models) {
  const { config } = henri;
  delete henri.stores;
  henri.stores = {};
  const configuration = {
    adapters: {},
    models: {},
  };

  for (const id in models) {
    const model = models[id];

    if (!model.store && !config.has('stores.default')) {
      return log.fatalError(
        `There is no default store and ${model.identity} is missing one`
      );
    }

    if (model.store && !config.has(`stores.${model.store}`)) {
      return log.fatalError(
        `It seems like ${model.store} is not configured. ${
          model.identity
        } is using it.`
      );
    }

    const storeName = model.store || 'default';

    const getStore = name => {
      if (henri.stores[name]) {
        return henri.stores[name];
      }
      const store = config.get(`stores.${name}`);
      const valid = {
        mongoose: 'mongoose',
      };
      if (valid.hasOwnProperty(store.adapter) < 0) {
        return log.fatalError(
          `Adapter '${
            store.adapter
          }' is not valid. Check your configuration file.`
        );
      }
      const conn = valid[store.adapter];
      try {
        const Pkg = henri.isTest
          ? require(`@usehenri/${conn}`)
          : require(path.resolve(cwd, 'node_modules', `@usehenri/${conn}`));
        henri.stores[name] = new Pkg(name, store);
        return henri.stores[name];
      } catch (e) {
        return log.fatalError(`
        Unable to load database adapter '${store.adapter}'. Seems like you 
        should install it using: npm install @usehenri/${store.adapter}`);
      }
    };

    const store = getStore(storeName);

    global[model.globalId] = store.addModel(model);
    henri._models.push(model.globalId);
    configuration.adapters[storeName] = store;
  }
  return configuration;
}

async function start(configuration) {
  return new Promise(async (resolve, reject) => {
    for (var store in henri.stores) {
      await henri.stores[store].start();
    }
    if (henri._models.length > 0) {
      // TODO: Add some way of backing up data and restoring if fails
      const eslintFile = path.resolve(cwd, '.eslintrc');
      try {
        const eslintRc = JSON.parse(fs.readFileSync(eslintFile, 'utf8'));
        henri._models.map(modelName => (eslintRc.globals[modelName] = true));
        fs.writeFileSync(eslintFile, JSON.stringify(eslintRc));
      } catch (e) {} // Do nothing
    }
    return resolve();
  });
}

async function stop() {
  return new Promise(async (resolve, reject) => {
    if (henri.stores.length < 1) {
      log.warn('no models/stores needed to be stopped.');
      return resolve();
    }
    for (var store in henri.stores) {
      await henri.stores[store].stop();
    }
    henri._models.forEach(name => delete global[name]);
    log.warn('models (orm) gracefully stopped');
    return resolve();
  });
}

async function init() {
  const { config } = henri;
  await start(
    await configure(
      await load(
        config.has('location.models')
          ? path.resolve(config.get('location.models'))
          : './app/models'
      )
    )
  );
}

async function reload() {
  await stop();
  henri._models.forEach(name => delete global[name]);
  henri._models = [];
  await init();
  log.warn('models are reloaded');
}

henri.addLoader(reload);

henri.addUnloader(stop);

module.exports = init();

log.info('model module loaded.');
