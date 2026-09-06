const Graphql = require('./src/graphql');

/**
 * GraphQL for henri.
 *
 * `@usehenri/core` resolves this package from the application directory the
 * way it resolves a store adapter, and exposes what it builds as
 * `henri.graphql`. An application that does not install it never loads
 * Apollo Server, and core says so the moment something asks for a query.
 *
 * @param {object} henri A henri instance
 * @returns {Graphql} The engine
 */
const create = (henri) => new Graphql(henri);

module.exports = create;
module.exports.Graphql = Graphql;
module.exports.create = create;
