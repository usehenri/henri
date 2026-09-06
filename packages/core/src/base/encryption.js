/**
 * Encrypted attributes: a field that is ciphertext in the database and a
 * plain string in the model.
 *
 * ```js
 * schema: {
 *   ssn: { encrypted: true, type: 'string' },
 *   email: { encrypted: { deterministic: true }, type: 'string' },
 * }
 * ```
 *
 * The application reads and writes `person.ssn` as the string it always
 * was; the column holds an envelope. This module is the envelope and the
 * keys, and nothing else: the adapters call it from their write and read
 * paths (`packages/*\/schema.js` and the model layers around them),
 * `1.encryption.js` is what holds it at runtime, and `base/rewrap.js` is
 * what walks the rows during a rotation.
 *
 * ## The key is not `config.secret`
 *
 * `config.secret` signs sessions and tokens. Rotating it logs everybody
 * out, which is a Tuesday; rotating it must never make a column
 * unreadable. So encryption has its own key, `config.encryption.keys`, and
 * its documented home is the file henri already has for a secret an
 * application must carry: `config/credentials/<env>.json.enc`, opened by
 * `HENRI_CREDENTIALS_KEY`. `henri credentials:edit` puts it there and
 * nothing else in the repository ever holds it.
 *
 * A key is 32 bytes as 64 hexadecimal characters -- what `openssl rand
 * -hex 32` prints, and what a credentials key already is.
 *
 * ## The envelope
 *
 *     henri:v1:r:9f3a1c07:AbCd...
 *     \___/ \/ \/ \______/ \_____/
 *       |    |  |     |       |
 *       |    |  |     |       iv | tag | ciphertext, base64url
 *       |    |  |     the first 8 hex of the key id
 *       |    |  the scheme: r randomised, d deterministic
 *       |    the envelope version
 *       henri
 *
 * A reader tells the four cases apart without a key:
 *
 * - it does not start with `henri:v1:` -- plaintext, or something else
 *   entirely (`HENRI_ENCRYPTION_PLAINTEXT`);
 * - the key id names no configured key -- the key that wrote it is gone,
 *   or has not been added back yet (`HENRI_ENCRYPTION_KEY_UNKNOWN`);
 * - the version or the scheme is not one this henri writes -- an older or
 *   a newer encoding (`HENRI_ENCRYPTION_UNREADABLE`);
 * - everything matches and the tag does not verify -- the bytes were
 *   changed (`HENRI_ENCRYPTION_UNREADABLE`).
 *
 * Three different answers for three different problems, which is the point
 * of putting the key id in the clear: "I cannot read this" and "somebody
 * edited this" are not the same incident.
 *
 * ## Keys, derivation and what is bound to what
 *
 * The configured key is never used as an AES key. Three subkeys come out
 * of it through HKDF-SHA256, so the randomised key, the deterministic key
 * and the key that derives a deterministic iv are independent:
 *
 * - `data:r`, the AES-256-GCM key of a randomised value;
 * - `data:d`, the AES-256-GCM key of a deterministic one;
 * - `iv`, the HMAC key a deterministic iv is derived with.
 *
 * The additional authenticated data of every value is
 * `henri:v1:<scheme>:<Model>.<field>`. A ciphertext therefore only opens
 * where it was written: moving `User.ssn` into `User.notes`, or into
 * `Invoice.ssn`, fails the tag. That is not a theoretical property -- an
 * application that lets one column be written from another, or a restore
 * that maps the wrong column, is exactly how a value ends up somewhere it
 * does not belong.
 *
 * What is **not** bound is the row. A ciphertext copied from Alice's row
 * onto Bob's row still opens. That is deliberate, and it is the difference
 * between this and `config.user.password.binding`: a password hash is a
 * credential, and moving it moves the ability to sign in, so it names its
 * row. A ciphertext is not a credential, the threat this feature answers
 * is a stolen dump, a backup or a read replica, and whoever can *write*
 * rows already has the application. Binding to the row would also mean a
 * value could not be copied by a legitimate migration, and would put the
 * primary key in the way of every bulk insert.
 *
 * ## Randomised or deterministic
 *
 * A randomised value gets 12 random bytes of iv, so writing the same
 * string twice produces two envelopes that share nothing. Nothing can
 * query it: `where: { ssn: '123' }` compares a string against an envelope
 * and matches nothing, quietly, which is the worst possible failure. So
 * henri refuses it rather than returning zero rows -- a randomised
 * encrypted field cannot be a `where`, cannot be `unique` and cannot be
 * `index`, and each of those is a boot or a query failure with a code.
 *
 * A deterministic value derives its iv from the plaintext, keyed:
 * `HMAC-SHA256(iv key, "<Model>.<field>\0<plaintext>")`. The same string
 * in the same field is byte for byte the same envelope, so an equality
 * lookup and a unique index work; the same string in another field is not,
 * because the context is inside the HMAC. What it costs is what
 * deterministic encryption always costs: whoever holds the dump can see
 * which rows share a value, and can confirm a guess by encrypting it --
 * if they also hold the key, in which case they had everything anyway.
 * Rails ships both and makes the application choose; so does henri, and
 * the consequence of the choice is a refusal rather than a silent empty
 * result.
 *
 * ## Length
 *
 * A 12 byte iv, a 16 byte tag and base64url add 20 characters of header
 * and a third: an encrypted `string` no longer fits in a `varchar(255)`.
 * A randomised field is stored as `text`, which every dialect has and
 * nothing indexes. A deterministic one has to stay indexable, and the
 * smallest ceiling among the four dialects is MySQL's 3072 byte index key
 * on `utf8mb4` (768 characters), so it is `varchar(700)` -- which leaves
 * {@link MAX_DETERMINISTIC_BYTES} bytes of plaintext, enough for an
 * address, a telephone number or a national identifier, and a validation
 * failure rather than a truncation when it is not.
 *
 * @module base/encryption
 */

