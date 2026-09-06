const supertest = require('supertest');

const { MAX_EXPIRES, UrlSigner } = require('../src/signing');
const { PNG, application } = require('./helpers');
const { keyIn } = require('../src/download');
const { urlsOf } = require('../src/config');

/** A key of the shape henri generates */
const KEY = 'artworks/2026/09/0123456789abcdef0123456789abcdef.png';

/** The secret every signer in this file derives its key from */
const SECRET = 'a-secret-long-enough-to-be-one';

/** A signer with a key */
const signer = (options = {}) =>
  new UrlSigner(Object.assign({ secret: SECRET }, options));

/**
 * An application that hands out signed urls, with one file already stored
 *
 * @param {object} [urls={ expiresIn: 300 }] the `urls` block
 * @returns {Promise<object>} `{ app, uploads, stored }`
 */
async function stored(urls = { expiresIn: 300 }) {
  const { app, uploads } = await application(
    { urls },
    { handler: async (req, res) => res.json(await req.file('scan').store()) }
  );

  uploads.henri.config.get = ((get) => (key) =>
    key === 'secret' ? SECRET : get(key))(uploads.henri.config.get);
  uploads.signer = uploads.signerOf();

  const answer = await supertest(app)
    .post('/upload')
    .attach('scan', PNG, { filename: 'Portrait of Ada.png' });

  return { app, stored: answer.body, uploads };
}

describe('what henri signs', () => {
  test('a url carries the key, the window and how it is served', () => {
    const url = new URL(
      `http://x.test${signer().sign(KEY, { filename: 'a.png', type: 'image/png' })}`
    );

    expect(url.pathname).toBe(`/_uploads/${KEY}`);
    expect(url.searchParams.get('disposition')).toBe('attachment');
    expect(url.searchParams.get('type')).toBe('image/png');
    expect(url.searchParams.get('name')).toBe('a.png');
    expect(Number(url.searchParams.get('expires'))).toBeGreaterThan(
      Date.now() / 1000
    );
    expect(url.searchParams.get('signature')).toMatch(/^[\w-]{43}$/u);
  });

  /**
   * The verdict on a url, as the route reads it
   *
   * @param {string} value the url
   * @param {object} [options={}] `{ now, with }` to age it or edit its query
   * @returns {object} the verdict
   */
  const verdictOf = (value, options = {}) => {
    const url = new URL(`http://x.test${value}`);

    for (const [name, replacement] of Object.entries(options.with || {})) {
      url.searchParams.set(name, replacement);
    }

    return signer().verify(
      keyIn(url.pathname, '/_uploads'),
      url.searchParams,
      options.now || new Date()
    );
  };

  test('a url henri signed verifies', () => {
    expect(verdictOf(signer().sign(KEY)).ok).toBe(true);
  });

  test.each([
    ['another key', { path: 'fedcba9876543210fedcba9876543210' }],
    ['a wider window', { with: { expires: '99999999999' } }],
    ['another disposition', { with: { disposition: 'inline' } }],
    ['another type', { with: { type: 'text/html' } }],
    ['another download name', { with: { name: 'other.png' } }],
    ['a signature of its own', { with: { signature: 'a'.repeat(43) } }],
    ['no signature at all', { with: { signature: '' } }],
  ])('%s does not verify', (what, edit) => {
    const url = signer().sign(KEY, { filename: 'a.png', type: 'image/png' });
    const edited = edit.path
      ? url.replace('0123456789abcdef0123456789abcdef', edit.path)
      : url;
    const verdict = verdictOf(edited, edit);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('invalid');
  });

  test('a url cannot be replayed once its window has passed', () => {
    const url = signer().sign(KEY, { expiresIn: 60 });
    const later = new Date(Date.now() + 61 * 1000);
    const verdict = verdictOf(url, { now: later });

    expect(verdict.ok).toBe(false);
    // Expired, not invalid: the signature is henri's, the clock is what moved
    expect(verdict.reason).toBe('expired');
  });

  test('another secret signs another url, so a rotation invalidates all of them', () => {
    const url = signer().sign(KEY);
    const rotated = new UrlSigner({ secret: 'a-different-secret-entirely' });

    expect(
      verdictOf(url).ok &&
        !rotated.verify(KEY, new URL(`http://x.test${url}`).searchParams).ok
    ).toBe(true);
  });

  test('a key henri did not generate is refused before anything is signed', () => {
    expect(() => signer().sign('../../etc/passwd')).toThrow(/unsafe/u);
    expect(() => signer().sign('2026/09/aaa.png')).toThrow(/unsafe/u);
  });

  test.each([0, -1, MAX_EXPIRES + 1, 'soon'])(
    'a window of %p is refused rather than signed',
    (expiresIn) => {
      expect(() => signer().sign(KEY, { expiresIn })).toThrow(
        /between 1 and 604800 seconds/u
      );
    }
  );

  test.each(['text/html', 'image/svg+xml'])(
    '%s is never signed for inline, whoever asks',
    (type) => {
      expect(() => signer().sign(KEY, { disposition: 'inline', type })).toThrow(
        /never served inline/u
      );
      expect(signer().sign(KEY, { disposition: 'attachment', type })).toContain(
        'disposition=attachment'
      );
    }
  );

  test('without a secret nothing is signed and nothing verifies', () => {
    const unusable = new UrlSigner({});

    expect(unusable.usable).toBe(false);
    expect(unusable.verify(KEY, new URLSearchParams('signature=x')).ok).toBe(
      false
    );
  });

  test('a cdn is a prefix, and the signature does not cover it', () => {
    const behind = signer({ cdn: 'https://files.example.com/' });
    const url = behind.sign(KEY);

    expect(url.startsWith('https://files.example.com/_uploads/')).toBe(true);
    // The same query verifies whatever host it was fetched from
    expect(signer().verify(KEY, new URL(url).searchParams).ok).toBe(true);
  });
});

