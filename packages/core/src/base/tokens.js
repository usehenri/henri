/**
 * Signed, purpose-scoped, expiring tokens.
 *
 * The token a password reset or an address confirmation travels with is not
 * stored anywhere: it carries what it claims and a signature over it. Three
 * things are inside that signature, which is what gives these tokens their
 * properties:
 *
 * - the **purpose** (`password-reset`, `confirmation`, ...), so a
 *   confirmation link can never be replayed as a password reset;
 * - the **expiry**, so an old link stops working on its own rather than
 *   because something remembered to expire it;
 * - a **seed**, the fingerprint of the state the action is about to change
 *   (the password hash for a reset, the address and its confirmation date
 *   for a confirmation). Performing the action changes that state, the seed
 *   moves with it, and every token minted against the old one stops
 *   verifying. That is what makes a token single use, and what makes a
 *   successful reset invalidate the links that were still in flight.
 *
 * Nothing token-shaped reaches the database, so a database leak hands over
 * no working links: forging one needs `config.secret`, which lives in the
 * environment or in the encrypted credentials. The other side of that coin
 * is that rotating the secret invalidates every link that has not been used
 * yet, which the configuration guide says where secrets are rotated.
 *
 * ```js
 * const token = mint({
 *   expiresIn: 3600000,
 *   purpose: 'password-reset',
 *   secret,
 *   seed: user.password,
 *   subject: user.externalId,
 * });
 *
 * const { ok } = verify({ purpose: 'password-reset', secret, seed, token });
 * ```
 */
const { stamp } = require('./errors');
const crypto = require('crypto');

/** The format the tokens are minted in; the first field of every token */
const VERSION = 'h1';

/** Longest token this module will even look at, in characters */
const MAX_LENGTH = 4096;

/**
 * The signing key: the application secret, stretched and domain separated so
 * it is never used raw and never collides with another use of it
 *
 * @param {string} secret the application secret (`config.secret`)
 * @returns {Buffer} a 32 byte key
 */
function keyOf(secret) {
  return crypto
    .createHash('sha256')
    .update(`henri.token.${VERSION} ${String(secret)}`)
    .digest();
}

/**
 * The signature of a token body
 *
 * The purpose and the seed are fed to the mac on their own, ahead of the
 * payload, so neither can be moved into another field of a forged token.
 *
 * @param {object} options what is signed
 * @param {string} options.body the encoded payload
 * @param {string} options.purpose the purpose of the token
 * @param {string} options.secret the application secret
 * @param {string} options.seed the fingerprint of the state being changed
 * @returns {Buffer} the mac
 */
function sign({ body, purpose, secret, seed }) {
  const fingerprint =
    seed === null || typeof seed === 'undefined' ? '' : String(seed);

  return crypto
    .createHmac('sha256', keyOf(secret))
    .update(VERSION)
    .update(' ')
    .update(String(purpose))
    .update(' ')
    .update(fingerprint)
    .update(' ')
    .update(body)
    .digest();
}

/**
 * Encodes an object as one url-safe field
 *
 * @param {object} value the payload
 * @returns {string} base64url of its json
 */
function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Decodes what encode() produced
 *
 * @param {string} value the field
 * @returns {?object} the payload, or null when it is not one
 */
function decode(value) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (error) {
    return null;
  }
}

/**
 * Mints a token
 *
 * @param {object} options the token
 * @param {*} [options.data] anything else the token carries (the new address
 *   of an email change, typically); it is signed, not encrypted
 * @param {number} options.expiresIn how long it is valid, in milliseconds
 * @param {number} [options.now] the current time
 * @param {string} options.purpose what the token allows
 * @param {string} options.secret the application secret
 * @param {string} options.seed the fingerprint of the state being changed
 * @param {string} options.subject who the token is about (a public id)
 * @returns {string} the token
 * @throws {TypeError} when the secret, the purpose or the subject is missing
 */
function mint({
  data = null,
  expiresIn,
  now = Date.now(),
  purpose,
  secret,
  seed,
  subject,
}) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw stamp(
      new TypeError('a token needs a secret to be signed with'),
      'HENRI_USER_TOKEN_INVALID'
    );
  }

  if (typeof purpose !== 'string' || purpose.length === 0) {
    throw stamp(
      new TypeError('a token needs a purpose'),
      'HENRI_USER_TOKEN_INVALID'
    );
  }

  if (typeof subject !== 'string' || subject.length === 0) {
    throw stamp(
      new TypeError('a token needs a subject'),
      'HENRI_USER_TOKEN_INVALID'
    );
  }

  const payload = { exp: now + Number(expiresIn), pur: purpose, sub: subject };

  if (data !== null && typeof data !== 'undefined') {
    payload.dat = data;
  }

  const body = encode(payload);
  const mac = sign({ body, purpose, secret, seed });

  return `${VERSION}.${body}.${mac.toString('base64url')}`;
}

/**
 * Reads the claims of a token without verifying anything.
 *
 * The answer is attacker controlled: it is only good enough to find the
 * account the token is about, so that account's seed can be computed and the
 * signature checked.
 *
 * @param {string} token the token
 * @returns {?{data: *, expiresAt: number, purpose: string, subject: string}} the claims, or null
 */
function peek(token) {
  if (typeof token !== 'string' || token.length > MAX_LENGTH) {
    return null;
  }

  const parts = token.split('.');

  if (parts.length !== 3 || parts[0] !== VERSION) {
    return null;
  }

  const payload = decode(parts[1]);

  if (
    !payload ||
    typeof payload.pur !== 'string' ||
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0 ||
    !Number.isFinite(payload.exp)
  ) {
    return null;
  }

  return {
    data: typeof payload.dat === 'undefined' ? null : payload.dat,
    expiresAt: payload.exp,
    purpose: payload.pur,
    subject: payload.sub,
  };
}

/**
 * Verifies a token against a purpose and the seed of the account it names
 *
 * @param {object} options the check
 * @param {number} [options.now] the current time
 * @param {string} options.purpose the purpose the caller expects
 * @param {string} options.secret the application secret
 * @param {string} options.seed the fingerprint of the state being changed
 * @param {string} options.token the token
 * @returns {{ok: boolean, payload: ?object, reason: ?string}} `reason` is
 *   `malformed`, `purpose`, `signature` or `expired`
 */
function verify({ now = Date.now(), purpose, secret, seed, token }) {
  const claims = peek(token);

  if (!claims) {
    return { ok: false, payload: null, reason: 'malformed' };
  }

  if (claims.purpose !== purpose) {
    return { ok: false, payload: null, reason: 'purpose' };
  }

  const [, body, mac] = token.split('.');
  const expected = sign({ body, purpose, secret, seed });
  const given = Buffer.from(mac, 'base64url');

  if (
    given.length !== expected.length ||
    !crypto.timingSafeEqual(given, expected)
  ) {
    return { ok: false, payload: null, reason: 'signature' };
  }

  if (claims.expiresAt <= now) {
    return { ok: false, payload: null, reason: 'expired' };
  }

  return { ok: true, payload: claims, reason: null };
}

module.exports = { MAX_LENGTH, VERSION, mint, peek, verify };
