/**
 * The errors `@usehenri/webhooks` throws.
 *
 * Every one of them carries a `code` from henri's own catalogue
 * (`@usehenri/core/error-codes.json`), so an application branches on the
 * reason instead of matching a message. A code is a string and nothing
 * more: raising one imports nothing.
 *
 * `retryable` is the other half. A delivery is a job, so a failure that the
 * queue should try again says so by staying silent (the default), and one
 * that a retry cannot fix -- a redirect, an address that must not be
 * reached, a receiver that answered `410 Gone` -- carries
 * `retryable: false`, which buries the job on the spot instead of spending
 * eight attempts to learn the same thing.
 */

/**
 * Base error of the package
 *
 * @class WebhookError
 * @extends {Error}
 */
class WebhookError extends Error {
  /**
   * Creates an instance of WebhookError.
   *
   * @param {string} code A henri error code (ex: HENRI_WEBHOOK_UNKNOWN)
   * @param {string} message What went wrong
   * @param {object} [options={}] `cause`, `retryable` and anything to carry
   * @memberof WebhookError
   */
  constructor(code, message, options = {}) {
    const { cause, ...rest } = options;

    super(message, cause ? { cause } : undefined);

    this.name = 'WebhookError';
    this.code = code;
    Object.assign(this, rest);
  }
}

/**
 * A url a delivery must not open
 *
 * The address is checked when the request is made and not when the endpoint
 * was registered, because DNS answers differently later: the name that
 * resolved to a public address yesterday resolves to 169.254.169.254 today,
 * and only the resolution that the request itself does is evidence.
 *
 * @class WebhookAddressError
 * @extends {WebhookError}
 */
class WebhookAddressError extends WebhookError {
  /**
   * Creates an instance of WebhookAddressError.
   *
   * @param {string} message What is wrong with the address
   * @param {object} [options={}] `url`, `address` and the usual options
   * @memberof WebhookAddressError
   */
  constructor(message, options = {}) {
    super('HENRI_WEBHOOK_ADDRESS_REFUSED', message, {
      retryable: false,
      ...options,
    });
    this.name = 'WebhookAddressError';
  }
}

/**
 * A receiver that answered something other than a 2xx
 *
 * @class WebhookDeliveryError
 * @extends {WebhookError}
 */
class WebhookDeliveryError extends WebhookError {
  /**
   * Creates an instance of WebhookDeliveryError.
   *
   * @param {string} message What the receiver said
   * @param {object} [options={}] `status`, `retryable` and the usual options
   * @memberof WebhookDeliveryError
   */
  constructor(message, options = {}) {
    super('HENRI_WEBHOOK_DELIVERY_FAILED', message, options);
    this.name = 'WebhookDeliveryError';
  }
}

/**
 * An Error carrying one of henri's error codes
 *
 * @param {string} code The henri error code
 * @param {string} message What went wrong
 * @param {object} [rest={}] Anything else to carry (`hint`, `retryable`)
 * @returns {Error} The error to throw
 */
const coded = (code, message, rest = {}) =>
  Object.assign(new Error(message), { code, ...rest });

module.exports = {
  WebhookAddressError,
  WebhookDeliveryError,
  WebhookError,
  coded,
};
