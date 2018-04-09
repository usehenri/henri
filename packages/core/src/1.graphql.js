const BaseModule = require('./base/module');
const { mergeTypes, mergeResolvers } = require('merge-graphql-schemas');
const { makeExecutableSchema } = require('graphql-tools');
const { graphqlExpress, graphiqlExpress } = require('apollo-server-express');
const { runQuery } = require('apollo-server-core');

class Graphql extends BaseModule {
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 1;
    this.name = 'graphql';
    this.henri = null;

    this.typesList = [];
    this.resolversList = [];

    this.types = null;
    this.resolvers = null;
    this.schema = null;
    this.endpoint = '/_henri/gql';
    this.active = false;

    this.init = this.init.bind(this);
    this.extract = this.extract.bind(this);
    this.merge = this.merge.bind(this);
    this.run = this.run.bind(this);
    this.reload = this.reload.bind(this);
  }

  init() {
    if (this.henri.config.has('graphql')) {
      this.endpoint = this.henri.config.get('graphql');
    }

    this.henri.addMiddleware(app => {
      app.use(this.endpoint, graphqlExpress({ schema: this.schema }));
    });

    if (!this.henri.isProduction) {
      this.henri.pen.info('graphql', 'started graphiql browser');
      this.henri.addMiddleware(app => {
        app.use(
          '/_henri/graphiql',
          graphiqlExpress({ endpointURL: this.endpoint })
        );
      });
    }

    return this.name;
  }

  extract(model) {
    if (typeof model.graphql === 'undefined') {
      return false;
    }

    const { types = null, resolvers = {} } = model.graphql;

    if (typeof types === 'string') {
      this.typesList.push(types);
    }

    if (typeof resolvers === 'object') {
      this.resolversList.push(resolvers);
    }
  }

  merge() {
    let should = false;

    if (this.typesList.length > 0) {
      should = true;
      this.types = mergeTypes(this.typesList);
    }

    if (this.resolversList.length > 0) {
      should = true;
      this.resolvers = mergeResolvers(this.resolversList);
    }

    if (should) {
      this.active = true;
      this.schema = makeExecutableSchema({
        typeDefs: this.types,
        resolvers: this.resolvers,
      });
    } else {
      this.active = false;
    }
  }

  async run(query = `{ No query }`, context = {}) {
    if (!this.schema) {
      return 'No graphql schema found.';
    }

    const { schema } = this;

    return runQuery({ schema, query, context });
  }

  async reload() {
    this.typesList = [];
    this.resolversList = [];

    this.active = false;
    this.types = null;
    this.resolvers = null;
    this.schema = null;
    return this.name;
  }
}

module.exports = Graphql;
