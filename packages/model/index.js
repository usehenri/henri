const waterline = require('waterline');
const { log, user, config } = henri;
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
    if (model.datastore && !config.has(`stores.${model.datastore}`)) {
      throw new Error(
        `It seems like ${model.datastore} is not configured. ${model.identity} is using it.`
      );
    }
    const storeName = model.datastore || 'default';
    configuration.datastores[storeName] = Object.assign(
      {},
      config.get(`stores.${storeName}`)
    );
    const { adapter } = configuration.datastores[storeName];
    configuration.datastores[storeName].adapter = `sails-${adapter}`;
    // TODO: Change this to @usehenri/<pkg> package in the future
    configuration.adapters[`sails-${adapter}`] = require(`sails-${adapter}`);
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
  if (!global['henri']) {
    global['henri'] = {};
  }
  global['henri'].models = models;

  return configuration;
}

async function start(configuration) {
  return new Promise((resolve, reject) => {
    waterline.start(configuration, (err, orm) => {
      if (err) return reject(err);
      const { models } = configuration;
      for (const id in models) {
        const model = models[id];
        const name = _.capitalize(model.identity);
        global[name] = waterline.getModel(model.identity, orm);
      }
      resolve();
    });
  });
}

async function init() {
  await start(await configure(await load('./app/models')));
}

module.exports = init();

henri.log.info('model module loaded.');
