/**
 * Password policy and hashing.
 *
 * New passwords are hashed with argon2id when `@node-rs/argon2` resolves (it
 * is an optional dependency of `@usehenri/core`, prebuilt for every platform
 * Node runs on, with a wasm fallback) and with bcrypt otherwise. Both are
 * always accepted on the way in, so an application that has been storing
 * bcrypt hashes keeps working: a hash below the current parameters is
 * upgraded the next time its owner signs in successfully.
 *
 * The policy governs *setting* a password. Verifying one never applies it:
 * raising the minimum length must never lock out the users who are already
 * there.
 *
 * `config.user.password`:
 *
 * ```json
 * {
 *   "user": {
 *     "password": {
 *       "algorithm": "auto",
 *       "minLength": 12,
 *       "maxBytes": 72,
 *       "bcryptRounds": 12,
 *       "memoryCost": 19456,
 *       "timeCost": 2,
 *       "parallelism": 1
 *     }
 *   }
 * }
 * ```
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const debug = require('debug')('henri:password');

/**
 * Defaults, 2026.
 *
 * `bcryptRounds` matches Rails (`BCrypt::Engine.cost`) and Laravel
 * (`config/hashing.php`); the argon2id parameters are the OWASP Password
 * Storage Cheat Sheet's first recommendation (m=19MiB, t=2, p=1).
 * `maxBytes` is bcrypt's ceiling: it silently ignores everything past 72
 * bytes, so henri refuses the password instead of truncating it.
 */
const DEFAULTS = Object.freeze({
  algorithm: 'auto',
  bcryptRounds: 12,
  maxBytes: 72,
  memoryCost: 19456,
  minLength: 12,
  parallelism: 1,
  timeCost: 2,
});

/** Environment variable holding the pepper, kept out of the config files */
const PEPPER_ENV = 'HENRI_PASSWORD_PEPPER';

/** Nothing below this is accepted, whatever the configuration says */
const FLOORS = Object.freeze({ bcryptRounds: 10, minLength: 8 });

/** Cheap parameters, under NODE_ENV=test only */
const TEST = Object.freeze({ bcryptRounds: 4, memoryCost: 8192, timeCost: 1 });

const ALGORITHMS = Object.freeze(['auto', 'argon2id', 'bcrypt']);

/** `$2b$12$...` */
const BCRYPT = /^\$2[abxy]\$(\d{2})\$/;
/** `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` */
const ARGON2 = /^\$argon2(i|d|id)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/;

/** Resolution of `@node-rs/argon2`, memoized (`undefined` until attempted) */
let argon2Module;

/**
 * The argon2 binding, or null when it is not installed
 *
 * @returns {?object} the module or null
 */
function argon2() {
  if (typeof argon2Module === 'undefined') {
    try {
      argon2Module = require('@node-rs/argon2');
      debug('argon2 available');
    } catch (error) {
      argon2Module = null;
      debug('argon2 unavailable: %s', error.message);
    }
  }

  return argon2Module;
}

/**
 * Whether argon2id can be used on this machine
 *
 * @returns {boolean} available or not
 */
function argon2Available() {
  return argon2() !== null;
}

/**
 * A positive integer from the configuration, or the fallback
 *
 * @param {*} value the configured value
 * @param {number} fallback the default
 * @param {number} [floor=1] smallest value accepted
 * @returns {number} the value to use
 */
function positive(value, fallback, floor = 1) {
  const number = Number(value);

  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    return fallback;
  }

  return Math.max(floor, number);
}

/**
 * Normalizes the pepper.
 *
 * A pepper is a server-side key mixed into every hash. It lives outside the
 * database, so a stolen table cannot be cracked offline and a hash cannot be
 * forged for a password of the attacker's choosing. What it does *not* stop,
 * because the key is global rather than per row, is a valid hash being copied
 * from one row onto another: the same key recomputes it either way. It is
 * deliberately *not* `config.secret`: rotating the session secret (which
 * invalidates sessions and signed links, and is a thing applications do) must
 * never make a password unverifiable. Its own key, `HENRI_PASSWORD_PEPPER` or
 * `config.user.password.pepper`, and losing it means every peppered password
 * is gone for good.
 *
 * Rotation is why `previous` exists: both are accepted on the way in, and a
 * password that verified under an old one is written again under the current
 * one the next time its owner signs in. `allowUnpeppered` is the same
 * mechanism for adopting a pepper in the first place: hashes written before
 * it existed keep verifying, and are rewritten as their owners sign in. Turn
 * it off once none are left — until then, an attacker who can write to the
 * table can still plant an unpeppered hash of a password they know.
 *
 * @param {*} raw a string, `{ current, previous, allowUnpeppered }`, or nothing
 * @returns {{current: ?Buffer, previous: Array<Buffer>, allowUnpeppered: boolean}} the keys
 * @throws {TypeError} on any other shape
 */
