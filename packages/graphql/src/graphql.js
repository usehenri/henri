const BaseModule = require('@usehenri/core/module');
const { mergeTypeDefs, mergeResolvers } = require('@graphql-tools/merge');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@as-integrations/express5');
const { GraphQLError } = require('graphql');
const debug = require('debug')('henri:graphql');

const {
  accessGuard,
  cancellation,
  graphqlConfig,
  queryLimits,
} = require('./graphql-guard');
const { loopbackOnly } = require('./loopback');

/**
 * Build a GraphQLError subclass carrying an `extensions.code`
 *
 * @param {string} code the extension code (ex: UNAUTHENTICATED)
 * @returns {typeof GraphQLError} the error class
 */
const errorWithCode = (code) =>
  class extends GraphQLError {
    /**
     * @param {string} message error message
     * @param {object} [options={}] GraphQLError options
     */
    constructor(message, options = {}) {
      super(message, {
        ...options,
        extensions: { code, ...(options.extensions || {}) },
      });
    }
  };

const AuthenticationError = errorWithCode('UNAUTHENTICATED');
const ForbiddenError = errorWithCode('FORBIDDEN');
const UserInputError = errorWithCode('BAD_USER_INPUT');
const ValidationError = errorWithCode('GRAPHQL_VALIDATION_FAILED');
const SyntaxError = errorWithCode('GRAPHQL_PARSE_FAILED');

/**
 * The GraphQL module of henri
 *
 * This package ships it (`"henri": { "module": "./module.js" }` in its
 * package.json), so an application that depends on the package has it in the
 * boot as `henri.graphql`, with nothing else to write. An application that
 * does not never loads Apollo Server, and `henri.graphql` is undefined.
 *
 * It only needs the configuration: the schema is built from the models,
 * which extract into it at their own level.
 *
 * @class Graphql
 * @extends {BaseModule}
 */
class Graphql extends BaseModule {
  /**
   * Creates an instance of Graphql.
   *
   * @param {object} [henri=null] A henri instance
   * @memberof Graphql
   */
  constructor(henri = null) {
    super();

    this.reloadable = true;
    this.needs = ['config'];
    this.runlevel = 1;
    this.name = 'graphql';
    this.henri = henri;

    this.typesList = [];
    this.resolversList = [];

    this.types = null;
    this.resolvers = null;
    this.schema = null;
    this.endpoint = '/_henri/gql';
    /** Normalized `config.graphql`: the endpoint, the limits, the access rules */
    this.settings = graphqlConfig(null, this.endpoint);
    this.active = false;

    this.graphqlServer = null;
    this.ready = null;

    this._handler = null;
    this._middlewareRegistered = false;

    this.init = this.init.bind(this);
    this.extract = this.extract.bind(this);
    this.merge = this.merge.bind(this);
    this.run = this.run.bind(this);
    this.reload = this.reload.bind(this);
    this.createServer = this.createServer.bind(this);

    this.GraphQLError = GraphQLError;
    this.ApolloError = GraphQLError;
    this.toApolloError = (error, code = 'INTERNAL_SERVER_ERROR') =>
      error instanceof GraphQLError
        ? error
        : new GraphQLError(error.message, {
            extensions: { code },
            originalError: error,
          });
    this.SyntaxError = SyntaxError;
    this.ValidationError = ValidationError;
    this.AuthenticationError = AuthenticationError;
    this.ForbiddenError = ForbiddenError;
    this.UserInputError = UserInputError;
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
    const { config } = this.henri;

    this.settings = graphqlConfig(
      config.has('graphql') ? config.get('graphql') : null,
      this.endpoint
    );
    this.endpoint = this.settings.endpoint;

    if (this.schema !== null && !this.graphqlServer) {
      await this.createServer();
    }

    if (!this.henri.isProduction && this.active) {
      this.henri.pen.info('graphql', 'endpoint', this.endpoint);
    }

    return this.name;
  }

