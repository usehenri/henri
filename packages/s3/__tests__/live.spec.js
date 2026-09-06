/**
 * The suite that runs against a real implementation of the S3 API.
 *
 * The fake of `__tests__/fake.js` verifies signatures with the same code
 * that makes them, which proves the wire matches what was signed and
 * nothing about whether AWS would accept it. The vectors of
 * `signature.spec.js` prove the algorithm against numbers AWS published.
 * This is the third leg: a server nobody here wrote, which refuses a
 * signature it does not like, and which is what R2, Spaces and MinIO all
 * are from this package's side.
 *
 * It is skipped without `HENRI_TEST_S3_URL` (see `targets.js`), so
 * `pnpm test` stays offline and needs no account anywhere.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const S3Storage = require('../src/storage');
const { EMPTY } = require('../src/signature');
const { S3Client } = require('../src/client');
const { bucket, credentials, live, region, url } = require('./targets');

/** A key of the shape henri generates */
const KEY = 'artworks/2026/09/0123456789abcdef0123456789abcdef.png';

/** A one pixel png, as bytes */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** The block every storage in this file is built from */
const block = Object.assign({ bucket, endpoint: url, region }, credentials);

/**
 * Reads a stream to the end
 *
 * @param {stream.Readable} stream the stream
 * @returns {Promise<Buffer>} what it held
 */
async function drain(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

describe.skipIf(!live)('a real object store', () => {
  let storage;
  let cwd;

  beforeAll(async () => {
    const client = new S3Client(block).check();
    const created = await client.send({
      file: null,
      headers: {},
      key: '',
      length: null,
      method: 'PUT',
      payload: EMPTY,
    });

    created.resume();

    if (created.statusCode !== 200) {
      throw new Error(
        `unable to create the bucket ${bucket}: ${created.statusCode}`
      );
    }

    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-s3-live-'));
    storage = new S3Storage(
      's3',
      { options: block, root: 'storage/uploads' },
      {
        cwd: () => cwd,
        pen: { error: () => {}, info: () => {}, warn: () => {} },
      }
    );

    await storage.start();
  });

  afterAll(async () => {
    if (!storage) {
      return;
    }

    await storage.delete(KEY);
    await storage.stop();

    const client = new S3Client(block);
    const removed = await client.send({
      file: null,
      headers: {},
      key: '',
      length: null,
      method: 'DELETE',
      payload: EMPTY,
    });

    removed.resume();
  });

  test('the bucket answers, so the boot logged nothing', async () => {
    expect(await storage.ping()).toBeNull();
  });

  test('a part is kept, read back and removed', async () => {
    const temp = await storage.temp();

    fs.writeFileSync(temp.path, PNG);

    const checksum = crypto.createHash('sha256').update(PNG).digest('hex');

    expect(
      await storage.put(temp.path, KEY, {
        checksum,
        name: 'Portrait of Ada.png',
        size: PNG.length,
        type: 'image/png',
      })
    ).toBe(KEY);
    expect(fs.existsSync(temp.path)).toBe(false);
    expect(await storage.stat(KEY)).toMatchObject({ size: PNG.length });
    expect(await drain(await storage.get(KEY))).toEqual(PNG);
  });

  test('a presigned url is accepted by the store itself', async () => {
    const answer = await fetch(storage.url(KEY, { expiresIn: 60 }));

    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await answer.arrayBuffer())).toEqual(PNG);
  });

  test('the store refuses a url whose window has passed', async () => {
    const expired = storage.url(KEY, {
      expiresIn: 1,
      now: new Date(Date.now() - 3600 * 1000),
    });

    expect((await fetch(expired)).status).toBe(403);
  });

  test('the store refuses a url that was edited', async () => {
    const url403 = storage
      .url(KEY, { expiresIn: 60 })
      .replace('X-Amz-Expires=60', 'X-Amz-Expires=600');

    expect((await fetch(url403)).status).toBe(403);
  });

  test('a disposition the url asked for comes back on the answer', async () => {
    const answer = await fetch(
      storage.url(KEY, {
        disposition: 'attachment',
        expiresIn: 60,
        filename: 'Portrait of Ada.png',
      })
    );

    expect(answer.headers.get('content-disposition')).toContain('attachment');
    expect(answer.headers.get('content-disposition')).toContain(
      'Portrait of Ada.png'
    );
  });

  test('an object that is not there is null rather than a throw', async () => {
    expect(
      await storage.stat(
        'artworks/2026/09/ffffffffffffffffffffffffffffffff.png'
      )
    ).toBeNull();
  });

  test('a wrong secret is refused, and not retried into a stall', async () => {
    const wrong = new S3Client(
      Object.assign({}, block, { secretAccessKey: 'not-the-secret' })
    );

    await expect(wrong.get(KEY)).rejects.toThrow(/403/u);
  });
});
