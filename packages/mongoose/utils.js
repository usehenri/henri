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

/**
 * Builds the MongoDB connection url from the store configuration
 *
 * `url` wins; otherwise `host` (a hostname or a full mongodb:// url), `port`,
 * `database`, `username` and `password` are assembled.
 *
 * @param {object} [config={}] Store configuration
 * @returns {(string|null)} The url, or null when nothing is configured
 */
const buildUrl = (config = {}) => {
  const { database, host, password, pass, port, url, user, username } = config;

  if (url) {
    return url;
  }

  if (!host) {
    return null;
  }

  if (/^mongodb(\+srv)?:\/\//i.test(host)) {
    return host;
  }

  const login = username || user;
  const secret = password || pass;
  const auth = login
    ? `${encodeURIComponent(login)}${
        secret ? `:${encodeURIComponent(secret)}` : ''
      }@`
    : '';

  return `mongodb://${auth}${host}${port ? `:${port}` : ''}/${database || ''}`;
};

module.exports = { buildUrl, fatal, normalizeEmail, redact, redactUrl };
