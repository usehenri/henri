/**
 * Expansion of the config/routes.js keys into concrete routes.
 *
 * This is `@usehenri/core`'s own expansion (src/base/routes.js), re-exported
 * so `henri routes`, `henri doctor` and the generators read exactly the table
 * the router builds, without booting the server.
 */
const {
  VERBS,
  controllerOf,
  expand,
  expandEntry,
  singularize,
} = require('@usehenri/core/src/base/routes');

module.exports = { VERBS, controllerOf, expand, expandEntry, singularize };
