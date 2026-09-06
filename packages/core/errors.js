/**
 * The error codes henri raises: `require('@usehenri/core/errors')`.
 *
 * A package that raises a failure of its own -- the job queue, the testing
 * helper -- stamps it with one of the codes of `error-codes.json`, which sits
 * next to this file. It is the supported path, and the only one:
 * `@usehenri/core/src/base/errors` is where the file happens to live today
 * and may move.
 *
 * ```js
 * const { stamp } = require('@usehenri/core/errors');
 *
 * throw stamp(new Error('no such job'), 'HENRI_JOB_UNKNOWN');
 * ```
 */
module.exports = require('./src/base/errors');