function pepperConfig(raw) {
  const value =
    typeof raw === 'undefined' || raw === null ? process.env[PEPPER_ENV] : raw;

  if (typeof value === 'undefined' || value === null || value === '') {
    return { allowUnpeppered: true, current: null, previous: [] };
  }

  if (typeof value === 'string') {
    return {
      allowUnpeppered: true,
      current: Buffer.from(value, 'utf8'),
      previous: [],
    };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'config.user.password.pepper must be a string or an object ({ current, previous, allowUnpeppered })'
    );
  }

  if (typeof value.current !== 'string' || value.current.length === 0) {
    throw new TypeError(
      'config.user.password.pepper.current must be a non-empty string'
    );
  }

  return {
    allowUnpeppered: value.allowUnpeppered !== false,
    current: Buffer.from(value.current, 'utf8'),
    previous: []
      .concat(value.previous || [])
      .filter((key) => typeof key === 'string' && key.length > 0)
      .map((key) => Buffer.from(key, 'utf8')),
  };
}

/**
 * Normalizes `config.user.password`
 *
 * @param {object} [raw={}] the configured block
 * @param {object} [options={}] options
 * @param {boolean} [options.isTest=false] cheap parameters for the test suite
 * @returns {{algorithm: string, bcryptRounds: number, maxBytes: number, memoryCost: number, minLength: number, parallelism: number, timeCost: number}} the policy
 * @throws {TypeError} on an unknown algorithm, or when argon2id is pinned but missing
 */
function passwordPolicy(raw = {}, { isTest = false } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(
      'config.user.password must be an object ({ algorithm, minLength, maxBytes, bcryptRounds, memoryCost, timeCost, parallelism })'
    );
  }

  const algorithm =
    typeof raw.algorithm === 'string' ? raw.algorithm.toLowerCase() : 'auto';

  if (!ALGORITHMS.includes(algorithm)) {
    throw new TypeError(
      `config.user.password.algorithm must be one of ${ALGORITHMS.join(', ')}`
    );
  }

  if (algorithm === 'argon2id' && !argon2Available()) {
    throw new TypeError(
      'config.user.password.algorithm is "argon2id" but @node-rs/argon2 is not installed; install it or use "auto"'
    );
  }

  const defaults = isTest ? Object.assign({}, DEFAULTS, TEST) : DEFAULTS;
  // The suite hashes constantly; only the cost floor gives way, never the policy
  const floors = isTest
    ? Object.assign({}, FLOORS, { bcryptRounds: TEST.bcryptRounds })
    : FLOORS;

  const policy = {
    algorithm,
    pepper: pepperConfig(raw.pepper),
    // eslint-disable-next-line sort-keys
    bcryptRounds: positive(
      raw.bcryptRounds,
      defaults.bcryptRounds,
      floors.bcryptRounds
    ),
    maxBytes: positive(raw.maxBytes, defaults.maxBytes, 8),
    memoryCost: positive(raw.memoryCost, defaults.memoryCost, 8),
    minLength: positive(raw.minLength, defaults.minLength, floors.minLength),
    parallelism: positive(raw.parallelism, defaults.parallelism, 1),
    timeCost: positive(raw.timeCost, defaults.timeCost, 1),
  };

  if (policy.maxBytes < policy.minLength) {
    throw new TypeError(
      'config.user.password.maxBytes must be at least minLength'
    );
  }

  return policy;
}

/**
 * The algorithm a new hash is written with
 *
 * @param {object} policy a policy built by passwordPolicy()
 * @returns {string} `argon2id` or `bcrypt`
 */
function algorithmFor(policy) {
  if (policy.algorithm === 'bcrypt') {
    return 'bcrypt';
  }

  return argon2Available() ? 'argon2id' : 'bcrypt';
}

