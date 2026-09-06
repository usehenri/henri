const {
  MAX_EXPIRES,
  canonicalQuery,
  encode,
  presign,
  sign,
} = require('../src/signature');

/**
 * The credentials of AWS's own worked examples.
 *
 * They are published, they are not anybody's, and they are what makes the
 * vectors below vectors: the signature of a request signed with these keys
 * is a number AWS printed, not one this file agreed with itself about.
 */
const CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

/** The moment every example is signed at */
const NOW = new Date('2013-05-24T00:00:00Z');

describe('the vectors AWS publishes', () => {
  test('a presigned GET is the url from "Query Parameters" verbatim', () => {
    expect(
      presign({
        credentials: CREDENTIALS,
        expiresIn: 86400,
        host: 'examplebucket.s3.amazonaws.com',
        now: NOW,
        origin: 'https://examplebucket.s3.amazonaws.com',
        path: '/test.txt',
        region: 'us-east-1',
      })
    ).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt' +
        '?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z' +
        '&X-Amz-Expires=86400' +
        '&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'
    );
  });

  test('a GET with a Range is the signature from "Authorization Header"', () => {
    const headers = sign({
      credentials: CREDENTIALS,
      headers: { range: 'bytes=0-9' },
      host: 'examplebucket.s3.amazonaws.com',
      method: 'GET',
      now: NOW,
      path: '/test.txt',
      payload:
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
    });

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    );
  });
});

describe('what a signature covers', () => {
  /**
   * The same presigned url, with one thing changed
   *
   * @param {object} [changes={}] what to change
   * @returns {string} the url
   */
  const url = (changes = {}) =>
    presign(
      Object.assign(
        {
          credentials: CREDENTIALS,
          expiresIn: 300,
          host: 'bucket.s3.amazonaws.com',
          now: NOW,
          origin: 'https://bucket.s3.amazonaws.com',
          path: '/2026/09/0123456789abcdef0123456789abcdef.png',
          region: 'us-east-1',
        },
        changes
      )
    );

  /**
   * The signature of a url
   *
   * @param {string} value the url
   * @returns {string} the hexadecimal signature
   */
  const signatureOf = (value) =>
    new URL(value).searchParams.get('X-Amz-Signature');

  test('the key: one object is not another', () => {
    expect(signatureOf(url())).not.toBe(
      signatureOf(
        url({ path: '/2026/09/fedcba9876543210fedcba9876543210.png' })
      )
    );
  });

  test('the window: a wider one is a different signature', () => {
    expect(signatureOf(url())).not.toBe(signatureOf(url({ expiresIn: 86400 })));
  });

  test('the moment: the same url tomorrow is a different signature', () => {
    expect(signatureOf(url())).not.toBe(
      signatureOf(url({ now: new Date('2013-05-25T00:00:00Z') }))
    );
  });

  test('the host: the same key at another endpoint is a different signature', () => {
    expect(signatureOf(url())).not.toBe(
      signatureOf(
        url({
          host: 'other.example.com',
          origin: 'https://other.example.com',
        })
      )
    );
  });

  test('the response overrides: a download is not an inline page', () => {
    expect(
      signatureOf(
        url({ query: { 'response-content-disposition': 'attachment' } })
      )
    ).not.toBe(
      signatureOf(url({ query: { 'response-content-disposition': 'inline' } }))
    );
  });

  test('the signature is the last parameter, and nothing signs it', () => {
    expect(url()).toMatch(/&X-Amz-Signature=[0-9a-f]{64}$/u);
  });
});

describe('the window a url may be given', () => {
  test.each([0, -1, MAX_EXPIRES + 1, 'soon', NaN, Infinity])(
    'refuses %p rather than writing a url the store will not honour',
    (expiresIn) => {
      expect(() =>
        presign({
          credentials: CREDENTIALS,
          expiresIn,
          host: 'bucket.s3.amazonaws.com',
          origin: 'https://bucket.s3.amazonaws.com',
          path: '/x.png',
          region: 'us-east-1',
        })
      ).toThrow(/between 1 and 604800 seconds/u);
    }
  );

  test('a week is the longest S3 honours, and it is accepted', () => {
    expect(
      presign({
        credentials: CREDENTIALS,
        expiresIn: MAX_EXPIRES,
        host: 'bucket.s3.amazonaws.com',
        origin: 'https://bucket.s3.amazonaws.com',
        path: '/x.png',
        region: 'us-east-1',
      })
    ).toContain('X-Amz-Expires=604800');
  });
});

describe('the canonical form', () => {
  test('encodes what encodeURIComponent leaves alone', () => {
    expect(encode("a!b'c(d)e*f")).toBe('a%21b%27c%28d%29e%2Af');
    expect(encode('a b')).toBe('a%20b');
    expect(encode('a/b')).toBe('a%2Fb');
    expect(encode('a/b', true)).toBe('a/b');
    expect(encode('aA0-_.~')).toBe('aA0-_.~');
  });

  test('sorts the query by name, and a repeated name by value', () => {
    // eslint-disable-next-line sort-keys
    expect(canonicalQuery({ b: '1', a: '2' })).toBe('a=2&b=1');
    expect(canonicalQuery({ a: ['2', '1'] })).toBe('a=1&a=2');
    expect(canonicalQuery({ a: undefined, b: null, c: '' })).toBe('c=');
  });

  test('sorts by bytes, so an uppercase name comes before a lowercase one', () => {
    // `localeCompare` puts `response-...` first, which is a signature of a
    // different request: MinIO answers SignatureDoesNotMatch and says
    // nothing about why
    expect(
      canonicalQuery({
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'response-content-disposition': 'inline',
      })
    ).toBe(
      'X-Amz-Algorithm=AWS4-HMAC-SHA256&response-content-disposition=inline'
    );
  });

  test('a signed response override is in the url, before the signature', () => {
    const url = presign({
      credentials: CREDENTIALS,
      expiresIn: 60,
      host: 'bucket.s3.amazonaws.com',
      now: NOW,
      origin: 'https://bucket.s3.amazonaws.com',
      path: '/x.png',
      query: { 'response-content-type': 'image/png' },
      region: 'us-east-1',
    });

    expect(url.indexOf('X-Amz-Algorithm')).toBeLessThan(
      url.indexOf('response-content-type')
    );
    expect(url).toMatch(/&X-Amz-Signature=[0-9a-f]{64}$/u);
  });

  test('a session token is signed with the rest', () => {
    const withToken = sign({
      credentials: Object.assign({ sessionToken: 'token' }, CREDENTIALS),
      host: 'bucket.s3.amazonaws.com',
      method: 'GET',
      now: NOW,
      path: '/x.png',
      payload: 'UNSIGNED-PAYLOAD',
      region: 'us-east-1',
    });

    expect(withToken['x-amz-security-token']).toBe('token');
    expect(withToken.authorization).toContain('x-amz-security-token');
  });
});
