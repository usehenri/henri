/**
 * The failures of `@usehenri/testing`, by their henri error code.
 *
 * A code is a string and nothing more (`@usehenri/core/error-codes.json` is
 * the catalogue), so a failure names itself without importing anything --
 * which matters here, where core is resolved from the application and may
 * not be loadable at all.
 *
 * @module @usehenri/testing/errors
 */

/**
 * Put one of henri's error codes on an error
 *
 * @param {Error} error The error
 * @param {string} code The henri error code
 * @returns {Error} The same error
 */
const stamp = (error, code) => Object.assign(error, { code });

/**
 * The failure raised by anything that needs a running application
 *
 * @returns {Error} the error to throw
 */
const notRunning = () =>
  stamp(
    new Error(
      'henri is not running: `await setup()` in beforeAll, or add "@usehenri/testing/setup-file" to vitest setupFiles'
    ),
    'HENRI_BOOT_TESTING_NOT_RUNNING'
  );

module.exports = { notRunning, stamp };
