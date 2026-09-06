/**
 * The henri module this package ships.
 *
 * `package.json` points at this file with `"henri": { "module": "./module.js" }`,
 * which is all core reads: an application depending on `@usehenri/uploads`
 * has the module in its boot, as `henri.uploads`.
 */
module.exports = require('./src/module');
