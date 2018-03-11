const BaseModule = require('./base/module');
const path = require('path');
const fs = require('fs');
const { mergeTypes, mergeResolvers } = require('merge-graphql-schemas');
const { makeExecutableSchema } = require('graphql-tools');
const { graphqlExpress, graphiqlExpress } = require('apollo-server-express');
const { runQuery } = require('apollo-server-core');

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
  const user = config.has('user') ? config.get('user').toLowerCase() : 'user';
  delete henri.stores;
  delete henri._user;
  henri._user = null;
  henri.stores = {};
  const configuration = {
    adapters: {},
    models: {},
  };

  for (const id of Object.keys(models)) {
    const model = models[id];
    checkStoreOrDie(model);
    const storeName = model.store || 'default';
    const store = await getStore(storeName);
    global[model.globalId] = store.addModel(model, user);
    henri._models.push(model.globalId);
    configuration.adapters[storeName] = store;
    extractGraph(model);
  }
  mergeGraph();
  return configuration;
}

function checkStoreOrDie(model) {
  const { config, log } = henri;
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
}

async function getStore(name) {
  const { config, log } = henri;
  if (henri.stores[name]) {
    return henri.stores[name];
  }
  const store = config.get(`stores.${name}`);
  const valid = {
    mongoose: 'mongoose',
    disk: 'disk',
    mysql: 'mysql',
    mariadb: 'mysql',
    postgresql: 'postgresql',
    mssql: 'mssql',
  };
  if (typeof valid[store.adapter] === 'undefined') {
    return log.fatalError(
      `Adapter '${store.adapter}' is not valid. Check your configuration file.`
    );
  }
  const conn = valid[store.adapter];
  const Pkg = requirePackage(store, conn);
  henri.stores[name] = new Pkg(name, store);
  return henri.stores[name];
}

function requirePackage(store, conn) {
  const { cwd, log } = henri;
  try {
    const Pkg = henri.isTest
      ? require(`@usehenri/${conn}`)
      : require(path.resolve(cwd, 'node_modules', `@usehenri/${conn}`));
    return Pkg;
  } catch (e) {
    return log.fatalError(`
    Unable to load database adapter '${store.adapter}'. Seems like you 
    should install it using: npm install @usehenri/${store.adapter}`);
  }
}

function extractGraph(model) {
  if (typeof model.graphql === 'undefined') {
    return;
  }
  const { types = null, resolvers = null } = model.graphql;

  if (typeof types === 'string') {
    henri._graphql.typesList.push(types);
  }
  if (typeof resolvers === 'object') {
    henri._graphql.resolversList.push(resolvers);
  }
}

function mergeGraph() {
  let should = false;
  if (henri._graphql.typesList.length > 0) {
    should = true;
    henri._graphql.types = mergeTypes(henri._graphql.typesList);
  }
  if (henri._graphql.resolversList.length > 0) {
    should = true;
    henri._graphql.resolvers = mergeResolvers(henri._graphql.resolversList);
  }
  if (should) {
    henri._graphql.schema = makeExecutableSchema({
      typeDefs: henri._graphql.types,
      resolvers: henri._graphql.resolvers,
    });
  }
}

class Model extends BaseModule {
  constructor(henri) {
    super();
    this.reloadable = true;
    this.runlevel = 4;
    this.name = 'model';
    this.henri = henri;

    this.start = this.start.bind(this);
    this.init = this.init.bind(this);
    this.stop = this.stop.bind(this);
    this.reload = this.reload.bind(this);
  }
  async init() {
    const { config, pen } = henri;
    return new Promise(async resolve => {
      this.henri._graphql = {
        active: false,
        endpoint:
          (config.has('graphql') && config.get('graphql')) || '/_henri/gql',
        resolvers: null,
        resolversList: [],
        schema: null,
        typesList: [],
        types: null,
        register: () => {
          henri._graphql.active = true;
          henri.router.use(
            henri._graphql.endpoint,
            graphqlExpress({ schema: henri._graphql.schema })
          );
          if (!henri.isProduction) {
            pen.info('graphql', 'started graphiql browser');
            henri.router.use(
              '/_henri/graphiql',
              graphiqlExpress({ endpointURL: henri._graphql.endpoint })
            );
          }
        },
      };
      henri.graphql = async (query = `{ No query }`, context = {}) => {
        if (henri._graphql && !henri._graphql.schema) {
          return 'No graphql schema found.';
        }
        const { schema } = this.henri._graphql;

        return runQuery({ schema, query, context });
      };
      await this.start(
        await configure(
          await load(
            config.has('location.models')
              ? path.resolve(config.get('location.models'))
              : './app/models'
          )
        )
      );
      resolve();
    });
  }
  async start(configuration) {
    const { cwd } = this.henri;
    return new Promise(async (resolve, reject) => {
      for (const store of Object.keys(henri.stores)) {
        await henri.stores[store].start();
      }
      if (henri._models.length > 0) {
        // TODO: Add some way of backing up data and restoring if fails
        const eslintFile = path.resolve(cwd, '.eslintrc');
        try {
          const eslintRc = JSON.parse(fs.readFileSync(eslintFile, 'utf8'));
          henri._models.map(modelName => (eslintRc.globals[modelName] = true));
          fs.writeFileSync(eslintFile, JSON.stringify(eslintRc, null, 2));
        } catch (e) {} // Do nothing
      }
      return resolve();
    });
  }
  async stop() {
    const { pen } = this.henri;
    return new Promise(async (resolve, reject) => {
      if (henri.stores.length < 1) {
        pen.warn('model', 'no models/stores needed to be stopped.');
        return resolve();
      }
      for (const store of Object.keys(henri.stores)) {
        await henri.stores[store].stop();
      }
      henri._models.forEach(name => delete global[name]);
      return resolve();
    });
  }
  async reload() {
    await this.stop();
    delete this.henri._graphql;
    this.henri._models.forEach(name => delete global[name]);
    this.henri._models = [];
    await this.init();
  }
}

module.exports = Model;
