const utils = require('../utils');

/**
 * Inertia.js (Vite + React) engine, shipped by @usehenri/inertia and resolved
 * from the application so it pins its own version. The engine checks its
 * peer dependencies (react, react-dom, @inertiajs/react, vite) in init().
 */
let Engine;

try {
  Engine = require(
    utils.resolveFrom('@usehenri/inertia/engine', process.cwd())
  );
} catch (error) {
  const message = `unable to load '@usehenri/inertia' from the current project (${error.message}).

      Try installing it:

        # pnpm add @usehenri/inertia @inertiajs/react react react-dom vite @vitejs/plugin-react
      `;

  if (global.henri && global.henri.pen) {
    global.henri.pen.fatal('view', message);
  }

  throw new Error(message, { cause: error });
}

module.exports = Engine;
