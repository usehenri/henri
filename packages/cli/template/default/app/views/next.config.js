// next.js configuration used by the henri react engine (Turbopack or webpack).
// Keep this file: it wires the components/, styles/, helpers/ and assets/
// aliases and henri's server-side rendering hooks.
//
// To extend the next.js config, export `{ next: (config) => config }` from
// config/next.js. A config/webpack.js exporting `{ webpack: (config) => config }`
// still works and switches the engine to webpack.
module.exports = require('@usehenri/react/engine/conf');
