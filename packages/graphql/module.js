/**
 * The henri module this package ships.
 *
 * `package.json` points at this file with `"henri": { "module": "./module.js" }`,
 * which is all core reads: an application depending on `@usehenri/graphql`
 * has the module in its boot, as `henri.graphql`.
 */
module.exports = require('./src/graphql');
