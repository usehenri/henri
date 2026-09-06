/**
 * The base class of a henri module: `require('@usehenri/core/module')`.
 *
 * A package that ships a module (`"henri": { "module": "./module.js" }` in
 * its `package.json`) extends this. It is the supported path, and the only
 * one: `@usehenri/core/src/base/module` is where the file happens to live
 * today and may move.
 *
 * ```js
 * const BaseModule = require('@usehenri/core/module');
 *
 * module.exports = class Search extends BaseModule {
 *   constructor() {
 *     super({ after: ['model'], name: 'search' });
 *   }
 *
 *   async init() {
 *     this.henri.pen.info('search', 'ready');
 *   }
 * };
 * ```
 */
module.exports = require('./src/base/module');
