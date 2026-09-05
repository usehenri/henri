/**
 * Next.js configuration used by the henri react engine, for the current
 * working directory.
 *
 * `next build` reads it through the `app/views/next.config.js` file that
 * requires this module. That runs in worker processes where the `henri`
 * global does not exist, so it only relies on `process.cwd()` (henri changes
 * the working directory to the application root before loading the view
 * engine, and `build()` spawns `next build` from there).
 *
 * See ./nextConfig.js for what goes in.
 */
const { createNextConfig } = require('./nextConfig');

module.exports = createNextConfig(process.cwd());
