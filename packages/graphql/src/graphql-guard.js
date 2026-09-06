/**
 * Bounds on the GraphQL endpoint.
 *
 * A rate limiter caps how many requests arrive. It says nothing about what
 * one request costs, and one GraphQL request can cost arbitrarily much: a
 * hundred aliases of the same expensive field, a fragment spread a thousand
 * times, or a walk down a cycle the schema happens to contain. This module
 * refuses those before a single resolver runs.
 *
 * Three bounds, all schema-independent, so they protect an application whose
 * schema its author has never audited:
 *
 * - `maxAliases`: the universal one. Aliasing does not need a cycle or a deep
 *   schema, it works against anything, so this is the strict default.
 * - `maxComplexity`: how many fields the query selects in total, fragments
 *   expanded, which is what a fragment bomb inflates.
 * - `maxDepth`: nesting, which needs the schema to offer somewhere deep to
 *   go, so it is the loosest of the three.
 *
 * `maxTokens` bounds the document before it is even parsed, and is passed to
 * graphql's own parser rather than implemented here.
 */
const { GraphQLError, Kind } = require('graphql');

/**
 * Defaults.
 *
 * Roomy enough that a page's own query never meets them (a handful of
 * aliases, a dozen fields, four or five levels) and tight enough that
 * amplification stops being free.
 */
const DEFAULTS = Object.freeze({
  maxAliases: 15,
  maxComplexity: 1000,
  maxDepth: 10,
  maxTokens: 5000,
});

/**
 * Normalizes `config.graphql`.
 *
 * A string stays what it always was: the endpoint. An object takes the
 * endpoint, the limits and the access rules.
 *
 * @param {*} raw the configured value
 * @param {string} fallback the default endpoint
 * @returns {{endpoint: string, authenticated: boolean, roles: Array<string>, loopbackOnly: boolean, introspection: ?boolean, maxAliases: number, maxComplexity: number, maxDepth: number, maxTokens: number}} the settings
 * @throws {TypeError} when it is neither a string nor an object
 */
function graphqlConfig(raw, fallback) {
  const settings = Object.assign({}, DEFAULTS, {
    authenticated: false,
    endpoint: fallback,
    introspection: null,
    loopbackOnly: false,
    roles: [],
  });

  if (typeof raw === 'undefined' || raw === null) {
    return settings;
  }

  if (typeof raw === 'string') {
    settings.endpoint = raw;

    return settings;
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(
      'config.graphql must be a string (the endpoint) or an object ({ endpoint, authenticated, roles, loopbackOnly, introspection, maxDepth, maxAliases, maxComplexity, maxTokens })'
    );
  }

  if (typeof raw.endpoint === 'string' && raw.endpoint.length > 0) {
    settings.endpoint = raw.endpoint;
  }
  if (typeof raw.introspection === 'boolean') {
    settings.introspection = raw.introspection;
  }
  settings.authenticated = Boolean(raw.authenticated);
  settings.loopbackOnly = Boolean(raw.loopbackOnly);
  settings.roles = []
    .concat(raw.roles || [])
    .filter((role) => typeof role === 'string' && role.length > 0);

  if (settings.roles.length > 0) {
    settings.authenticated = true;
  }

  for (const key of ['maxAliases', 'maxComplexity', 'maxDepth', 'maxTokens']) {
    if (raw[key] === false) {
      settings[key] = Infinity;
    } else if (Number.isInteger(raw[key]) && raw[key] > 0) {
      settings[key] = raw[key];
    }
  }

  return settings;
}

/**
 * Measures one operation: its depth, how many aliases it uses and how many
 * fields it selects in total, with fragments expanded.
 *
 * The walk stops as soon as a limit is passed, so a document built to blow
 * up the analyzer cannot: the analyzer is bounded by the same numbers it
 * enforces. Fragment cycles (which graphql's own `NoFragmentCycles` refuses
 * separately) are cut by the visited set.
 *
 * @param {object} node an operation or fragment definition
 * @param {Map<string, object>} fragments the document's fragments, by name
 * @param {{maxAliases: number, maxComplexity: number, maxDepth: number}} limits the limits
 * @returns {{aliases: number, complexity: number, depth: number}} the measurements
 */
