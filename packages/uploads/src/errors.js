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
  URL_EXPIRED: 403,
  URL_INVALID: 403,
  VALUE_TOO_LARGE: 413,
};

/**
 * The catalogue code a refusal also carries, where there is one.
 *
 * `error.code` is the short name a client reads next to the status, and
 * core's `coded()` looks at `henriCode` when `code` is not one of the
 * catalogue's -- the same arrangement an `ENOENT` gets. So a refusal can
 * keep the name it always had and still reach the JSON body, the log line
 * and `henri mcp` as `HENRI_UPLOAD_*`.
 */
const HENRI = {
  URL_EXPIRED: 'HENRI_UPLOAD_URL_EXPIRED',
  URL_INVALID: 'HENRI_UPLOAD_URL_INVALID',
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

    if (HENRI[code]) {
      this.henriCode = HENRI[code];
    }
  }
}

/**
 * A failure carrying one of the catalogue's codes and nothing else.
 *
 * The three lines a package that only peer-depends on core writes for
 * itself, the way `@usehenri/webhooks` and `@usehenri/s3` do: a code is a
 * string, so raising one imports nothing.
 *
 * @param {string} code a henri error code, from core's own catalogue
 * @param {string} message what went wrong
 * @param {object} [rest={}] `cause` and anything to carry on the error
 * @returns {Error} the error
 */
function coded(code, message, rest = {}) {
  const { cause, ...extra } = rest;
  const error = new Error(message, cause ? { cause } : undefined);

  error.code = code;
  Object.assign(error, extra);

  return error;
}

module.exports = { CODES, HENRI, UploadError, coded };