const {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} = require('node:crypto');
const crypto = require('node:crypto');

const { fail } = require('./errors');

/** Authenticated cipher, and the lengths that go with it, in bytes */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** The envelope: `henri:v1:<scheme>:<key id>:<body>` */
const PREFIX = 'henri';
const VERSION = 'v1';
const SEPARATOR = ':';

/** How many hexadecimal characters of the key digest name a key */
const KEY_ID_LENGTH = 8;

/** The two schemes, by the letter that names them in an envelope */
const RANDOMISED = 'r';
const DETERMINISTIC = 'd';
const SCHEMES = Object.freeze([RANDOMISED, DETERMINISTIC]);

/** The label every derivation and every tag is bound to */
const DOMAIN = 'henri.encryption.v1';

/** The column an encrypted field is stored in, by scheme */
const DETERMINISTIC_LENGTH = 700;

/**
 * The longest plaintext a deterministic field may hold, in bytes.
 *
 * `varchar(700)` less the 20 character header, back through base64url and
 * less the iv and the tag: `(700 - 20) * 3 / 4 - 12 - 16`, rounded down to
 * something round. A value above it is a validation failure on the field,
 * the way a `maxLength` is, and never a truncated write.
 */
const MAX_DETERMINISTIC_BYTES = 480;

/** The henri schema types an encrypted field may declare */
const ENCRYPTABLE_TYPES = Object.freeze(['string', 'text']);

/** What an envelope starts with, and the only thing a reader may assume */
const ENVELOPE = new RegExp(`^${PREFIX}${SEPARATOR}[a-z0-9]+${SEPARATOR}`, 'u');

/** A full, well formed envelope */
const PARSED = new RegExp(
  `^${PREFIX}:(?<version>[a-z0-9]+):(?<scheme>[a-z]):(?<id>[0-9a-f]{${KEY_ID_LENGTH}}):(?<body>[A-Za-z0-9_-]+)$`,
  'u'
);

/** A key, as it is written in the configuration */
const KEY_PATTERN = /^[0-9a-f]{64}$/iu;

/**
 * A coded failure carrying what to do about it
 *
 * @param {string} code one of the catalogue's codes
 * @param {string} message what went wrong
 * @param {string} hint what to do about it
 * @returns {Error} the error to throw
 */
function refuse(code, message, hint) {
  const error = fail(code, message);

  error.hint = hint;

  return error;
}

/**
 * The name of a key: the first {@link KEY_ID_LENGTH} hexadecimal
 * characters of a digest of it under a fixed label.
 *
 * It travels in the clear inside every envelope, which is what lets a
 * reader say "the key that wrote this is not one I hold" instead of
 * "something is wrong". A digest of 32 random bytes gives nothing back:
 * there is no key to recover and nothing to compare a guess against.
 *
 * @param {Buffer} key the 32 byte key
 * @returns {string} the key id
 */
function keyIdOf(key) {
  return createHash('sha256')
    .update(`${DOMAIN}:id:`, 'utf8')
    .update(key)
    .digest('hex')
    .slice(0, KEY_ID_LENGTH);
}