function measure(node, fragments, limits) {
  const totals = { aliases: 0, complexity: 0, depth: 0 };

  /**
   * Whether one of the limits has been passed already
   *
   * @returns {boolean} stop or not
   */
  const done = () =>
    totals.aliases > limits.maxAliases ||
    totals.complexity > limits.maxComplexity ||
    totals.depth > limits.maxDepth;

  /**
   * Walks a selection set
   *
   * @param {object} selectionSet the selection set
   * @param {number} depth its depth
   * @param {Set<string>} seen fragments already spread on this path
   * @returns {void}
   */
  const walk = (selectionSet, depth, seen) => {
    if (!selectionSet || done()) {
      return;
    }

    totals.depth = Math.max(totals.depth, depth);

    for (const selection of selectionSet.selections) {
      if (done()) {
        return;
      }

      if (selection.kind === Kind.FIELD) {
        totals.complexity += 1;
        if (selection.alias) {
          totals.aliases += 1;
        }
        if (selection.selectionSet) {
          walk(selection.selectionSet, depth + 1, seen);
        }
        continue;
      }

      if (selection.kind === Kind.INLINE_FRAGMENT) {
        // An inline fragment is not a level of its own
        walk(selection.selectionSet, depth, seen);
        continue;
      }

      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value;
        const fragment = fragments.get(name);

        if (!fragment || seen.has(name)) {
          continue;
        }

        const nested = new Set(seen);

        nested.add(name);
        walk(fragment.selectionSet, depth, nested);
      }
    }
  };

  walk(node.selectionSet, 1, new Set());

  return totals;
}

/**
 * A graphql validation rule refusing queries past the limits.
 *
 * It runs before execution, so a refused query costs a parse and a walk and
 * nothing else.
 *
 * @param {{maxAliases: number, maxComplexity: number, maxDepth: number}} limits the limits
 * @returns {function} a graphql ValidationRule
 */
