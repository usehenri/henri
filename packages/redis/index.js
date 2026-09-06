/**
 * `@usehenri/redis`: the shared store `config.shared` names.
 *
 * ```json
 * { "shared": { "adapter": "redis", "url": "redis://127.0.0.1:6379" } }
 * ```
 *
 * Core resolves this package from the application (`utils.resolveFrom`) and
 * constructs the default export with the normalized block, the way it loads
 * a database adapter. See `packages/core/src/base/shared.js`.
 */
module.exports = require('./src/backend');