/**
 * A key as bytes, refusing anything that is not one
 *
 * @param {*} raw the key, as it was configured
 * @param {string} source where it came from, for the message
 * @returns {Buffer} the key
 * @throws HENRI_ENCRYPTION_KEY_MALFORMED when it is not 64 hex characters
 */
function parseKey(raw, source) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();

  if (!KEY_PATTERN.test(text)) {
    throw refuse(
      'HENRI_ENCRYPTION_KEY_MALFORMED',
      `the encryption key from ${source} is not 64 hexadecimal characters`,
      'A key is what `openssl rand -hex 32` prints. Nothing about the value that arrived is repeated here on purpose: it may be a key with a typo in it, and a key does not belong in a log line'
    );
  }

  return Buffer.from(text, 'hex');
}

/**
 * A new key
 *
 * @returns {string} 64 hexadecimal characters
 */
function generateKey() {
  return randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * One of the three subkeys of a key
 *
 * HKDF-SHA256 with the domain as the salt and the purpose as the info, so
 * the randomised key, the deterministic key and the iv key of one
 * configured key are independent of each other: reading one of them tells
 * nothing about the other two, and none of them is the configured key.
 *
 * @param {Buffer} key the configured key
 * @param {string} purpose `data:r`, `data:d` or `iv`
 * @returns {Buffer} 32 bytes
 */
function subkey(key, purpose) {
  return Buffer.from(
    hkdfSync(
      'sha256',
      key,
      Buffer.from(DOMAIN, 'utf8'),
      Buffer.from(`${DOMAIN}:${purpose}`, 'utf8'),
      KEY_LENGTH
    )
  );
}

/**
 * The additional authenticated data of a value: the envelope's own header
 * and the field it belongs to.
 *
 * This is what stops a ciphertext being moved from one column to another:
 * the tag covers it, so `User.ssn` pasted into `Invoice.reference` does
 * not open, whatever the key.
 *
 * @param {string} scheme `r` or `d`
 * @param {string} context `<Model>.<field>`
 * @returns {Buffer} the AAD
 */
function aadOf(scheme, context) {
  return Buffer.from(
    [PREFIX, VERSION, scheme, context].join(SEPARATOR),
    'utf8'
  );
}

/**
 * The iv of a deterministic value: an HMAC of the field and the plaintext,
 * under a key derived from the configured one.
 *
 * Keyed on purpose. An iv derived with a public function would let anybody
 * holding the dump confirm a guessed plaintext without the key; keyed,
 * confirming a guess needs the key, and whoever has the key has the value.
 *
 * @param {Buffer} key the configured key
 * @param {string} context `<Model>.<field>`
 * @param {Buffer} plaintext the value
 * @returns {Buffer} 12 bytes
 */
function deterministicIv(key, context, plaintext) {
  return createHmac('sha256', subkey(key, 'iv'))
    .update(context, 'utf8')
    .update(Buffer.from([0]))
    .update(plaintext)
    .digest()
    .subarray(0, IV_LENGTH);
}

/**
 * Does this string look like something this module wrote?
 *
 * Loose on purpose: it answers "henri wrote this" and not "this is
 * valid", so a value that starts with the prefix and is broken is a
 * failure rather than a plaintext that happens to start with `henri:`.
 *
 * @param {*} value anything
 * @returns {boolean} true when it carries the envelope's prefix
 */
function isEnvelope(value) {
  return typeof value === 'string' && ENVELOPE.test(value);
}

/**
 * The parts of an envelope, without opening it
 *
 * @param {*} value a stored value
 * @returns {?{body: string, id: string, scheme: string, version: string}}
 *   the parts, or null when it is not a well formed envelope
 */
function parse(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = PARSED.exec(value);

  return match ? { ...match.groups } : null;
}

/**
 * The key id an envelope names, for the code that sorts rows by key
 * without holding one
 *
 * @param {*} value a stored value
 * @returns {?string} the key id, or null when it is not an envelope
 */
function keyIdIn(value) {
  const parts = parse(value);

  return parts ? parts.id : null;
}

/**
 * A keyring: the configured keys, the first of which writes.
 *
 * Rotation is the whole reason this is a list. `keys[0]` encrypts;
 * every key in the list decrypts, matched by the id in the envelope. An
 * operator adds the new key in front, deploys, runs `henri
 * encryption:rotate` until `henri encryption:status` reports nothing left
 * under the old id, and only then drops the old key. Dropping it earlier
 * is what makes a row unreadable, which is why the status exists.
 *
 * @class Keyring
 */
class Keyring {
  /**
   * Creates an instance of Keyring.
   *
   * @param {Array<{key: Buffer, source: string}>} keys the keys, primary first
   * @throws HENRI_ENCRYPTION_KEY_MALFORMED when two keys share an id
   * @memberof Keyring
   */
  constructor(keys = []) {
    this.entries = keys.map(({ key, source }) => ({
      id: keyIdOf(key),
      key,
      source,
    }));

    const seen = new Set();

    for (const entry of this.entries) {
      if (seen.has(entry.id)) {
        throw refuse(
          'HENRI_ENCRYPTION_KEY_MALFORMED',
          `two encryption keys are the same (${entry.id})`,
          'A rotation adds a *new* key in front of the old one; the same key twice rotates nothing. Generate one with `openssl rand -hex 32`'
        );
      }

      seen.add(entry.id);
    }
  }

  /**
   * Is there a key at all?
   *
   * @readonly
   * @returns {boolean} true when at least one key is configured
   * @memberof Keyring
   */
  get enabled() {
    return this.entries.length > 0;
  }

  /**
   * The key that writes
   *
   * @readonly
   * @returns {?object} the primary entry, or null
   * @memberof Keyring
   */
  get primary() {
    return this.entries[0] || null;
  }

  /**
   * The ids of every key, primary first. Ids only: no method of this class
   * ever hands key material out.
   *
   * @readonly
   * @returns {Array<string>} the ids
   * @memberof Keyring
   */
  get ids() {
    return this.entries.map((entry) => entry.id);
  }

  /**
   * The key of an id
   *
   * @param {string} id a key id
   * @returns {?object} the entry, or null when nothing holds that id
   * @memberof Keyring
   */
  find(id) {
    return this.entries.find((entry) => entry.id === id) || null;
  }

  /**
   * Where each key came from, for `henri encryption` to print. The source
   * is a name (`the credentials`, `HENRI_ENCRYPTION_KEYS`), never a value.
   *
   * @returns {Array<{id: string, primary: boolean, source: string}>} the keys
   * @memberof Keyring
   */
  describe() {
    return this.entries.map((entry, index) => ({
      id: entry.id,
      primary: index === 0,
      source: entry.source,
    }));
  }
}

/**
 * The keyring of a configuration
 *
 * @param {*} value what `config.encryption.keys` holds: a key, or a list
 * @param {string} [source='config.encryption.keys'] where it came from
 * @returns {Keyring} the keyring (empty when nothing is configured)
 * @throws HENRI_ENCRYPTION_KEY_MALFORMED on a key that is not one
 */
function keyringOf(value, source = 'config.encryption.keys') {
  const list = [value].flat().filter((entry) => entry !== null && entry !== '');

  return new Keyring(
    list
      .filter((entry) => typeof entry !== 'undefined')
      .map((entry, index) => ({
        key: parseKey(entry, list.length > 1 ? `${source}[${index}]` : source),
        source,
      }))
  );
}

/**
 * The scheme of a mark
 *
 * @param {*} mark what the field's `encrypted` holds
 * @returns {string} `r` or `d`
 */
function schemeOf(mark) {
  return mark && mark.deterministic === true ? DETERMINISTIC : RANDOMISED;
}

/**
 * Encrypts one value
 *
 * @param {string} value the plaintext
 * @param {object} options options
 * @param {Keyring} options.keyring the keys
 * @param {string} options.context `<Model>.<field>`
 * @param {boolean} [options.deterministic=false] the scheme
 * @param {object} [options.key] the key entry to write with (the primary)
 * @returns {string} the envelope
 * @throws HENRI_ENCRYPTION_NO_KEY when the keyring is empty
 * @throws HENRI_ENCRYPTION_TOO_LONG when a deterministic value is too long
 */
function encrypt(value, { context, deterministic = false, key, keyring }) {
  const entry = key || (keyring && keyring.primary);

  if (!entry) {
    throw refuse(
      'HENRI_ENCRYPTION_NO_KEY',
      `${context} is encrypted and this application has no encryption key`,
      'Put one in the credentials: `henri credentials:edit`, then { "encryption": { "keys": ["<openssl rand -hex 32>"] } }'
    );
  }

  const scheme = deterministic ? DETERMINISTIC : RANDOMISED;
  const plaintext = Buffer.from(String(value), 'utf8');

  if (deterministic && plaintext.length > MAX_DETERMINISTIC_BYTES) {
    throw refuse(
      'HENRI_ENCRYPTION_TOO_LONG',
      `${context} is ${plaintext.length} bytes and a deterministic encrypted field holds at most ${MAX_DETERMINISTIC_BYTES}`,
      `A deterministic field is stored in a varchar(${DETERMINISTIC_LENGTH}) so it can carry an index. Encrypt it randomised instead ({ encrypted: true }) if it never has to be looked up by value`
    );
  }

  const iv = deterministic
    ? deterministicIv(entry.key, context, plaintext)
    : randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    subkey(entry.key, `data:${scheme}`),
    iv
  );

  cipher.setAAD(aadOf(scheme, context));

  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return [
    PREFIX,
    VERSION,
    scheme,
    entry.id,
    Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url'),
  ].join(SEPARATOR);
}

