const { createHmac, randomBytes, timingSafeEqual } = require('crypto');

const { WebhookError, coded } = require('./errors');

/**
 * The signature henri puts on every delivery.
 *
 * ## What is followed, and what is not
 *
 * The scheme is **Standard Webhooks** (https://www.standardwebhooks.com),
 * the specification Svix wrote and a growing number of senders emit, and it
 * is followed to the byte: the three headers are `webhook-id`,
 * `webhook-timestamp` and `webhook-signature`, the signed content is
 * `id.timestamp.body`, the algorithm is HMAC-SHA256, the signature is
 * base64 with a `v1,` scheme prefix, and the secret is `whsec_` followed by
 * the base64 of the key. A receiver that already has a Standard Webhooks
 * library verifies henri with nothing written.
 *
 * That specification was picked over the two schemes most receivers have
 * seen, on the strength of what they leave out:
 *
 * - **GitHub** sends `X-Hub-Signature-256: sha256=<hex of hmac(body)>`. The
 *   body and nothing else is signed: no timestamp, so a captured request
 *   replays for as long as the secret lives, and no delivery id, so a
 *   receiver cannot tell a retry from a duplicate.
 * - **Shopify** sends `X-Shopify-Hmac-Sha256: <base64 of hmac(body)>`. Same
 *   omissions, and the encoding differs from GitHub's for the same
 *   algorithm, which is the single most common reason a hand-written
 *   verification fails on a genuine request.
 * - **Stripe** does have a timestamp: `Stripe-Signature: t=<seconds>,
 *   v1=<hex of hmac("t.body")>`, with several `v1=` during a secret
 *   rotation and a tolerance of five minutes. It is the scheme this one is
 *   closest to.
 *
 * Where henri differs from Stripe, and why:
 *
 * - the timestamp is its own header rather than a field inside the
 *   signature header, so a receiver reads the recency check without parsing
 *   the signature first;
 * - the **delivery id is part of the signed content**. Stripe re-signs a
 *   retry with a fresh timestamp and the event id only in the body, so
 *   deduplication means trusting the body before verifying it. henri keeps
 *   one `webhook-id` for every attempt of one delivery, signed, so
 *   "have I already processed this?" is answered from verified bytes;
 * - the signature is base64, not hex, because the specification says so.
 *
 * ## Replay protection is part of this, not an extra
 *
 * The timestamp is signed, so it cannot be moved without the key. It is the
 * moment of *this attempt*, not of the event: a delivery retried six hours
 * later carries a fresh timestamp and a fresh signature, and stays inside
 * the receiver's window. The event's own moment is in the signed body, as
 * `timestamp`. A receiver refuses anything outside `TOLERANCE` (five
 * minutes, Stripe's default and the one this package documents) and then
 * refuses a `webhook-id` it has already answered. Neither half is enough on
 * its own: the window bounds the replay, the id makes retries safe.
 *
 * ## Rotation
 *
 * Two things rotate, and the scheme identifier is what makes the second one
 * possible:
 *
 * - the **key**: an endpoint may hold several secrets at once, and every
 *   one of them signs, so a receiver has a window to install the new key
 *   (`henri webhooks:rotate --grace 24h`). Stripe does the same thing.
 * - the **scheme**: `v1` is HMAC-SHA256. A future asymmetric scheme is
 *   `v1a` in the specification, and a receiver that follows the advice
 *   below -- ignore every scheme you do not know -- keeps working while
 *   both are being sent.
 */

/** The scheme identifier of HMAC-SHA256, base64 */
const SCHEME = 'v1';

/** How a secret is written down, so a scanner can recognize one */
const PREFIX = 'whsec_';

/** How many bytes of key a generated secret carries */
const SECRET_BYTES = 32;

/** The shortest key this package will sign with (128 bits) */
const MIN_KEY_BYTES = 16;

/** The window a receiver should accept, in milliseconds */
const TOLERANCE = 300000;

/** The headers a delivery carries */
const HEADERS = {
  id: 'webhook-id',
  signature: 'webhook-signature',
  timestamp: 'webhook-timestamp',
};

/**
 * A new endpoint secret
 *
 * @returns {string} `whsec_` and the base64 of 32 random bytes
 */
const generate = () =>
  `${PREFIX}${randomBytes(SECRET_BYTES).toString('base64')}`;

/**
 * The key a secret carries
 *
 * The `whsec_` prefix is a label, not key material: it is stripped, and
 * what is left is base64 decoded. This is the step a hand-written verifier
 * forgets, so the documentation says it twice and this function is
 * exported.
 *
 * @param {string} secret An endpoint secret
 * @returns {Buffer} The key
 * @throws {Error} HENRI_WEBHOOK_INVALID_SECRET when it carries no key
 */
const keyOf = (secret) => {
  const text = String(secret || '');
  const encoded = text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text;
  const key = Buffer.from(encoded, 'base64');

  if (key.length < MIN_KEY_BYTES) {
    throw coded(
      'HENRI_WEBHOOK_INVALID_SECRET',
      `@usehenri/webhooks: a signing secret is "${PREFIX}" and the base64 of at least ${MIN_KEY_BYTES} bytes`,
      {
        hint: 'Let henri generate one: henri webhooks:rotate <id>',
      }
    );
  }

  return key;
};

/**
 * What is signed: the delivery id, the moment and the body, in that order
 *
 * The body is the bytes that are sent, never a re-serialization of them: a
 * signature is sensitive to a re-ordered key or a changed space, and a
 * receiver that parses before verifying has already lost.
 *
 * @param {object} delivery `id`, `timestamp` (unix seconds) and `body`
 * @returns {string} The signed content
 */
