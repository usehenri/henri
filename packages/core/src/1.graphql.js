const BaseModule = require('./base/module');
const { mergeTypes, mergeResolvers } = require('merge-graphql-schemas');
const { makeExecutableSchema } = require('graphql-tools');
const { graphqlExpress, graphiqlExpress } = require('apollo-server-express');
const { runQuery } = require('apollo-server-core');

/**
 * Graphqel module
 *
 * @class Graphql
 * @extends {BaseModule}
 */
class Graphql extends BaseModule {
  /**
   * Creates an instance of Graphql.
   * @memberof Graphql
   */
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

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {!string} The name of the module
   * @memberof Graphql
   */
  async init() {
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

  /**
   * Extract graphql items from a model (if any)
   *
   * @param {object} model a model
   * @returns {boolean} status
   * @memberof Graphql
   */
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

    return true;
  }

  /**
   * Merge the graphql types and resolver
   * After extracting from all the models, we merge and compile them
   *
   * @return {boolean} success?
   * @memberof Graphql
   */
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
        resolvers: this.resolvers,
        typeDefs: this.types,
      });
    } else {
      this.active = false;

      return false;
    }

    return true;
  }

  /**
   * Run a Graphql query against compiled graphql
   *
   * @async
   * @param {Graphql} [query=`{ No query }`]  the graphql query
   * @param {?object} [context={}]  optional context
   * @returns {(Promise<GraphQLResponse> | "No graphql schema found.")} value
   * @memberof Graphql
   */
  async run(query = `{ No query }`, context = {}) {
    if (!this.schema) {
      return 'No graphql schema found.';
    }
    const { schema } = this;

    return runQuery({ context, query, schema });
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Graphql
   */
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
