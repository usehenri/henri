/**
 * The errors `@usehenri/jobs` throws.
 *
 * Every one of them carries a `code`, so an application (or a test) can
 * branch on the reason instead of matching the message. The codes are
 * henri's own, from the catalogue of `@usehenri/core/error-codes.json`: a
 * code is a string, so nothing is imported to raise one.
 */

/**
 * Base error of the package
 *
 * @class JobError
 * @extends {Error}
 */
class JobError extends Error {
  /**
   * Creates an instance of JobError.
   *
   * @param {string} code A henri error code (ex: HENRI_JOB_UNKNOWN)
   * @param {string} message What went wrong
   * @param {object} [options={}] `cause` and any extra property to carry
   * @memberof JobError
   */
  constructor(code, message, options = {}) {
    const { cause, ...rest } = options;

    super(message, cause ? { cause } : undefined);

    this.name = 'JobError';
    this.code = code;
    Object.assign(this, rest);
  }
}

/**
 * An argument that cannot be stored (a function, a bigint, a cycle, ...)
 *
 * @class JobArgumentError
 * @extends {JobError}
 */
class JobArgumentError extends JobError {
  /**
   * Creates an instance of JobArgumentError.
   *
   * @param {string} message What went wrong
   * @param {object} [options={}] `path` and the usual options
   * @memberof JobArgumentError
   */
  constructor(message, options = {}) {
    super('HENRI_JOB_INVALID_ARGUMENTS', message, options);
    this.name = 'JobArgumentError';
  }
}

/**
 * An attempt that ran past the job's timeout
 *
 * @class JobTimeoutError
 * @extends {JobError}
 */
class JobTimeoutError extends JobError {
  /**
   * Creates an instance of JobTimeoutError.
   *
   * @param {string} name The job name
   * @param {number} timeout The timeout in milliseconds
   * @memberof JobTimeoutError
   */
  constructor(name, timeout) {
    super('HENRI_JOB_TIMEOUT', `${name} timed out after ${timeout}ms`);
    this.name = 'JobTimeoutError';
    this.timeout = timeout;
  }
}

/**
 * A store that cannot back the queue
 *
 * @class JobStoreError
 * @extends {JobError}
 */
class JobStoreError extends JobError {
  /**
   * Creates an instance of JobStoreError.
   *
   * @param {string} message What went wrong
   * @param {object} [options={}] The usual options
   * @memberof JobStoreError
   */
  constructor(message, options = {}) {
    super('HENRI_JOB_UNSUPPORTED_STORE', message, options);
    this.name = 'JobStoreError';
  }
}

/**
 * An Error carrying one of henri's error codes
 *
 * A code is a string and nothing more (`@usehenri/core/error-codes.json` is
 * the catalogue), so a failure names itself without importing anything.
 *
 * @param {string} code The henri error code (HENRI_JOB_UNKNOWN, ...)
 * @param {string} message What went wrong
 * @returns {Error} The error to throw
 */
const coded = (code, message) => Object.assign(new Error(message), { code });

module.exports = {
  JobArgumentError,
  JobError,
  JobStoreError,
  JobTimeoutError,
  coded,
};