describe('the route that verifies them', () => {
  test('serves the file, as a download, with the type henri decided on', async () => {
    const { app, stored: record, uploads } = await stored();
    const url = await uploads.url(record);
    const answer = await supertest(app).get(url);

    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toContain('image/png');
    expect(answer.headers['x-content-type-options']).toBe('nosniff');
    expect(answer.headers['content-disposition']).toContain('attachment');
    expect(answer.headers['content-disposition']).toContain(
      'Portrait of Ada.png'
    );
    expect(Buffer.from(answer.body)).toEqual(PNG);
  });

  test('a link that was edited answers 403 and says which code', async () => {
    const { app, stored: record, uploads } = await stored();
    const url = await uploads.url(record);
    const answer = await supertest(app).get(
      url.replace('disposition=attachment', 'disposition=inline')
    );

    expect(answer.status).toBe(403);
    expect(answer.body.code).toBe('URL_INVALID');
  });

  test('an expired link says so, and only for a link henri signed', async () => {
    const { app, stored: record, uploads } = await stored();
    const url = await uploads.url(record, {
      expiresIn: 60,
      now: new Date(Date.now() - 3600 * 1000),
    });
    const answer = await supertest(app).get(url);

    expect(answer.status).toBe(403);
    expect(answer.body.code).toBe('URL_EXPIRED');
  });

  test('a link to an object that is gone is a 403, not a 500', async () => {
    const { app, stored: record, uploads } = await stored();
    const url = await uploads.url(record);

    await uploads.delete(record);

    expect((await supertest(app).get(url)).status).toBe(403);
  });

  test('nothing under the path is served without a signature', async () => {
    const { app } = await stored();

    // Under the prefix, everything unsigned is one answer; the prefix
    // itself, and anything outside it, is the application's business again
    expect((await supertest(app).get('/_uploads/')).status).toBe(403);
    expect((await supertest(app).get(`/_uploads/${KEY}`)).status).toBe(403);
    expect((await supertest(app).get('/_uploads')).status).toBe(404);
    expect(
      (await supertest(app).get('/_uploads/../../etc/passwd')).status
    ).toBe(404);
  });

  test('the route is not there at all when urls are off', async () => {
    const { app } = await application({});

    expect((await supertest(app).get(`/_uploads/${KEY}`)).status).toBe(404);
  });
});

describe('henri.uploads.url()', () => {
  test('refuses, with the line that turns it on, when urls are off', async () => {
    const { uploads } = await application({});
    const failure = await uploads
      .url('artworks/2026/09/0123456789abcdef0123456789abcdef.png')
      .catch((error) => error);

    expect(failure.code).toBe('HENRI_UPLOAD_URLS_DISABLED');
    expect(failure.message).toContain('"urls"');
  });

  test('refuses when nothing can sign: no storage url, no secret', async () => {
    const { uploads } = await application({ urls: { expiresIn: 300 } });
    const failure = await uploads.url(KEY).catch((error) => error);

    expect(failure.code).toBe('HENRI_UPLOAD_URLS_DISABLED');
    expect(failure.message).toContain('HENRI_SECRET');
  });

  test('takes the name and the type off the record', async () => {
    const { stored: record, uploads } = await stored();
    const url = new URL(`http://x.test${await uploads.url(record)}`);

    expect(url.searchParams.get('name')).toBe('Portrait of Ada.png');
    expect(url.searchParams.get('type')).toBe('image/png');
  });

  test('hands back what a storage that signs its own answers', async () => {
    const { uploads } = await application({ urls: { expiresIn: 300 } });

    uploads.storage.url = (key, options) =>
      `https://store.example.com/${key}?e=${options.expiresIn}`;

    expect(await uploads.url(KEY)).toBe(
      `https://store.example.com/${KEY}?e=300`
    );
    expect(uploads.signs()).toBe(true);
  });
});

describe('the urls block', () => {
  test('is off unless it is an object, whatever else is written', () => {
    expect(urlsOf(undefined)).toBe(false);
    expect(urlsOf(false)).toBe(false);
    expect(urlsOf(true)).toBe(false);
    expect(urlsOf('yes')).toBe(false);
    expect(urlsOf([])).toBe(false);
  });

  test('nonsense falls back to the defaults rather than to no expiry', () => {
    expect(urlsOf({ expiresIn: 'a while', path: 'relative' })).toEqual({
      cdn: '',
      expiresIn: 300,
      path: '/_uploads',
    });
    expect(urlsOf({ expiresIn: MAX_EXPIRES + 1 }).expiresIn).toBe(300);
    expect(
      urlsOf({ cdn: 'https://files.example.com/', path: '/files/' })
    ).toEqual({
      cdn: 'https://files.example.com',
      expiresIn: 300,
      path: '/files',
    });
  });
});
