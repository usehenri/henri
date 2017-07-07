const waterline = require('waterline');
const { cwd, log, user } = henri;
const includeAll = require('include-all');
const _ = require('lodash');
const path = require('path');

function load(location) {
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
  const configuration = {
    adapters: {},
    datastores: {},
    models: models,
    defaultModelSettings: {
      primaryKey: 'id',
      datastore: 'default',
      attributes: {
        id: { type: 'number', autoMigrations: { autoIncrement: true } },
      },
    },
  };

  for (const id in models) {
    const model = models[id];
    if (!model.store && !config.has('stores.default')) {
      throw new Error(
        `There is no default store and ${model.identity} is missing one`
      );
    }
    if (model.store && !config.has(`stores.${model.store}`)) {
      throw new Error(
        `It seems like ${model.store} is not configured. ${model.identity} is using it.`
      );
    }
    const storeName = model.store || 'default';
    configuration.datastores[storeName] = Object.assign(
      {},
      config.get(`stores.${storeName}`)
    );
    const { adapter } = configuration.datastores[storeName];

    configuration.datastores[storeName].adapter = `sails-${adapter}`;

    configuration.adapters[`sails-${adapter}`] = getAdapter(adapter);

    // This will be useful when integrating mongoose and sequalize
    model.attributes = Object.assign({}, model.schema);
    delete model.schema;

    if (id === 'user') {
      log.info('Found a user model, overloading it.');
      model.attributes.email = { type: 'string', required: true };
      model.attributes.password = { type: 'string', required: true };
      model.beforeCreate = async (values, cb) => {
        values.password = await user.encrypt(values.password);
        cb();
      };
      model.beforeUpdate = async (values, cb) => {
        if (values.hasOwnProperty('password')) {
          values.password = await user.encrypt(values.password);
        }
        cb();
      };
    }
  }

  henri.models = models;

  return configuration;
}

function getAdapter(adapter) {
  const valid = ['disk', 'mysql', 'mongo', 'postgresql'];
  if (valid.indexOf(adapter) < 0) {
    console.log('');
    log.error(
      `Adapter '${adapter}' is not valid. Check your configuration file.`
    );
    console.log('');
    process.exit(-1);
  }
  try {
    const pkg = require(path.resolve(
      cwd,
      'node_modules',
      `@usehenri/${adapter}`
    ));
    return pkg;
  } catch (e) {
    console.log('');
    log.error(`Unable to load database adapter '${adapter}'. Seems like you`);
    log.error(`should install it using: npm install @usehenri/${adapter}`);
    console.log('');
    process.exit(-1);
  }
}

async function start(configuration) {
  return new Promise((resolve, reject) => {
    waterline.start(configuration, (err, orm) => {
      if (err) {
        if (err.code === 'badConfiguration') {
          console.log('');
          log.error('The database connection configuration is invalid.');
          console.log('');
          process.exit(-1);
        }
        return reject(err);
      }
      henri.orm = orm;
      const { models } = configuration;
      for (const id in models) {
        const model = models[id];
        const name = _.capitalize(model.identity);
        global[name] = waterline.getModel(model.identity, orm);
        henri._models.push(name);
      }
      resolve();
    });
  });
}

async function stop() {
  return new Promise((resolve, reject) => {
    waterline.stop(henri.orm, err => {
      if (err) {
        log.error('something went wrong while stopping the orm', err);
        return resolve(err);
      }
      log.warn('models (orm) gracefully stopped');
      return resolve();
    });
  });
}

async function init() {
  await start(await configure(await load('./app/models')));
}

async function reload() {
  await stop();
  henri._models.forEach(name => delete global[name]);
  henri._models = [];
  await init();
  log.warn('models are reloaded');
}

henri.addLoader(reload);

henri.addReaper(stop);

module.exports = init();

log.info('model module loaded.');
