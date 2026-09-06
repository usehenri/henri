const utils = require('../utils');
const { stamp } = require('../base/errors');

/** What this failure is called (see base/errors.js) */
const CODE = 'HENRI_VIEW_INERTIA_UNAVAILABLE';

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
    global.henri.pen.fatal('view', message, null, null, CODE);
  }

  throw stamp(new Error(message, { cause: error }), CODE);
}

module.exports = Engine;