  /**
   * Create (and start) the Apollo server for the current schema
   * The express middleware is registered once and always delegates to the
   * latest server instance, so reloads do not stack handlers.
   *
   * @returns {Promise<void>} resolves once the server has started
   * @memberof Graphql
   */
  createServer() {
    const { introspection, maxTokens } = this.settings;
    const server = new ApolloServer({
      // Apollo's own simple-request protection: a POST must be
      // `application/json` or carry `apollo-require-preflight`, so a form on
      // another site cannot reach the endpoint. On by default; named here so
      // it stays that way.
      csrfPrevention: true,
      introspection:
        introspection === null ? !this.henri.isProduction : introspection,
      parseOptions: Number.isFinite(maxTokens) ? { maxTokens } : {},
      plugins: [cancellation()],
      schema: this.schema,
      validationRules: [queryLimits(this.settings)],
    });

    this.graphqlServer = server;
    this.ready = server
      .start()
      .then(() => {
        this._handler = expressMiddleware(server, {
          context: async ({ req, res }) => ({ req, res }),
        });
        debug('apollo server started');
      })
      .catch((error) => {
        this.henri.pen.error('graphql', 'unable to start apollo server');
        this.henri.pen.error('graphql', error);
        this.active = false;
      });

    if (!this._middlewareRegistered) {
      this._middlewareRegistered = true;
      this.henri.addMiddleware('graphql', (app) => {
        const guards = [];

        if (this.settings.loopbackOnly) {
          guards.push(loopbackOnly(this.henri));
        }

        guards.push(accessGuard(this.settings));

        app.use(this.endpoint, ...guards, (req, res, next) => {
          if (!this.active || !this._handler) {
            return next();
          }

          return this._handler(req, res, next);
        });
      });
    }

    return this.ready;
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
      this.types = mergeTypeDefs(this.typesList);
    }

    if (this.resolversList.length > 0) {
      should = true;
      this.resolvers = mergeResolvers(this.resolversList);
    }

    if (should) {
      this.active = true;
      try {
        this.schema = makeExecutableSchema({
          resolvers: this.resolvers || {},
          typeDefs: this.types,
        });
        this.henri.pen.info('graphql', 'schema', 'valid');
        this.createServer();
      } catch (error) {
        this.henri.pen.error('graphql', error);
        this.henri.pen.error(
          'graphql',
          `THE GRAPHQL SERVICE WON'T BE AVAILABLE`
        );
        this.henri.pen.error('graphql', `UNTIL YOU FIX THIS ERROR`);
        this.active = false;
      }
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
   * @param {object} [variables] query variables
   * @param {object} [contextValue={}] the resolvers' context (ex: { req, res })
   * @returns {(Promise<{data: object, errors: Array}> | "No graphql schema found.")} value
   * @memberof Graphql
   */
  async run(query = `{ No query }`, variables = undefined, contextValue = {}) {
    if (!this.schema || !this.graphqlServer) {
      return 'No graphql schema found.';
    }

    await this.ready;

    const response = await this.graphqlServer.executeOperation(
      {
        query,
        variables,
      },
      { contextValue: contextValue || {} }
    );

    if (response.body.kind === 'single') {
      const { data, errors } = response.body.singleResult;

      return { data, errors };
    }

    return {
      data: null,
      errors: [new GraphQLError('incremental delivery is not supported')],
    };
  }

  /**
   * Reloads the module
   * State is cleared synchronously; the previous Apollo server is stopped in
   * the background.
   *
   * @async
   * @returns {string} Module name
   * @memberof Graphql
   */
  async reload() {
    const previous = this.graphqlServer;

    this.typesList = [];
    this.resolversList = [];

    this.active = false;
    this.types = null;
    this.resolvers = null;
    this.schema = null;
    this.graphqlServer = null;
    this.ready = null;
    this._handler = null;

    if (previous) {
      try {
        await previous.stop();
      } catch (error) {
        // The previous server is gone either way; the new one is what matters
        this.henri.pen.warn(
          'graphql',
          'unable to stop the previous apollo server',
          error.message
        );
        debug('error while stopping previous apollo server %O', error);
      }
    }

    return this.name;
  }

  /**
   * Stops the module
   *
   * @async
   * @returns {(string|boolean)} Module name or false
   * @memberof Graphql
   */
  async stop() {
    if (this.graphqlServer) {
      const server = this.graphqlServer;

      this.graphqlServer = null;
      this._handler = null;
      this.ready = null;

      await server.stop();

      return this.name;
    }

    return false;
  }
}

module.exports = Graphql;
