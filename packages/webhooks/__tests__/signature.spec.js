const { createHmac, timingSafeEqual } = require('crypto');

const {
  HEADERS,
  SCHEME,
  TOLERANCE,
  content,
  generate,
  headersFor,
  keyOf,
  parse,
  sign,
  verify,
} = require('../src/signature');
const { thrown } = require('./thrown');

/** The window the guide tells a receiver to accept, in seconds */
const TOLERANCE_SECONDS = 300;

/**
 * The verification the guide tells a receiver to write, written out here
 * rather than imported, so what the documentation says and what the package
 * signs are compared instead of agreeing with themselves.
 *
 * This is a transcription of `website/src/content/docs/guides/webhooks.md`.
 *
 * @param {string} body The raw body, as received
 * @param {object} headers The request headers
 * @param {string} secret The endpoint secret
 * @returns {boolean} Whether the delivery is genuine and recent
 */
const documented = (body, headers, secret) => {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];

  if (!id || !timestamp || !signatures) {
    return false;
  }

  // 1. recency: a signature that is valid and old is a replay
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) {
    return false;
  }

  // 2. the key is the base64 INSIDE the secret, not the secret string
  const key = Buffer.from(secret.replace(/^whsec_/u, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`, 'utf8')
    .digest();

  // 3. every `v1,` signature in the header; ignore the schemes you do not
  //    know, so a future one cannot downgrade you
  return signatures
    .split(' ')
    .filter((entry) => entry.startsWith('v1,'))
    .map((entry) => Buffer.from(entry.slice(3), 'base64'))
    .some(
      (candidate) =>
        candidate.length === expected.length &&
        timingSafeEqual(candidate, expected)
    );
};

describe('the signature scheme', () => {
  const secret = generate();
  const body = JSON.stringify({
    data: { total: 4200 },
    id: 'delivery-1',
    timestamp: '2026-09-06T12:00:00.000Z',
    type: 'invoice.paid',
  });

  test('a generated secret is whsec_ and 32 base64 bytes', () => {
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]+=*$/u);
    expect(keyOf(secret)).toHaveLength(32);
    // The label is not key material: it is stripped before the base64
    expect(keyOf(secret)).toEqual(keyOf(secret.replace('whsec_', '')));
  });

  test('a secret that carries no usable key is refused', async () => {
    expect(() => keyOf('whsec_short')).toThrow(/at least 16 bytes/u);
    expect(() => keyOf('')).toThrow(/at least 16 bytes/u);
    expect(await thrown(() => keyOf('whsec_short'))).toMatchObject({
      code: 'HENRI_WEBHOOK_INVALID_SECRET',
    });
  });

  test('the signed content is the id, the moment and the body', () => {
    expect(content({ body: 'x', id: 'a', timestamp: 7 })).toBe('a.7.x');
  });

  test('the headers are the three of the Standard Webhooks scheme', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });

    expect(Object.keys(headers).sort()).toEqual([
      'content-type',
      'user-agent',
      'webhook-id',
      'webhook-signature',
      'webhook-timestamp',
    ]);
    expect(headers[HEADERS.id]).toBe('delivery-1');
    expect(headers[HEADERS.signature]).toMatch(/^v1,[A-Za-z0-9+/]+=*$/u);
    expect(headers[HEADERS.timestamp]).toMatch(/^\d+$/u);
    // Nothing a receiver could route on is sent outside the signature: the
    // event type is in the signed body and nowhere else
    expect(JSON.stringify(headers)).not.toContain('invoice.paid');
  });

  test('the snippet the guide gives a receiver accepts what henri sends', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });

    expect(documented(body, headers, secret)).toBe(true);
    expect(verify({ body, headers, secret }).ok).toBe(true);
  });

  test('the snippet refuses a changed body, byte for byte', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });
    const tampered = body.replace('4200', '4201');

    expect(documented(tampered, headers, secret)).toBe(false);
    expect(verify({ body: tampered, headers, secret }).reason).toBe(
      'signature'
    );
    // Even re-serializing the same object breaks it, which is why the raw
    // body is what a receiver has to verify
    const reordered = JSON.stringify(JSON.parse(body), ['type', 'id', 'data']);

    expect(documented(reordered, headers, secret)).toBe(false);
  });

  test('the snippet refuses another endpoint secret', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });

    expect(documented(body, headers, generate())).toBe(false);
    expect(verify({ body, headers, secret: generate() }).ok).toBe(false);
  });

  test('a moved timestamp breaks the signature, and a stale one is refused', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });
    const moved = { ...headers, 'webhook-timestamp': '1' };

    // The timestamp is inside the signed content, so it cannot be moved
    expect(verify({ body, headers: moved, secret }).ok).toBe(false);

    const old = headersFor({
      body,
      id: 'delivery-1',
      now: Date.now() - TOLERANCE - 1000,
      secrets: [secret],
    });

    expect(verify({ body, headers: old, secret })).toMatchObject({
      ok: false,
      reason: 'stale',
    });
    // The signature itself is still good: it is the window that refuses it
    expect(verify({ body, headers: old, secret, tolerance: 0 }).ok).toBe(true);
    expect(documented(body, old, secret)).toBe(false);
  });

  test('a delivery id is signed, so a receiver deduplicates on verified bytes', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });

    expect(
      verify({
        body,
        headers: { ...headers, 'webhook-id': 'delivery-2' },
        secret,
      }).ok
    ).toBe(false);
  });

  test('a rotation signs with every secret that has not expired', () => {
    const older = generate();
    const headers = headersFor({
      body,
      id: 'delivery-1',
      secrets: [secret, older],
    });

    expect(parse(headers[HEADERS.signature])).toHaveLength(2);
    // A receiver that has installed either one accepts the delivery
    expect(documented(body, headers, secret)).toBe(true);
    expect(documented(body, headers, older)).toBe(true);
  });

  test('an endpoint with no secret is not signed with nothing', () => {
    expect(() => sign({ body, id: 'a', secrets: [], timestamp: 1 })).toThrow(
      /holds no signing secret/u
    );
  });

  test('a scheme a receiver does not know is ignored, not downgraded to', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });
    const withNoise = {
      ...headers,
      [HEADERS.signature]: `v0,ZGVhZGJlZWY= ${headers[HEADERS.signature]} v2,bm9wZQ==`,
    };

    expect(parse(withNoise[HEADERS.signature])).toHaveLength(1);
    expect(verify({ body, headers: withNoise, secret }).ok).toBe(true);
    expect(documented(body, withNoise, secret)).toBe(true);

    // And a header carrying only unknown schemes verifies nothing
    expect(
      verify({
        body,
        headers: { ...headers, [HEADERS.signature]: 'v0,ZGVhZGJlZWY=' },
        secret,
      })
    ).toMatchObject({ ok: false, reason: 'missing' });
  });

  test('a missing header is a refusal, not a crash', () => {
    expect(verify({ body, headers: {}, secret }).reason).toBe('missing');
    expect(verify({ body, headers: null, secret }).reason).toBe('missing');
    expect(
      verify({
        body,
        headers: {
          [HEADERS.id]: 'a',
          [HEADERS.signature]: 'v1,AAAA',
          [HEADERS.timestamp]: 'soon',
        },
        secret,
      }).reason
    ).toBe('timestamp');
  });

  test('a signature of the wrong length never reaches timingSafeEqual', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });

    expect(
      verify({
        body,
        headers: { ...headers, [HEADERS.signature]: `${SCHEME},AAAA` },
        secret,
      }).ok
    ).toBe(false);
  });

  test('the headers work with a Headers-like object and with a getter', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });
    const map = new Map(Object.entries(headers));

    expect(verify({ body, headers: map, secret }).ok).toBe(true);
    expect(verify({ body, headers: (name) => headers[name], secret }).ok).toBe(
      true
    );
  });

  test('a Buffer body verifies like the string it carries', () => {
    const headers = headersFor({ body, id: 'delivery-1', secrets: [secret] });

    expect(
      verify({ body: Buffer.from(body, 'utf8'), headers, secret }).ok
    ).toBe(true);
  });
});
