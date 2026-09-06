const {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} = require('crypto');

const { WebhookError } = require('./errors');
const { SCHEME, generate } = require('./signature');

/**
 * The signing secrets of an endpoint, and what protects them at rest.
 *
 * A signing secret is a bearer credential in both directions: whoever holds
 * it can forge a delivery the receiver will believe. It has to be readable
 * -- henri signs with it on every attempt, so it cannot be hashed the way a
 * password is -- which leaves encryption as the only thing that makes a
 * stolen database dump less than a forged delivery.
 *
 * So a secret is sealed with a key derived from `config.secret` (HKDF-
 * SHA256, one label, 32 bytes) and stored as AES-256-GCM. The row carries
 * the first bytes of the key's digest, so a `HENRI_SECRET` that changed is
 * reported as exactly that instead of failing to decrypt with a wall of
 * noise. An application without a `secret` -- there is one as soon as it has
 * users -- stores its secrets as they are, and the boot says so once.
 *
 * The consequence is worth writing down, because it is a real operational
 * trap: **rotating `HENRI_SECRET` makes every stored webhook secret
 * unreadable**. The fix is not to decrypt them, it is to rotate the
 * endpoints' own secrets (`henri webhooks:rotate <id>`) and hand the new
 * ones to the receivers. Rotate one, not the other, or rotate both in that
 * order.
 */

/** The label the endpoint key is derived under */
const LABEL = 'henri.webhooks.secret.v1';

/**
 * How a sealed value announces itself, and what separates its parts.
 *
 * A colon, not a dot: base64 has no colon in it, and the marker itself
 * carries a version so the format can change without guessing.
 */
const SEALED = 'henri-webhooks-v1';

/** The bytes of the derived key */
const KEY_BYTES = 32;

/** The bytes of a GCM nonce */
const IV_BYTES = 12;

/** How much of the key's digest names it in a row */
const KEY_ID = 8;

/**
 * The key an application seals its endpoint secrets with
 *
 * @param {?string} secret `config.secret`
 * @returns {?object} `{ id, key }`, or null without a secret
 */
const keyring = (secret) => {
  if (!secret) {
    return null;
  }

  const key = Buffer.from(
    hkdfSync('sha256', String(secret), 'henri.webhooks', LABEL, KEY_BYTES)
  );

  return {
    id: createHash('sha256').update(key).digest('hex').slice(0, KEY_ID),
    key,
  };
};

/**
 * Whether a stored value is sealed
 *
 * @param {string} value The stored value
 * @returns {boolean} Whether it was encrypted
 */
const isSealed = (value) => String(value || '').startsWith(`${SEALED}:`);

/**
 * Seals a secret for the database
 *
 * @param {string} value The secret
 * @param {?object} keys The keyring, or null to store it as it is
 * @returns {string} What goes in the row
 */
const seal = (value, keys) => {
  if (!keys) {
    return value;
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keys.key, iv);
  const sealed = Buffer.concat([
    cipher.update(String(value), 'utf8'),
    cipher.final(),
  ]);

  return [
    SEALED,
    keys.id,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    sealed.toString('base64'),
  ].join(':');
};

/**
 * Reads a secret back
 *
 * @param {string} value What the row holds
 * @param {?object} keys The keyring
 * @returns {string} The secret
 * @throws {WebhookError} SECRET_UNREADABLE when the key no longer opens it
 */
const open = (value, keys) => {
  if (!isSealed(value)) {
    return value;
  }

  const [, id, iv, tag, sealed] = String(value).split(':');

  if (!keys) {
    throw new WebhookError(
      'HENRI_WEBHOOK_SECRET_UNREADABLE',
      '@usehenri/webhooks: this endpoint secret is encrypted and the application has no "secret" to open it with',
      {
        hint: 'Set HENRI_SECRET back to what it was when the endpoint was registered',
        retryable: false,
      }
    );
  }

  if (id !== keys.id) {
    throw new WebhookError(
      'HENRI_WEBHOOK_SECRET_UNREADABLE',
      `@usehenri/webhooks: this endpoint secret was sealed with another key (${id}, not ${keys.id})`,
      {
        hint: 'HENRI_SECRET changed: put the old one back, or give the endpoint a new secret with `henri webhooks:rotate <id>` and hand it to the receiver',
        retryable: false,
      }
    );
  }

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keys.key,
      Buffer.from(iv, 'base64')
    );

    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(sealed, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new WebhookError(
      'HENRI_WEBHOOK_SECRET_UNREADABLE',
      '@usehenri/webhooks: this endpoint secret does not decrypt',
      {
        cause: error,
        hint: 'The row was changed after it was written, or the key it was sealed with is gone: rotate the endpoint secret',
        retryable: false,
      }
    );
  }
};

/**
 * A new secret record, ready to be stored
 *
 * @param {object} [options={}] `secret` (one of your own), `now`
 * @returns {object} `{ id, key, scheme, createdAt, expiresAt }`
 */
const fresh = (options = {}) => ({
  createdAt: options.now || Date.now(),
  expiresAt: null,
  id: randomUUID(),
  key: options.secret || generate(),
  scheme: SCHEME,
});

/**
 * The records that still sign, oldest expiry last
 *
 * @param {Array<object>} secrets The stored records
 * @param {number} [now=Date.now()] The moment
 * @returns {Array<object>} The records that have not expired
 */
const active = (secrets, now = Date.now()) =>
  (secrets || []).filter(
    (record) => !record.expiresAt || record.expiresAt > now
  );

/**
 * A rotation: a new record first, the old ones expiring after a grace
 *
 * Every record that has not expired keeps signing until it does, so a
 * receiver has the length of the grace to install the new secret without
 * dropping a delivery. A grace of zero retires the old secrets at once,
 * which is what a leak calls for.
 *
 * @param {Array<object>} secrets The stored records
 * @param {object} [options={}] `grace` (ms), `secret`, `now`
 * @returns {Array<object>} The records to store
 */
const rotate = (secrets, options = {}) => {
  const now = options.now || Date.now();
  const grace = Math.max(0, Number(options.grace) || 0);
  const next = fresh({ now, secret: options.secret });
  const kept = active(secrets, now).map((record) => ({
    ...record,
    expiresAt: Math.min(record.expiresAt || Infinity, now + grace),
  }));

  return grace === 0 ? [next] : [next, ...kept];
};

module.exports = {
  IV_BYTES,
  KEY_BYTES,
  KEY_ID,
  LABEL,
  SEALED,
  active,
  fresh,
  isSealed,
  keyring,
  open,
  rotate,
  seal,
};
