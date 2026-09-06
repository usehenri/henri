/**
 * Per-account sign-in lockout.
 *
 * `base/rate-limit.js` bounds how many requests one address may send. It says
 * nothing about how many an account may receive, so a slow attempt spread
 * across many addresses against one account is unbounded. This bounds it:
 * after `max` consecutive failures the account refuses sign-in attempts for
 * the rest of the window, whoever is asking.
 *
 * Two things keep it from becoming an account-enumeration oracle:
 *
 * - failures are counted for whatever email was submitted, existing or not,
 *   so an attacker gets the same lockout for `nobody@example.com`;
 * - the answer is the same 429 either way, and carries no hint about the
 *   account.
 *
 * The counter is keyed by an HMAC of the normalized email under
 * `config.secret`, so the store never holds addresses. It is an
 * express-rate-limit store: in memory by default (per process, cleared on
 * restart, exactly like `config.rateLimit`), or a shared one through
 * `config.user.lockout.store`.
 */
const crypto = require('crypto');
const { MemoryStore } = require('express-rate-limit');
const debug = require('debug')('henri:lockout');

/**
 * Defaults: ten failures per account per fifteen minutes.
 *
 * Ten is roomy enough that a person fumbling a password manager never meets
 * it, and it caps a distributed attempt at 960 guesses a day per account
 * instead of none.
 */
const DEFAULTS = Object.freeze({ max: 10, windowMs: 15 * 60 * 1000 });

/**
 * Normalizes `config.user.lockout`
 *
 * @param {*} [raw] the configured block (`false` disables it)
 * @returns {?{max: number, windowMs: number, store: ?object}} the settings, or null when disabled
 * @throws {TypeError} when it is neither `false` nor an object
 */
function lockoutConfig(raw) {
  if (raw === false) {
    return null;
  }

  if (typeof raw === 'undefined' || raw === null) {
    return { max: DEFAULTS.max, store: null, windowMs: DEFAULTS.windowMs };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(
      'config.user.lockout must be false or an object ({ max, windowMs, store })'
    );
  }

  const max = Number(raw.max);
  const windowMs = Number(raw.windowMs);

  return {
    max: Number.isInteger(max) && max > 0 ? max : DEFAULTS.max,
    store:
      typeof raw.store === 'string' ||
      (raw.store && typeof raw.store === 'object')
        ? raw.store
        : null,
    windowMs:
      Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULTS.windowMs,
  };
}

/**
 * The lockout counter
 *
 * @class Lockout
 */
class Lockout {
  /**
   * @param {object} options options
   * @param {number} options.max failures allowed per window
   * @param {number} options.windowMs the window (ms)
   * @param {string} [options.secret] key of the HMAC hiding the emails
   * @param {object} [options.store] an express-rate-limit store
   */
  constructor({ max, windowMs, secret = '', store = null }) {
    this.max = max;
    this.windowMs = windowMs;
    this.secret = secret;
    this.store = store || new MemoryStore();

    if (typeof this.store.init === 'function') {
      this.store.init({ windowMs });
    }
  }

  /**
   * The key an email is counted under: an HMAC, so the store holds no
   * addresses even when it is shared with another service
   *
   * @param {string} email the normalized email
   * @returns {string} the key
   */
  key(email) {
    return `login:${crypto
      .createHmac('sha256', this.secret || 'henri')
      .update(String(email))
      .digest('hex')
      .slice(0, 32)}`;
  }

  /**
   * Seconds until the window rolls over
   *
   * @param {?{resetTime: Date}} info what the store answered
   * @returns {number} seconds, at least one
   */
  retryAfter(info) {
    const reset =
      info && info.resetTime instanceof Date ? info.resetTime : null;
    const seconds = reset
      ? Math.ceil((reset.getTime() - Date.now()) / 1000)
      : Math.ceil(this.windowMs / 1000);

    return Math.max(1, seconds);
  }

  /**
   * Reads a store answer.
   *
   * A window that has already rolled over is not a lockout, whether or not
   * the store has got around to clearing the entry.
   *
   * @param {?{totalHits: number, resetTime: Date}} info what the store answered
   * @returns {{locked: boolean, retryAfter: number}} the verdict
   */
  verdict(info) {
    const reset =
      info && info.resetTime instanceof Date ? info.resetTime : null;
    const expired = reset !== null && reset.getTime() <= Date.now();
    const locked = Boolean(info && info.totalHits >= this.max && !expired);

    return { locked, retryAfter: locked ? this.retryAfter(info) : 0 };
  }

  /**
   * Whether this account is currently refusing attempts. Called before the
   * password is hashed, so a locked account costs no CPU.
   *
   * @param {string} email the normalized email
   * @returns {Promise<{locked: boolean, retryAfter: number}>} the verdict
   */
  async check(email) {
    const info = await this.store.get(this.key(email));

    return this.verdict(info);
  }

  /**
   * Counts a failed attempt
   *
   * @param {string} email the normalized email
   * @returns {Promise<{locked: boolean, retryAfter: number}>} the verdict after counting
   */
  async fail(email) {
    const info = await this.store.increment(this.key(email));
    const verdict = this.verdict(info);

    if (verdict.locked) {
      debug('locked out after %d failures', info.totalHits);
    }

    return verdict;
  }

  /**
   * Clears the counter after a successful sign-in
   *
   * @param {string} email the normalized email
   * @returns {Promise<void>} nothing
   */
  async succeed(email) {
    await this.store.resetKey(this.key(email));
  }

  /**
   * Releases the store (the memory one holds an interval)
   *
   * @returns {void}
   */
  shutdown() {
    if (typeof this.store.shutdown === 'function') {
      this.store.shutdown();
    }
  }
}

module.exports = Lockout;
module.exports.DEFAULTS = DEFAULTS;
module.exports.lockoutConfig = lockoutConfig;
