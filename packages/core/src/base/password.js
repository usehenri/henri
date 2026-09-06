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
 *       "parallelism": 1,
 *       "binding": { "enabled": true, "allowUnbound": true }
 *     }
 *   }
 * }
 * ```
 *
 * ## Binding a hash to the row it belongs to
 *
 * A password hash is a value, and a value can be moved. An attacker who can
 * *write* the database but does not know the pepper cannot forge a hash, so
 * they do the next best thing: they take a hash whose password they already
 * know -- their own account's -- and copy it onto somebody else's row, or
 * onto a row they invented. The pepper does not see this coming, because the
 * pepper is global: the same key recomputes the same hash wherever the bytes
 * end up. The two defend different attacks. The pepper answers "you cannot
 * make a hash"; the binding answers "you cannot move one".
 *
 * The binding folds the record's `externalId` into the value that is hashed,
 * keyed by the pepper. A hash made for row A is then arithmetically useless
 * on row B.
 *
 * ### How, given argon2 has no associated data
 *
 * `@node-rs/argon2` (2.2.0) exposes `secret` and no `associatedData`: its
 * `Options` are `memoryCost`, `timeCost`, `outputLen`, `parallelism`,
 * `algorithm`, `version`, `secret` and `salt`, and that is all. `secret` is
 * already the pepper and must stay the pepper, so rotating one does not
 * disturb the other. The identity therefore goes into a keyed pre-hash, the
 * same shape `peppered()` has always used to give bcrypt a key it does not
 * have:
 *
 * ```
 * identityKey = HMAC-SHA256(pepper, "henri:password-binding:v1")
 * preimage    = HMAC-SHA256(identityKey, externalId || 0x00 || password)
 * stored      = "$henri-bound$v=1$" + argon2id(preimage, secret: pepper)
 * ```
 *
 * The derivation is domain separated so the identity key is not the pepper
 * itself, which is used raw as argon2's `secret` and as `peppered()`'s HMAC
 * key. The separator is a NUL, which no uuid contains, so `externalId` and
 * `password` cannot be slid past each other. The digest is 44 bytes of
 * base64, which also puts every bound bcrypt hash safely under bcrypt's 72
 * byte ceiling.
 *
 * **Without a pepper the binding is unkeyed**, and an attacker who can write
 * rows can recompute a bound hash for the row they are targeting as easily as
 * we can. It still stops the copy-the-bytes attack, and it costs nothing, so
 * it stays on -- but binding is only forgery-resistant with
 * `HENRI_PASSWORD_PEPPER` set. Set it.
 *
 * ### The marker
 *
 * `$henri-bound$v=1$`, in front of the hash, in the same column. It has to be
 * there: verification cannot *guess* whether to fold the identity in without
 * hashing twice and accepting whichever answer says yes, and "accept whichever
 * says yes" is precisely the hole this is meant to close. With the marker,
 * verification knows which preimage to build and computes exactly one hash,
 * so the binding costs no CPU and no wall clock.
 *
 * It is not a secret and does not pretend to be. Anyone reading the table can
 * see that a hash is bound; that tells them nothing they could not infer from
 * knowing which version of henri wrote it. What the marker is *not* is a
 * security boundary: see the residual risk below. It sorts before `$2` and
 * `$argon2`, cannot collide with either, survives a `varchar(255)` (the
 * longest bound hash is 114 characters against 255) and needs no migration.
 * `v=1` is there so a second construction can exist without guessing.
 *
 * ### What moves and what does not
 *
 * `externalId` is a uuid v7 the adapter generates *before* the insert (a
 * function `defaultValue` on Sequelize, a `default` on Mongoose and Drizzle),
 * so it is in hand at the moment a password is first hashed -- which the
 * numeric primary key is not, and that is the ordering problem that usually
 * kills this idea. After the insert it is immutable, and every adapter
 * enforces that rather than merely intending it:
 *
 * - Sequelize: `plugins.js` reverts it in `beforeUpdate` and deletes it from
 *   the attributes in `beforeBulkUpdate`.
 * - Mongoose: `immutable: true` on the path, which Mongoose also strips from
 *   `updateOne`, `updateMany` and `findOneAndUpdate`.
 * - Drizzle: `IMMUTABLE` in `model.js`, skipped from the values of every
 *   update.
 *
 * So a bound hash cannot be orphaned by ordinary application code. It can be
 * orphaned by `UPDATE users SET external_id = ...` in a SQL console, which is
 * the same person who could `UPDATE users SET password = ...` anyway.
 *
 * ### Existing hashes, and the day this ships
 *
 * Every hash written before this exists is unbound and has to keep verifying,
 * or upgrading henri would lock out every user at once. `allowUnbound`
 * (default `true`) is what allows that, and it is the same lever as the
 * pepper's `allowUnpeppered`. An unbound hash becomes bound on the owner's
 * next successful sign-in: `verifyPassword()` reports `stale`, and `rehash()`
 * in `4.user.js` writes it back bound, exactly the way a bcrypt hash becomes
 * argon2id. Nobody is asked to reset anything and nothing is migrated offline.
 *
 * What an operator should expect: the curve of "how many hashes are bound"
 * is the curve of "who has signed in since the upgrade". Most active users
 * inside a week, the long tail over a session lifetime. An account that never
 * signs in again is never bound, and stays that way forever. So the migration
 * does not end on its own, and `allowUnbound: false` is a decision an operator
 * makes -- it locks out everyone still unbound, which for a dormant account is
 * indistinguishable from deleting it. Count first:
 *
 * ```sql
 * SELECT count(*) FROM users WHERE password NOT LIKE '$henri-bound$%';
 * ```
 *
 * ### Threat model, precisely
 *
 * Defends: an attacker with database **write** access who knows a password
 * for one row and relocates its hash -- onto another user's row, onto a row
 * they inserted, or by restoring one row of an old backup over a new one. The
 * copied hash is bound to a uuid that is not the target's, so it does not
 * verify. Sign-in fails.
 *
 * Does not defend, and this is the honest part: an attacker who can write
 * anything they want can also write the `externalId`. Setting the victim's
 * `external_id` to the one the stolen hash is bound to makes the hash verify
 * again. What makes that harder rather than impossible: `external_id` is
 * UNIQUE, so the value has to be freed first by changing or deleting the row
 * it came from -- the attacker cannot keep their own account and clone it,
 * they have to damage a row, and that is a visible, auditable event rather
 * than a silent one. The same attacker can also strip the marker and write an
 * unbound hash; that is what `allowUnbound: false` shuts, and until it is off
 * the binding buys a shape of attack, not the class of it.
 *
 * Also does not defend: an attacker with database **read** access (that is
 * the pepper's job), an attacker who has the pepper (they can forge whatever
 * they like, bound or not), or anything at all above the database -- a stolen
 * session, an application bug that calls `setRoles()`, a compromised host.
 *
 * In one line: the pepper means write access is not enough to forge a hash,
 * and the binding means write access is not enough to move one. Neither is a
 * substitute for the database not being writable by strangers.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const debug = require('debug')('henri:password');

const { isUuid } = require('./external-id');

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

/**
 * What a hash bound to its row carries in front of it, in the same column.
 * Not a secret: it says which preimage to rebuild, so verification hashes
 * once instead of trying both.
 */
const BOUND = '$henri-bound$v=1$';

/**
 * Domain separation for the key the identity is folded in with. The pepper
 * itself is argon2's `secret` and `peppered()`'s HMAC key; the binding gets
 * its own derived key rather than a third use of the same bytes.
 */
const BINDING_INFO = 'henri:password-binding:v1';

/**
 * What separates the identity from the password inside the pre-hash. A uuid
 * contains no NUL, so no password can be slid across the boundary to collide
 * with another row's preimage.
 */
const BINDING_SEPARATOR = Buffer.from([0]);

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
 * from one row onto another: the same key recomputes it either way. That is
 * what the binding is for (see the top of this file); the two are different
 * defences and the binding is keyed by this. It is
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
 * Normalizes `config.user.password.binding`.
 *
 * `enabled` writes new hashes bound to the record they belong to, so a hash
 * copied onto another row stops verifying. `allowUnbound` keeps accepting the
 * hashes written before it, which is the only way an existing application can
 * adopt this without locking everybody out at once; they are written back
 * bound as their owners sign in. Turning it off ends the migration by refusing
 * whatever is left, so read the count before you do.
 *
 * @param {*} raw a boolean, `{ enabled, allowUnbound }`, or nothing
 * @returns {{enabled: boolean, allowUnbound: boolean}} the settings
 * @throws {TypeError} on any other shape
 */
function bindingConfig(raw) {
  if (typeof raw === 'undefined' || raw === null) {
    return { allowUnbound: true, enabled: true };
  }

  if (typeof raw === 'boolean') {
    return { allowUnbound: true, enabled: raw };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(
      'config.user.password.binding must be a boolean or an object ({ enabled, allowUnbound })'
    );
  }

  return {
    allowUnbound: raw.allowUnbound !== false,
    enabled: raw.enabled !== false,
  };
}

/**
 * The identity a hash may be bound to: the `externalId` of the record.
 *
 * Only a uuid is accepted, lowercased the way the adapters store it. A
 * primary key, an ObjectId, an empty string or an object are all "no
 * identity", which is what makes a model that opted out of `externalId`
 * (`options: { externalId: false }`) fall back to an unbound hash instead of
 * binding to something that could be reused on another row.
 *
 * @param {*} value an external id, or anything
 * @returns {?string} the lowercased uuid, or null
 */
function bindingIdentity(value) {
  return isUuid(value) ? value.toLowerCase() : null;
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
    binding: bindingConfig(raw.binding),
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
 * What `henri.user.encrypt()` throws when a password is being set where no
 * single record is in scope and the hash would have to be bound to one.
 *
 * A mass update (`User.update({}, { password })`, `updateMany`, a
 * `bulkWrite`) hands one value to an unknown number of rows. A bound hash
 * belongs to exactly one of them, so there is nothing honest to write:
 * binding whichever row happens to be first is wrong, and writing an unbound
 * hash instead would quietly reopen the hole binding exists to close -- a
 * mass update is, after all, exactly how an attacker with application access
 * would plant one. So it refuses, loudly, and says what to do instead.
 *
 * Wears the `ValidationError` shape every adapter uses, so a controller that
 * already handles `Model.create()` failures handles this one too.
 */
class PasswordBindingError extends Error {
  /**
   * @param {string} [detail] what the caller was doing
   * @param {string} [field='password'] the attribute the password was set on
   */
  constructor(detail = 'a mass update', field = 'password') {
    super(
      `cannot hash a password from ${detail}: the hash is bound to one record and this writes to an unknown number of them. Load the record and save it (user.update({ password }), user.save()), or set config.user.password.binding.enabled to false.`
    );

    this.name = 'ValidationError';
    this.code = 'password_binding_unresolved';
    this.errors = { [field]: { message: this.message } };
  }
}

/**
 * Whether a stored value carries the binding marker
 *
 * @param {*} hash the stored hash
 * @returns {boolean} true when it is bound to a record
 */
function isBound(hash) {
  return typeof hash === 'string' && hash.startsWith(BOUND);
}

/**
 * The hash itself, without the binding marker
 *
 * @param {*} hash the stored hash
 * @returns {*} the bcrypt or argon2 hash (the value untouched when unbound)
 */
function unbind(hash) {
  return isBound(hash) ? hash.slice(BOUND.length) : hash;
}

/**
 * The key the identity is folded in with: the pepper, domain separated so it
 * is not literally the bytes argon2 already takes as its `secret`.
 *
 * Without a pepper this is a constant, so the binding is unkeyed: it still
 * makes a hash useless on another row, but an attacker who can write rows can
 * recompute one. That is the documented degradation, not an oversight.
 *
 * @param {?Buffer} key the pepper, or null
 * @returns {Buffer} 32 bytes
 */
function identityKey(key) {
  return crypto
    .createHmac('sha256', key || Buffer.alloc(0))
    .update(BINDING_INFO, 'utf8')
    .digest();
}

/**
 * What argon2 or bcrypt actually hashes for a bound password: the identity
 * and the password under one key, so the result is arithmetically tied to the
 * record and cannot be recomputed without the pepper.
 *
 * Not a password hash on its own -- the digest below is what argon2id or
 * bcrypt then hashes properly, with a salt and a work factor.
 * codeql[js/insufficient-password-hash]
 *
 * @param {string} password the clear text password
 * @param {string} identity the record's externalId (a uuid)
 * @param {?Buffer} key the pepper, or null
 * @returns {string} the keyed digest
 */
function bindingDigest(password, identity, key) {
  return crypto
    .createHmac('sha256', identityKey(key))
    .update(identity, 'utf8')
    .update(BINDING_SEPARATOR)
    .update(password, 'utf8')
    .digest('base64');
}

/**
 * The identity a new hash should be bound to, or null when it should not be.
 *
 * Null whenever binding is off or no `externalId` is in hand, which is what
 * keeps a user model that opted out of the public identifier working exactly
 * as it did.
 *
 * @param {object} policy a policy built by passwordPolicy()
 * @param {*} identity the record's externalId, or nothing
 * @returns {?string} the identity to bind to, or null
 */
function bindingFor(policy, identity) {
  const binding = policy.binding || { enabled: false };

  return binding.enabled ? bindingIdentity(identity) : null;
}

/**
 * Hashes a password with the current parameters.
 *
 * The policy is *not* applied here: callers that are setting a password run
 * validatePassword() first, and the rehash-on-login path deliberately does
 * not, because that password already proved itself against the stored hash.
 *
 * With `binding.enabled` and an `externalId` in hand the hash is bound to
 * that record and carries the marker; without either it is written exactly as
 * it always was, byte for byte.
 *
 * @param {string} password the clear text password
 * @param {object} policy a policy built by passwordPolicy()
 * @param {*} [identity] the externalId of the record the hash belongs to
 * @returns {Promise<string>} the hash
 */
async function hashPassword(password, policy, identity = null) {
  const pepper = policy.pepper || { current: null };
  const bound = bindingFor(policy, identity);
  const hash = await hashWith(password, policy, pepper.current, bound);

  return bound ? `${BOUND}${hash}` : hash;
}

/**
 * Hashes with one specific pepper key (or none), bound or not
 *
 * @param {string} password the clear text password
 * @param {object} policy a policy built by passwordPolicy()
 * @param {?Buffer} key the pepper, or null
 * @param {?string} [identity=null] the record's externalId, or null
 * @returns {Promise<string>} the hash, without the binding marker
 */
async function hashWith(password, policy, key, identity = null) {
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

    // Unbound, argon2 hashes the password itself, as it always has. Bound, it
    // hashes the keyed digest of the identity and the password, because
    // @node-rs/argon2 has no associatedData to put the identity in and
    // `secret` is spoken for by the pepper.
    return argon.hash(
      identity ? bindingDigest(password, identity, key) : password,
      options
    );
  }

  // Bcrypt has no key input of its own, so the pepper is applied first. The
  // digest is 44 bytes of base64, which also sidesteps bcrypt's 72 byte
  // ceiling. A bound hash always goes through a digest, so it is always under
  // the ceiling whether or not a pepper is configured.
  return bcrypt.hash(
    identity ? bindingDigest(password, identity, key) : peppered(password, key),
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
 * @param {string} hash the stored hash, already stripped of its marker
 * @param {?Buffer} key the pepper, or null
 * @param {?string} [identity=null] the record's externalId when the hash is
 *   bound to it, null when it is not
 * @returns {Promise<boolean>} whether they match
 * @throws {Error} when the hash is argon2 and the binding is missing
 */
async function verifyWith(password, hash, key, identity = null) {
  if (ARGON2.test(hash)) {
    const argon = argon2();

    if (!argon) {
      throw new Error(
        'this password was hashed with argon2id but @node-rs/argon2 is not installed here; install it to verify existing hashes'
      );
    }

    try {
      return await argon.verify(
        hash,
        identity ? bindingDigest(password, identity, key) : password,
        key ? { secret: key } : {}
      );
    } catch (error) {
      // A malformed hash is not a match
      debug('argon2 verify failed: %s', error.message);

      return false;
    }
  }

  try {
    return await bcrypt.compare(
      identity
        ? bindingDigest(password, identity, key)
        : peppered(password, key),
      hash
    );
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
 * The marker says whether the hash is bound, so there is no guessing and no
 * second hash: a bound hash is only ever checked against the identity it
 * claims, and an unbound one exactly the way it was before binding existed.
 * `stale` is also true for an unbound hash when binding is on and an identity
 * is in hand, which is what makes the next sign-in write it back bound.
 *
 * @param {*} password the clear text password
 * @param {*} hash the stored hash
 * @param {object} [policy] a policy built by passwordPolicy()
 * @param {*} [identity] the externalId of the record the hash was read from
 * @returns {Promise<{ok: boolean, stale: boolean}>} the verdict
 * @throws {Error} when the hash is argon2 and the binding is missing, or when
 *   the hash is bound and no identity was given to check it against
 */
async function verifyPassword(password, hash, policy = {}, identity = null) {
  const given = typeof password === 'string' ? password : '';

  if (typeof hash !== 'string' || hash.length === 0) {
    return { ok: false, stale: false };
  }

  const binding = policy.binding || { allowUnbound: true, enabled: false };
  const bound = isBound(hash);
  const stored = unbind(hash);
  const who = bindingIdentity(identity);

  if (bound && !who) {
    // Silently answering "wrong password" here would be a mystery lockout:
    // the caller has a hash it cannot check and needs to be told so.
    throw new Error(
      'this password hash is bound to the record it belongs to and cannot be verified on its own; pass the user (henri.user.compare(password, user)) rather than the hash alone'
    );
  }

  if (!bound && binding.enabled && binding.allowUnbound === false) {
    // The migration is declared over: an unbound hash is no longer evidence
    // of anything, whoever wrote it
    debug('refused an unbound hash (binding.allowUnbound is off)');

    return { ok: false, stale: false };
  }

  // The marker decides, so there is no guessing: a bound hash is checked
  // against the identity it claims, an unbound one exactly the way it was
  // checked before binding existed
  const claim = bound ? who : null;
  // An unbound hash that could be bound is worth rewriting: this is what
  // makes rehash() bind it after a successful sign-in. A hash that is already
  // bound is current, and one we have no identity for cannot be bound at all.
  const unboundStale = !bound && binding.enabled && Boolean(who);
  const pepper = policy.pepper || { current: null, previous: [] };

  if (await verifyWith(given, stored, pepper.current, claim)) {
    return { ok: true, stale: unboundStale };
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
    if (await verifyWith(given, stored, key, claim)) {
      debug('verified under an older pepper; the hash will be written again');

      return { ok: true, stale: true };
    }
  }

  return { ok: false, stale: false };
}

/**
 * Whether a stored hash is below the current parameters and should be
 * written again after a successful sign-in.
 *
 * The binding marker is stripped first: a bound hash is still a bcrypt or an
 * argon2 hash underneath, and forgetting that would read every one of them as
 * "unknown format" and quietly stop upgrading their cost forever.
 *
 * @param {*} hash the stored hash
 * @param {object} policy a policy built by passwordPolicy()
 * @returns {boolean} true when it should be upgraded
 */
function needsRehash(hash, policy) {
  if (typeof hash !== 'string') {
    return false;
  }

  const stored = unbind(hash);
  const wanted = algorithmFor(policy);
  const argon = ARGON2.exec(stored);

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

  const bcryptHash = BCRYPT.exec(stored);

  if (bcryptHash) {
    return wanted === 'argon2id' || Number(bcryptHash[1]) < policy.bcryptRounds;
  }

  // An unknown format cannot be verified either; leave it alone
  return false;
}

module.exports = {
  ALGORITHMS,
  BOUND,
  DEFAULTS,
  FLOORS,
  PEPPER_ENV,
  PasswordBindingError,
  PasswordPolicyError,
  algorithmFor,
  argon2Available,
  bindingConfig,
  bindingIdentity,
  hashPassword,
  isBound,
  needsRehash,
  passwordPolicy,
  pepperConfig,
  unbind,
  validatePassword,
  verifyPassword,
};
