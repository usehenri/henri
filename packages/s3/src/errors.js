/**
 * What `@usehenri/s3` throws.
 *
 * Every one of them carries a code from henri's own catalogue
 * (`@usehenri/core/error-codes.json`), so an application branches on the
 * reason instead of matching a message. A code is a string and nothing
 * more: raising one imports nothing, which is what lets a package that only
 * peer-depends on core raise one at all. `@usehenri/webhooks` does the same
 * thing for the same reason.
 */

/**
 * A failure of the object store
 *
 * @class StorageError
 * @extends {Error}
 */
class StorageError extends Error {
  /**
   * Creates an instance of StorageError.
   *
   * @param {string} code A henri error code (ex: HENRI_UPLOAD_STORAGE_FAILED)
   * @param {string} message What went wrong
   * @param {object} [options={}] `cause` and anything to carry on the error
   * @memberof StorageError
   */
  constructor(code, message, options = {}) {
    const { cause, ...rest } = options;

    super(message, cause ? { cause } : undefined);

    this.name = 'StorageError';
    this.code = code;
    Object.assign(this, rest);
  }
}

/**
 * A coded error, in one call
 *
 * @param {string} code A henri error code
 * @param {string} message What went wrong
 * @param {object} [rest={}] `cause` and anything to carry
 * @returns {StorageError} the error
 */
const coded = (code, message, rest = {}) =>
  new StorageError(code, message, rest);

module.exports = { StorageError, coded };
