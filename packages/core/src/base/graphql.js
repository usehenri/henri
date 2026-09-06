/**
 * What core says when an application asks for GraphQL without having it.
 *
 * The engine is a module of `@usehenri/graphql`, which the application
 * installs itself; core carries none of it. Two things reach for it -- a
 * model declaring types and resolvers (`3.model.js`) and a render built from
 * a query (`5.router.js`) -- and both go through here, so neither renders a
 * page whose data is quietly missing.
 */

/** The package that carries the engine */
const PACKAGE = '@usehenri/graphql';

/**
 * `henri.graphql`, or a readable error
 *
 * @param {object} henri the henri instance
 * @param {string} asked what asked for it, named in the error
 * @returns {object} the graphql module
 * @throws when the application does not have `@usehenri/graphql`
 */
const engine = (henri, asked) => {
  if (henri.graphql) {
    return henri.graphql;
  }

  throw henri.pen.fatal(
    'graphql',
    `
      ${asked}, but ${PACKAGE} is not installed.
      Add it with: npm install ${PACKAGE}`,
    null,
    null,
    'HENRI_API_GRAPHQL_UNAVAILABLE'
  );
};

module.exports = { PACKAGE, engine };