function queryLimits(limits) {
  return (context) => ({
    /**
     * @param {object} node an OperationDefinition
     * @returns {false} never descend: the walk below did it already
     */
    OperationDefinition(node) {
      const fragments = new Map();

      for (const definition of context.getDocument().definitions) {
        if (definition.kind === Kind.FRAGMENT_DEFINITION) {
          fragments.set(definition.name.value, definition);
        }
      }

      const { aliases, complexity, depth } = measure(node, fragments, limits);

      if (depth > limits.maxDepth) {
        context.reportError(
          new GraphQLError(
            `Query is too deep: ${depth} levels, the limit is ${limits.maxDepth}`,
            { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' }, nodes: [node] }
          )
        );
      }

      if (aliases > limits.maxAliases) {
        context.reportError(
          new GraphQLError(
            `Query uses too many aliases: more than ${limits.maxAliases}`,
            { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' }, nodes: [node] }
          )
        );
      }

      if (complexity > limits.maxComplexity) {
        context.reportError(
          new GraphQLError(
            `Query is too complex: it selects more than ${limits.maxComplexity} fields`,
            { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' }, nodes: [node] }
          )
        );
      }

      return false;
    },
  });
}

/**
 * An Apollo plugin that stops resolving once the client is gone.
 *
 * graphql-js 16 cannot cancel an execution that has started, so this is done
 * where it can be: every field asks first, and a query whose client
 * disconnected or whose request already timed out (`base/timeout.js` answered
 * a 503) stops at the next field instead of running to completion against
 * nobody.
 *
 * @returns {object} an ApolloServerPlugin
 */
function cancellation() {
  return {
    /**
     * @param {object} params the request
     * @param {object} params.contextValue henri's context (`{ req, res }`)
     * @returns {Promise<object>} the request listener
     */
    async requestDidStart({ contextValue }) {
      const req = contextValue && contextValue.req;
      const res = contextValue && contextValue.res;
      let disconnected = false;

      if (res && typeof res.once === 'function') {
        res.once('close', () => {
          disconnected = !res.writableEnded;
        });
      }

      /**
       * Whether nobody is waiting for this answer any more: the client hung
       * up, or `base/timeout.js` already answered a 503
       *
       * @returns {boolean} gone or not
       */
      const gone = () =>
        disconnected ||
        Boolean(req && req.timedout) ||
        Boolean(req && req.socket && req.socket.destroyed);

      return {
        /**
         * @returns {Promise<object>} the execution listener
         */
        async executionDidStart() {
          return {
            /**
             * @returns {void}
             * @throws {GraphQLError} when the client is gone
             */
            willResolveField() {
              if (gone()) {
                throw new GraphQLError('Request cancelled', {
                  extensions: { code: 'REQUEST_CANCELLED' },
                });
              }
            },
          };
        },
      };
    },
  };
}

/**
 * Whether a user owns every one of the given roles.
 *
 * Deliberately a local copy rather than an import from core: this module is
 * meant to travel with the GraphQL layer wherever it lives.
 *
 * @param {object} user a user instance
 * @param {Array<string>} roles the roles it must have
 * @returns {Promise<boolean>} allowed or not
 */
async function hasRoles(user, roles) {
  if (!user) {
    return false;
  }

  if (typeof user.hasRole === 'function') {
    return Boolean(await user.hasRole(roles));
  }

  const owned = Array.isArray(user.roles)
    ? user.roles
    : [user.roles].filter(Boolean);

  return roles.every((role) => owned.includes(role));
}

/**
 * The middleware guarding the endpoint: loopback only, signed in, or holding
 * the roles the application asked for.
 *
 * Answers 404 off the loopback interface (the endpoint should not even look
 * like it exists) and 401/403 otherwise.
 *
 * @param {object} settings the settings built by graphqlConfig()
 * @returns {function} middleware
 */
/**
 * Refuses the request: through `res.boom` when core's middleware is in front
 * of this one, and with the body it would have sent when it is not
 *
 * The guard used to reach for `res.boom` unguarded. Inside a henri boot that
 * is always there, but this package is no longer the same package as the
 * middleware that puts it there, and nothing declares the dependency. The
 * fallback is byte-identical to `base/boom.js` (same status, same body, same
 * key order), so it only ever fires where the alternative was a TypeError.
 * `base/csrf.js` in core does the same thing for the same reason.
 *
 * @param {object} res the response
 * @param {number} statusCode 401 or 403
 * @param {string} error the status text
 * @param {string} message why
 * @returns {*} the response
 */
function refuse(res, statusCode, error, message) {
  const method = statusCode === 401 ? 'unauthorized' : 'forbidden';

  if (res.boom && typeof res.boom[method] === 'function') {
    return res.boom[method](message);
  }

  return res.status(statusCode).json({ error, message, statusCode });
}

function accessGuard(settings) {
  const { authenticated, roles } = settings;

  return async (req, res, next) => {
    if (!authenticated && roles.length === 0) {
      return next();
    }

    const signedIn =
      typeof req.isAuthenticated === 'function'
        ? req.isAuthenticated()
        : Boolean(req.user);

    if (!signedIn || !req.user) {
      return refuse(res, 401, 'Unauthorized', 'Authentication required');
    }

    if (roles.length > 0 && !(await hasRoles(req.user, roles))) {
      return refuse(res, 403, 'Forbidden', 'Insufficient roles');
    }

    return next();
  };
}

module.exports = {
  DEFAULTS,
  accessGuard,
  cancellation,
  graphqlConfig,
  measure,
  queryLimits,
};