/**
 * Checks a password against the policy.
 *
 * Never throws and never applies to an existing password: this governs
 * setting one. `errors` carries a stable `code` so a form can write its own
 * copy, and a message so it does not have to.
 *
 * @param {*} password the clear text password
 * @param {object} policy a policy built by passwordPolicy()
 * @returns {{valid: boolean, errors: Array<{code: string, message: string}>, policy: {minLength: number, maxBytes: number}}} the verdict
 */
function validatePassword(password, policy) {
  const { maxBytes, minLength } = policy;
  const errors = [];

  if (typeof password !== 'string' || password.length === 0) {
    errors.push({
      code: 'missing',
      message: 'a password is required',
    });
  } else if (password.length < minLength) {
    errors.push({
      code: 'too_short',
      message: `must be at least ${minLength} characters`,
      minLength,
    });
  } else if (Buffer.byteLength(password, 'utf8') > maxBytes) {
    errors.push({
      code: 'too_long',
      maxBytes,
      message: `must be at most ${maxBytes} bytes`,
    });
  }

  return {
    errors,
    policy: { maxBytes, minLength },
    valid: errors.length === 0,
  };
}

/**
 * What `henri.user.encrypt()` throws when a password fails the policy.
 *
 * A password that is too short is the person mistyping a form, not a bug,
 * and the answer is a 422 next to the field. Every adapter rejects an
 * invalid write with a `ValidationError` carrying `errors` keyed by field,
 * and `henri.model.errors()` reads that shape, so this error wears it: a
 * controller that already handles `Model.create()` failures handles this one
 * without knowing it exists. `codes` keeps the stable identifiers of
 * `validatePassword()` (`missing`, `too_short`, `too_long`) for a client
 * that translates the message itself.
 */
class PasswordPolicyError extends Error {
  /**
   * @param {{errors: Array<{code: string, message: string}>, policy: object}} verdict what validatePassword() answered
   * @param {string} [field='password'] the attribute the password was set on
   */
  constructor(verdict, field = 'password') {
    const [first] = verdict.errors;

    super(first ? first.message : 'is invalid');

    this.name = 'ValidationError';
    this.codes = verdict.errors.map((entry) => entry.code);
    this.policy = verdict.policy;
    this.errors = { [field]: { message: this.message } };
  }
}

/**
 * Hashes a password with the current parameters.
 *
 * The policy is *not* applied here: callers that are setting a password run
 * validatePassword() first, and the rehash-on-login path deliberately does
 * not, because that password already proved itself against the stored hash.
 *
 * @param {string} password the clear text password
 * @param {object} policy a policy built by passwordPolicy()
 * @returns {Promise<string>} the hash
 */
async function hashPassword(password, policy) {
  const pepper = policy.pepper || { current: null };

  return hashWith(password, policy, pepper.current);
}

/**
 * Hashes with one specific pepper key (or none)
 *
 * @param {string} password the clear text password
 * @param {object} policy a policy built by passwordPolicy()
 * @param {?Buffer} key the pepper, or null
 * @returns {Promise<string>} the hash
 */
async function hashWith(password, policy, key) {
  if (algorithmFor(policy) === 'argon2id') {
    const argon = argon2();
    const options = {
      algorithm: argon.Algorithm.Argon2id,
      memoryCost: policy.memoryCost,
      parallelism: policy.parallelism,
      timeCost: policy.timeCost,
    };

    if (key) {
      options.secret = key;
    }

    return argon.hash(password, options);
  }

  // Bcrypt has no key input of its own, so the pepper is applied first. The
  // digest is 44 bytes of base64, which also sidesteps bcrypt's 72 byte
  // ceiling.
  return bcrypt.hash(
    peppered(password, key),
    await bcrypt.genSalt(policy.bcryptRounds)
  );
}

/**
 * What bcrypt actually hashes: the password, keyed by the pepper
 *
 * @param {string} password the clear text password
 * @param {?Buffer} key the pepper, or null
 * @returns {string} the password itself, or its keyed digest
 */
function peppered(password, key) {
  if (!key) {
    return password;
  }

  // Not a password hash: bcrypt takes no key, so the pepper is applied by
  // pre-hashing and the digest below is what bcrypt then hashes properly.
  // codeql[js/insufficient-password-hash]
  return crypto.createHmac('sha256', key).update(password).digest('base64');
}

