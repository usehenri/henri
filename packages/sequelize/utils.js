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
 * Logs a fatal error through henri's pen and returns the Error to throw
 *
 * @param {Henri} thisHenri Current henri instance
 * @param {string} name Adapter name
 * @param {string} message The error message
 * @returns {Error} The error to throw
 */
const fatal = (thisHenri, name, message) => {
  const pen = thisHenri && thisHenri.pen;
  const logged =
    pen && typeof pen.fatal === 'function' ? pen.fatal(name, message) : null;

  return logged instanceof Error ? logged : new Error(message);
};

module.exports = { fatal, normalizeEmail, redact, redactUrl };
