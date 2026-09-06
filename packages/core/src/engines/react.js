const utils = require('../utils');
const { stamp } = require('../base/errors');

/** What the React (Next.js) renderer needs installed in the application */
const PACKAGES = ['@usehenri/react', 'next', 'react', 'react-dom'];

/** What this failure is called (see base/errors.js) */
const CODE = 'HENRI_VIEW_REACT_UNAVAILABLE';

let Engine;

try {
  Engine = require(
    utils.resolveFrom('@usehenri/react/engine/index', process.cwd())
  );
} catch (error) {
  const missing = utils.checkMissing(PACKAGES);
  const message = `unable to load the react renderer: ${error.message}`;
  const hint =
    missing.length > 0
      ? `Install the missing package${missing.length > 1 ? 's' : ''} in your application:

    ${utils.installCommand(missing)}
`
      : null;
  const inst = global.henri;
  const fatal =
    inst && inst.pen
      ? inst.pen.fatal('view', message, hint, null, CODE)
      : stamp(new Error(hint ? `${message}\n${hint}` : message), CODE);

  fatal.cause = error;

  throw fatal;
}

module.exports = Engine;
