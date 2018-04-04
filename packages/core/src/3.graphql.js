const BaseModule = require('./base/module');
const { mergeTypes, mergeResolvers } = require('merge-graphql-schemas');
const { makeExecutableSchema } = require('graphql-tools');
const { graphqlExpress, graphiqlExpress } = require('apollo-server-express');
const { runQuery } = require('apollo-server-core');

class Graphql extends BaseModule {
  constructor() {
    super();
    this.reloadable = true;
    this.runlevel = 3;
    this.name = 'graphql';
    this.henri = null;

    this.typesList = [];
    this.resolversList = [];

    this.types = null;
    this.resolvers = null;
    this.schema = null;
    this.endpoint = '/_henri/gql';

    this.start = this.start.bind(this);
    this.init = this.init.bind(this);
    this.stop = this.stop.bind(this);
    this.reload = this.reload.bind(this);
  }

  init() {
    if (this.henri.config.has('graphql')) {
      this.endpoint = this.henri.config.get('graphql');
    }

    this.henri.router.use(
      henri._graphql.endpoint,
      graphqlExpress({ schema: henri._graphql.schema })
    );

    if (!this.henri.isProduction) {
      this.henri.pen.info('graphql', 'started graphiql browser');
      this.henri.router.use(
        '/_henri/graphiql',
        graphiqlExpress({ endpointURL: this.endpoint })
      );
    }
  }

  extract(model) {
    if (typeof model.graphql === 'undefined') {
      return;
    }

    const { types = null, resolvers = null } = model.graphql;

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
      this.schema = makeExecutableSchema({
        typeDefs: this.types,
        resolvers: this.resolvers,
      });
    }
  }

  async run(query = `{ No query }`, context = {}) {
    if (!this.schema) {
      return 'No graphql schema found.';
    }

    const { schema } = this;

    return runQuery({ schema, query, context });
  }
}

module.exports = Graphql;
