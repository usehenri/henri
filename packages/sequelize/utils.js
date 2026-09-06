// Keys whose values must never reach the logs
const SECRET_KEYS = /^(pass(word)?|secret|token|auth)$/i;

/**
 * Masks the password of a connection url (user:secret@host -> user:***@host)
 *
 * @param {string} url A connection url
 * @returns {string} The url with its password masked
 */
const redactUrl = (url) =>
  url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^:/@]*):[^@]*@/i, '$1:***@');

/**
 * Returns a copy of a configuration value with credentials masked, for logs
 *
 * @param {*} value A configuration value (string, array or plain object)
 * @returns {*} The redacted copy
 */
const redact = (value) => {
  if (typeof value === 'string') {
    return redactUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.keys(value).reduce((copy, key) => {
      copy[key] = SECRET_KEYS.test(key) ? '***' : redact(value[key]);

      return copy;
    }, {});
  }

  return value;
};

/**
 * Normalizes an email the way the user model stores it
 *
 * @param {*} email An email
 * @returns {*} The trimmed, lowercased email (other values untouched)
 */
const normalizeEmail = (email) =>
  typeof email === 'string' ? email.trim().toLowerCase() : email;

/**
 * An Error carrying one of henri's error codes
 *
 * A code is a string and nothing more (`@usehenri/core/error-codes.json` is
 * the catalogue), so an adapter names its failures without depending on core.
 *
 * @param {string} code The henri error code (HENRI_MODEL_UNKNOWN_TYPE, ...)
 * @param {string} message What went wrong
 * @returns {Error} The error to throw
 */
const coded = (code, message) => Object.assign(new Error(message), { code });

/**
 * Logs a fatal error through henri's pen and returns the Error to throw
 *
 * @param {Henri} thisHenri Current henri instance
 * @param {string} name Adapter name
 * @param {string} message The error message
 * @param {?string} [code=null] The henri error code of this failure
 * @returns {Error} The error to throw
 */
const fatal = (thisHenri, name, message, code = null) => {
  const pen = thisHenri && thisHenri.pen;
  const args = code ? [name, message, null, null, code] : [name, message];
  const logged =
    pen && typeof pen.fatal === 'function' ? pen.fatal(...args) : null;

  return logged instanceof Error
    ? logged
    : (code && coded(code, message)) || new Error(message);
};

module.exports = { coded, fatal, normalizeEmail, redact, redactUrl };