/**
 * Decrypts one value.
 *
 * The three failures are three different codes, because they are three
 * different incidents: a key that is not here, an encoding henri does not
 * write, and bytes that do not verify.
 *
 * @param {string} value the envelope
 * @param {object} options options
 * @param {Keyring} options.keyring the keys
 * @param {string} options.context `<Model>.<field>`
 * @param {boolean} [options.deterministic=false] the scheme the field declares
 * @returns {string} the plaintext
 * @throws HENRI_ENCRYPTION_KEY_UNKNOWN when no configured key wrote it
 * @throws HENRI_ENCRYPTION_UNREADABLE on a bad envelope or a bad tag
 */
function decrypt(value, { context, deterministic = false, keyring }) {
  const parts = parse(value);

  if (!parts || parts.version !== VERSION || !SCHEMES.includes(parts.scheme)) {
    throw refuse(
      'HENRI_ENCRYPTION_UNREADABLE',
      `${context} does not hold an envelope this henri writes`,
      'The value starts like one and is not one: an encoding from a newer henri, or a column that was written by something else. Nothing was decoded, and nothing was written'
    );
  }

  const expected = deterministic ? DETERMINISTIC : RANDOMISED;

  if (parts.scheme !== expected) {
    throw refuse(
      'HENRI_ENCRYPTION_UNREADABLE',
      `${context} is declared ${expected === DETERMINISTIC ? 'deterministic' : 'randomised'} and the stored value is not`,
      'The scheme of a field cannot be changed under existing rows: `henri encryption:rotate` rewrites them, and it needs the old declaration to read them first'
    );
  }

  const entry = keyring && keyring.find(parts.id);

  if (!entry) {
    throw refuse(
      'HENRI_ENCRYPTION_KEY_UNKNOWN',
      `${context} was encrypted with the key ${parts.id}, which this application does not hold`,
      'Put that key back in config.encryption.keys -- it may be an old key that was dropped before `henri encryption:rotate` had finished. `henri encryption:status` says how many rows are still under each key'
    );
  }

  const raw = Buffer.from(parts.body, 'base64url');

  if (raw.length < IV_LENGTH + TAG_LENGTH) {
    throw refuse(
      'HENRI_ENCRYPTION_UNREADABLE',
      `${context} holds an envelope that is too short to be one`,
      'The stored value was truncated: a column that is narrower than the ciphertext it was given is the usual cause'
    );
  }

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      subkey(entry.key, `data:${parts.scheme}`),
      raw.subarray(0, IV_LENGTH)
    );

    decipher.setAAD(aadOf(parts.scheme, context));
    decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));

    return Buffer.concat([
      decipher.update(raw.subarray(IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // The cipher says the same thing for a changed byte and for a value
    // that belongs to another column, and its message says nothing
    // useful. Neither it nor any fragment of the value is echoed.
    throw refuse(
      'HENRI_ENCRYPTION_UNREADABLE',
      `${context} did not verify under the key ${parts.id}`,
      'The bytes were changed, or the value belongs to another field: the tag covers the model, the field and the scheme. Nothing was decoded'
    );
  }
}

module.exports = {
  ALGORITHM,
  DETERMINISTIC,
  DETERMINISTIC_LENGTH,
  DOMAIN,
  ENCRYPTABLE_TYPES,
  IV_LENGTH,
  KEY_ID_LENGTH,
  KEY_LENGTH,
  Keyring,
  MAX_DETERMINISTIC_BYTES,
  PREFIX,
  RANDOMISED,
  SCHEMES,
  TAG_LENGTH,
  VERSION,
  decrypt,
  encrypt,
  generateKey,
  isEnvelope,
  keyIdIn,
  keyIdOf,
  keyringOf,
  parse,
  parseKey,
  schemeOf,
};
