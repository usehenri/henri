/**
 * The henri module this package ships.
 *
 * `package.json` points at this file with `"henri": { "module": "./module.js" }`,
 * which is all core reads: an application depending on `@usehenri/webhooks`
 * has the module in its boot, as `henri.webhooks`.
 */
module.exports = require('./src/module');