/**
 * Verifies a password against a stored hash under one pepper key
 *
 * @param {string} password the clear text password
 * @param {string} hash the stored hash
 * @param {?Buffer} key the pepper, or null
 * @returns {Promise<boolean>} whether they match
 * @throws {Error} when the hash is argon2 and the binding is missing
 */
async function verifyWith(password, hash, key) {
  if (ARGON2.test(hash)) {
    const argon = argon2();

    if (!argon) {
      throw new Error(
        'this password was hashed with argon2id but @node-rs/argon2 is not installed here; install it to verify existing hashes'
      );
    }

    try {
      return await argon.verify(hash, password, key ? { secret: key } : {});
    } catch (error) {
      // A malformed hash is not a match
      debug('argon2 verify failed: %s', error.message);

      return false;
    }
  }

  try {
    return await bcrypt.compare(peppered(password, key), hash);
  } catch (error) {
    debug('bcrypt compare failed: %s', error.message);

    return false;
  }
}

/**
 * Verifies a password against a stored hash.
 *
 * Accepts both formats whatever the configured algorithm is, and applies no
 * policy: an existing password is never refused for being too short.
 *
 * When a pepper is configured, the current key is tried first, then the
 * `previous` ones, then no key at all unless `allowUnpeppered` is off —
 * which is what lets an application adopt or rotate a pepper without locking
 * anyone out. `stale` says the hash verified under something other than the
 * current key, so the caller writes it again.
 *
 * @param {*} password the clear text password
 * @param {*} hash the stored hash
 * @param {object} [policy] a policy built by passwordPolicy()
 * @returns {Promise<{ok: boolean, stale: boolean}>} the verdict
 * @throws {Error} when the hash is argon2 and the binding is missing
 */
async function verifyPassword(password, hash, policy = {}) {
  const given = typeof password === 'string' ? password : '';

  if (typeof hash !== 'string' || hash.length === 0) {
    return { ok: false, stale: false };
  }

  const pepper = policy.pepper || { current: null, previous: [] };

  if (await verifyWith(given, hash, pepper.current)) {
    return { ok: true, stale: false };
  }

  if (!pepper.current) {
    return { ok: false, stale: false };
  }

  const older = pepper.previous.slice();

  // Hashes written before the pepper existed, while the migration runs
  if (pepper.allowUnpeppered !== false) {
    older.push(null);
  }

  // Hashes written under an older key
  for (const key of older) {
    if (await verifyWith(given, hash, key)) {
      debug('verified under an older pepper; the hash will be written again');

      return { ok: true, stale: true };
    }
  }

  return { ok: false, stale: false };
}

/**
 * Whether a stored hash is below the current parameters and should be
 * written again after a successful sign-in
 *
 * @param {*} hash the stored hash
 * @param {object} policy a policy built by passwordPolicy()
 * @returns {boolean} true when it should be upgraded
 */
function needsRehash(hash, policy) {
  if (typeof hash !== 'string') {
    return false;
  }

  const wanted = algorithmFor(policy);
  const argon = ARGON2.exec(hash);

  if (argon) {
    const [, variant, version, memoryCost, timeCost, parallelism] = argon;

    if (wanted !== 'argon2id') {
      // Pinned back to bcrypt on purpose: leave the stronger hash alone
      return false;
    }

    return (
      variant !== 'id' ||
      Number(version) < 19 ||
      Number(memoryCost) < policy.memoryCost ||
      Number(timeCost) < policy.timeCost ||
      Number(parallelism) !== policy.parallelism
    );
  }

  const bcryptHash = BCRYPT.exec(hash);

  if (bcryptHash) {
    return wanted === 'argon2id' || Number(bcryptHash[1]) < policy.bcryptRounds;
  }

  // An unknown format cannot be verified either; leave it alone
  return false;
}

module.exports = {
  ALGORITHMS,
  DEFAULTS,
  FLOORS,
  PEPPER_ENV,
  PasswordPolicyError,
  algorithmFor,
  argon2Available,
  hashPassword,
  needsRehash,
  passwordPolicy,
  pepperConfig,
  validatePassword,
  verifyPassword,
};
