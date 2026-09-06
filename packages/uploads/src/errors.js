/**
 * What a refused upload is.
 *
 * Every refusal is an `UploadError` carrying an HTTP status and a code, and
 * it reaches the client through `next(error)` -- core's error handler
 * negotiates it into the JSON shape a client expects or the page a browser
 * does, and its own logging quotes the request id. Nothing here writes a
 * response itself: an upload is refused in a middleware, and the middleware
 * that owns the answer is the one at the end of the chain.
 */

/** The codes a refusal carries, and the status each one answers with */
const CODES = {
  FIELD_NAME_TOO_LONG: 413,
  FILE_TOO_LARGE: 413,
  MALFORMED_MULTIPART: 400,
  TOO_MANY_FIELDS: 413,
  TOO_MANY_FILES: 413,
  TOTAL_TOO_LARGE: 413,
  TYPE_NOT_ALLOWED: 415,
  VALUE_TOO_LARGE: 413,
};

/**
 * A refused upload
 *
 * @class UploadError
 * @extends {Error}
 */
class UploadError extends Error {
  /**
   * Creates an instance of UploadError.
   *
   * @param {string} code one of `CODES`
   * @param {string} message what to tell the client
   * @param {object} [data={}] what to add to the answer (a field name, a limit)
   * @memberof UploadError
   */
  constructor(code, message, data = {}) {
    super(message);

    this.name = 'UploadError';
    this.code = code;
    this.status = CODES[code] || 400;
    this.statusCode = this.status;
    this.data = data;
  }
}

module.exports = { CODES, UploadError };