const content = ({ body, id, timestamp }) => `${id}.${timestamp}.${body}`;

/**
 * One signature
 *
 * @param {object} delivery `id`, `timestamp`, `body` and `secret`
 * @returns {string} `v1,<base64>`
 */
const signOne = ({ body, id, secret, timestamp }) =>
  `${SCHEME},${createHmac('sha256', keyOf(secret))
    .update(content({ body, id, timestamp }), 'utf8')
    .digest('base64')}`;

/**
 * The value of the `webhook-signature` header
 *
 * One signature per secret the endpoint holds, space delimited, which is
 * what the specification's `signature(s)` means and what makes a key
 * rotation invisible to a receiver that verifies them in turn.
 *
 * @param {object} delivery `id`, `timestamp`, `body` and `secrets`
 * @returns {string} The header value
 * @throws {WebhookError} NO_SECRET when the endpoint holds none
 */
const sign = ({ body, id, secrets, timestamp }) => {
  const keys = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);

  if (keys.length === 0) {
    throw new WebhookError(
      'HENRI_WEBHOOK_NO_SECRET',
      '@usehenri/webhooks: the endpoint holds no signing secret',
      {
        hint: 'Give it one with: henri webhooks:rotate <id>',
        retryable: false,
      }
    );
  }

  return keys
    .map((secret) => signOne({ body, id, secret, timestamp }))
    .join(' ');
};

/**
 * The headers of a delivery, signature included
 *
 * Nothing a receiver could route on is sent outside the signature: the
 * event type lives in the signed body, so an unsigned header cannot send a
 * handler down the wrong branch.
 *
 * @param {object} delivery `id`, `body`, `secrets`, `now` and `agent`
 * @returns {object} The headers, lowercased
 */
const headersFor = ({ agent, body, id, now = Date.now(), secrets }) => {
  const timestamp = Math.floor(now / 1000);

  return {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': agent || 'henri-webhooks',
    [HEADERS.id]: id,
    [HEADERS.signature]: sign({ body, id, secrets, timestamp }),
    [HEADERS.timestamp]: String(timestamp),
  };
};

/**
 * The signatures of a header value, unknown schemes dropped
 *
 * @param {string} value The `webhook-signature` header
 * @returns {Array<Buffer>} The digests carrying the `v1` scheme
 */
const parse = (value) =>
  String(value || '')
    .split(/\s+/u)
    .filter(Boolean)
    .map((entry) => entry.split(','))
    .filter(([scheme, digest]) => scheme === SCHEME && digest)
    .map(([, digest]) => Buffer.from(digest, 'base64'));

/**
 * Whether two digests are the same, in constant time
 *
 * @param {Buffer} left One digest
 * @param {Buffer} right The other
 * @returns {boolean} Whether they match
 */
const same = (left, right) =>
  left.length === right.length && timingSafeEqual(left, right);

/**
 * One header of a request, whatever shape the headers arrived in
 *
 * @param {(object|Function)} headers An object, or a `name => value`
 * @param {string} name The header name, lowercase
 * @returns {?string} The value
 */
const headerOf = (headers, name) => {
  if (typeof headers === 'function') {
    return headers(name) || null;
  }

  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const found =
    typeof headers.get === 'function' ? headers.get(name) : headers[name];

  return typeof found === 'undefined' || found === null ? null : String(found);
};

/**
 * Verifies a delivery, the way a receiver does
 *
 * The package that signs is the package that verifies, so the snippet in
 * the guide has something to be checked against: `__tests__/signature.spec.js`
 * runs the documented steps over what `headersFor()` produced.
 *
 * @param {object} options Options
 * @param {(string|Buffer)} options.body The raw body, as received
 * @param {(object|Function)} options.headers The request headers
 * @param {(string|Array<string>)} options.secret The endpoint secret(s)
 * @param {number} [options.tolerance=TOLERANCE] The window, in milliseconds
 * @param {number} [options.now] The moment to measure the window from
 * @returns {object} `{ ok, reason, id, timestamp }`
 */
const verify = ({
  body,
  headers,
  now = Date.now(),
  secret,
  tolerance = TOLERANCE,
}) => {
  const id = headerOf(headers, HEADERS.id);
  const stamp = headerOf(headers, HEADERS.timestamp);
  const signatures = parse(headerOf(headers, HEADERS.signature));
  const timestamp = Number(stamp);

  if (!id || !stamp || signatures.length === 0) {
    return { id, ok: false, reason: 'missing', timestamp: null };
  }

  if (!Number.isFinite(timestamp)) {
    return { id, ok: false, reason: 'timestamp', timestamp: null };
  }

  if (tolerance > 0 && Math.abs(now - timestamp * 1000) > tolerance) {
    return { id, ok: false, reason: 'stale', timestamp };
  }

  const raw = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  const expected = (Array.isArray(secret) ? secret : [secret])
    .filter(Boolean)
    .map((key) =>
      Buffer.from(
        createHmac('sha256', keyOf(key))
          .update(content({ body: raw, id, timestamp }), 'utf8')
          .digest('base64'),
        'base64'
      )
    );
  const matched = expected.some((digest) =>
    signatures.some((candidate) => same(candidate, digest))
  );

  return {
    id,
    ok: matched,
    reason: matched ? null : 'signature',
    timestamp,
  };
};

module.exports = {
  HEADERS,
  MIN_KEY_BYTES,
  PREFIX,
  SCHEME,
  SECRET_BYTES,
  TOLERANCE,
  content,
  generate,
  headersFor,
  keyOf,
  parse,
  sign,
  signOne,
  verify,
};
