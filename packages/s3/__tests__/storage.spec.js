const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const S3Storage = require('../src/storage');
const { BUCKET, CREDENTIALS, REGION, fakeStore } = require('./fake');
const { S3Client } = require('../src/client');
const { withEnvironment } = require('../src/storage');

/** A key of the shape henri generates, so the storage will accept it */
const KEY = 'artworks/2026/09/0123456789abcdef0123456789abcdef.png';

/** A one pixel png, as bytes */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Everything the storage reads off a henri instance
 *
 * @param {string} cwd the application directory
 * @returns {object} a henri-shaped object
 */
const fakeHenri = (cwd) => {
  const lines = [];

  return {
    cwd: () => cwd,
    lines,
    pen: {
      error: (...args) => lines.push(['error', ...args]),
      info: (...args) => lines.push(['info', ...args]),
      warn: (...args) => lines.push(['warn', ...args]),
    },
  };
};

/**
 * A started storage pointed at a fake object store
 *
 * @param {object} [options={}] what to change in the block
 * @returns {Promise<object>} `{ storage, store, cwd, henri }`
 */
async function started(options = {}) {
  const store = await fakeStore();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'henri-s3-'));
  const henri = fakeHenri(cwd);
  const storage = new S3Storage(
    's3',
    {
      options: Object.assign(
        {
          accessKeyId: CREDENTIALS.accessKeyId,
          bucket: BUCKET,
          endpoint: store.url,
          region: REGION,
          secretAccessKey: CREDENTIALS.secretAccessKey,
        },
        options
      ),
      root: 'storage/uploads',
    },
    henri
  );

  await storage.start();

  return { cwd, henri, storage, store };
}

/**
 * A part on the disk, the way the parser leaves one
 *
 * @param {object} storage the storage
 * @param {Buffer} [bytes=PNG] what is in it
 * @returns {Promise<string>} the path
 */
async function part(storage, bytes = PNG) {
  const temp = await storage.temp();

  fs.writeFileSync(temp.path, bytes);

  return temp.path;
}

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

describe('an object store as a HenriStorage', () => {
  test('keeps a part, hands it back and removes it', async () => {
    const { store, storage } = await started();

    expect(
      await storage.put(await part(storage), KEY, { type: 'image/png' })
    ).toBe(KEY);
    expect(store.objects.has(KEY)).toBe(true);
    expect(await drain(await storage.get(KEY))).toEqual(PNG);
    expect(await storage.stat(KEY)).toMatchObject({ size: PNG.length });
    expect(await storage.delete(KEY)).toBe(true);
    expect(await storage.delete(KEY)).toBe(false);
    expect(await storage.stat(KEY)).toBeNull();

    await storage.stop();
    await store.close();
  });

  test('the type henri decided on is what the object is stored as', async () => {
    const { store, storage } = await started();

    await storage.put(await part(storage), KEY, {
      checksum: 'nonsense',
      name: 'Portrait of Ada.png',
      type: 'image/png',
    });

    expect(store.objects.get(KEY).type).toBe('image/png');
    // The original name is metadata and stays metadata: it is not in the key
    expect(store.objects.get(KEY).name).toBe('Portrait%20of%20Ada.png');
    expect(KEY).not.toContain('Ada');

    await storage.stop();
    await store.close();
  });

  test('the part is gone from the disk once it is in the store', async () => {
    const { storage, store } = await started();
    const source = await part(storage);

    await storage.put(source, KEY, {});

    expect(fs.existsSync(source)).toBe(false);

    await storage.stop();
    await store.close();
  });

  test('the digest the parser measured is what is signed', async () => {
    const { store, storage } = await started();
    const checksum = require('node:crypto')
      .createHash('sha256')
      .update(PNG)
      .digest('hex');

    await storage.put(await part(storage), KEY, { checksum });

    const put = store.requests.find((request) => request.method === 'PUT');

    expect(put.headers['x-amz-content-sha256']).toBe(checksum);
    expect(put.headers['content-length']).toBe(String(PNG.length));

    await storage.stop();
    await store.close();
  });

  test.each([
    '../../etc/passwd',
    '/etc/passwd',
    '2026/09/../../../../etc/passwd',
    'passwd',
    '2026/09/aaa.png',
    '',
  ])('refuses to write %s, the way the disk does', async (key) => {
    const { storage, store } = await started();

    await expect(storage.put(await part(storage), key, {})).rejects.toThrow(
      /unsafe storage key/u
    );
    expect(store.requests.filter((one) => one.method === 'PUT')).toEqual([]);

    await storage.stop();
    await store.close();
  });

  test('a key that escapes cannot be read, stat-ed or deleted either', async () => {
    const { storage, store } = await started();

    await expect(storage.get('../../etc/passwd')).rejects.toThrow(/unsafe/u);
    expect(await storage.stat('../../etc/passwd')).toBeNull();
    expect(await storage.delete('../../etc/passwd')).toBe(false);

    await storage.stop();
    await store.close();
  });

  test('the temporary area is local, private and swept', async () => {
    const { cwd, storage, store } = await started();
    const root = path.join(cwd, 'storage/uploads');

    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain(
      '*'
    );
    expect((await storage.temp()).path.startsWith(root)).toBe(true);

    await storage.stop();
    await store.close();
  });
});

describe('a presigned url', () => {
  test('hands the bytes back without the application reading them', async () => {
    const { store, storage } = await started();

    await storage.put(await part(storage), KEY, { type: 'image/png' });

    const url = storage.url(KEY, {
      disposition: 'attachment',
      expiresIn: 60,
      filename: 'Portrait of Ada.png',
      type: 'image/png',
    });

    // The name is in the response override the signature covers, never in
    // the key: an edited disposition is a url the store refuses
    expect(decodeURIComponent(url)).toContain('Portrait of Ada.png');

    const answer = await fetch(url);

    expect(answer.status).toBe(200);
    expect(Buffer.from(await answer.arrayBuffer())).toEqual(PNG);
    // No Authorization header was sent: the url is the whole credential
    expect(store.requests.at(-1).headers.authorization).toBeUndefined();

    await storage.stop();
    await store.close();
  });

  test('is refused once its window has passed', async () => {
    const { store, storage } = await started();

    await storage.put(await part(storage), KEY, {});

    const expired = storage.url(KEY, {
      expiresIn: 60,
      now: new Date(Date.now() - 3600 * 1000),
    });

    expect((await fetch(expired)).status).toBe(403);

    await storage.stop();
    await store.close();
  });

  test('cannot be edited to name another key, or to last longer', async () => {
    const { store, storage } = await started();

    await storage.put(await part(storage), KEY, {});

    const url = storage.url(KEY, { expiresIn: 60 });
    const other = url.replace(
      '0123456789abcdef0123456789abcdef',
      'fedcba9876543210fedcba9876543210'
    );
    const longer = url.replace('X-Amz-Expires=60', 'X-Amz-Expires=604800');

    expect((await fetch(other)).status).toBe(403);
    expect((await fetch(longer)).status).toBe(403);

    await storage.stop();
    await store.close();
  });

  test('refuses a key henri did not generate before it signs anything', async () => {
    const { storage, store } = await started();

    expect(() => storage.url('../../etc/passwd')).toThrow(/unsafe/u);

    await storage.stop();
    await store.close();
  });
});

describe('a configuration that cannot work', () => {
  /**
   * A storage built with a block, without starting it
   *
   * @param {object} options the block
   * @returns {S3Storage} the storage
   */
  const build = (options) =>
    new S3Storage('s3', { options }, fakeHenri('/tmp'));

  test.each([
    [{ bucket: '', region: 'us-east-1' }, /bucket is not set/u],
    [{ bucket: 'Not A Bucket', region: 'us-east-1' }, /not a bucket name/u],
    [
      { bucket: 'henri', region: 'us-east-1' },
      /no credentials|AWS_ACCESS_KEY_ID/u,
    ],
  ])('%p is refused before a request is made', async (options, message) => {
    await expect(
      build(
        Object.assign(
          {
            accessKeyId: '',
            endpoint: 'http://127.0.0.1:1',
            secretAccessKey: '',
          },
          options
        )
      ).start()
    ).rejects.toThrow(message);
  });

  test('an endpoint that is not a url says so', () => {
    expect(() => build({ bucket: 'henri', endpoint: 'not a url' })).toThrow(
      /is not a url/u
    );
  });

  test('the code is one of the catalogue', async () => {
    const failure = await build({ bucket: '' })
      .start()
      .catch((error) => error);

    expect(failure.code).toBe('HENRI_UPLOAD_STORAGE_MISCONFIGURED');
  });

  test('a bucket that is not there is a warning, not a failed boot', async () => {
    const store = await fakeStore();
    const henri = fakeHenri(
      fs.mkdtempSync(path.join(os.tmpdir(), 'henri-s3-'))
    );
    const storage = new S3Storage(
      's3',
      {
        options: {
          accessKeyId: CREDENTIALS.accessKeyId,
          bucket: 'somewhere-else',
          endpoint: store.url,
          region: REGION,
          secretAccessKey: CREDENTIALS.secretAccessKey,
        },
        root: 'storage/uploads',
      },
      henri
    );

    await expect(storage.start()).resolves.toBe('somewhere-else');
    expect(henri.lines.some(([level]) => level === 'warn')).toBe(true);

    await storage.stop();
    await store.close();
  });
});

describe('the credentials', () => {
  test('come from the environment unless the block names them', () => {
    expect(
      withEnvironment(
        {},
        {
          AWS_ACCESS_KEY_ID: 'from-env',
          AWS_SECRET_ACCESS_KEY: 'secret-env',
          AWS_SESSION_TOKEN: 'token',
        }
      )
    ).toMatchObject({
      accessKeyId: 'from-env',
      secretAccessKey: 'secret-env',
      sessionToken: 'token',
    });

    expect(
      withEnvironment(
        { accessKeyId: 'written-down' },
        { AWS_ACCESS_KEY_ID: 'from-env' }
      ).accessKeyId
    ).toBe('written-down');
  });
});

describe('the wire', () => {
  test('path style puts the bucket in the path, virtual host in the name', () => {
    const options = {
      accessKeyId: 'a',
      bucket: 'henri-uploads',
      region: 'us-east-1',
      secretAccessKey: 'b',
    };
    const hosted = new S3Client(options);
    const styled = new S3Client(Object.assign({ pathStyle: true }, options));

    expect(hosted.addressOf('a/b.png')).toMatchObject({
      host: 'henri-uploads.s3.us-east-1.amazonaws.com',
      hostname: 'henri-uploads.s3.us-east-1.amazonaws.com',
      path: '/a/b.png',
    });
    expect(styled.addressOf('a/b.png')).toMatchObject({
      host: 's3.us-east-1.amazonaws.com',
      hostname: 's3.us-east-1.amazonaws.com',
      path: '/henri-uploads/a/b.png',
    });

    // The socket goes to the host the signature covers, port and all: a
    // named endpoint on a port carries it in `Host` and not in `hostname`
    const local = new S3Client(
      Object.assign({ endpoint: 'http://127.0.0.1:9000' }, options)
    );

    expect(local.addressOf('a/b.png')).toMatchObject({
      host: '127.0.0.1:9000',
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:9000',
    });
  });

  test('a named endpoint is path style unless it says otherwise', () => {
    expect(
      new S3Client({ bucket: 'b', endpoint: 'https://minio.test' }).pathStyle
    ).toBe(true);
    expect(new S3Client({ bucket: 'b' }).pathStyle).toBe(false);
  });

  test('a store that keeps failing is tried again, then given up on', async () => {
    let seen = 0;
    const flaky = http.createServer((req, res) => {
      seen += 1;
      res.writeHead(503);
      res.end('<Error><Code>SlowDown</Code><Message>later</Message></Error>');
    });

    await new Promise((resolve) => flaky.listen(0, '127.0.0.1', resolve));

    const client = new S3Client({
      accessKeyId: 'a',
      bucket: 'henri-uploads',
      endpoint: `http://127.0.0.1:${flaky.address().port}`,
      region: 'us-east-1',
      secretAccessKey: 'b',
    });
    const failure = await client.get('a/b.png').catch((error) => error);

    expect(seen).toBe(3);
    expect(failure.code).toBe('HENRI_UPLOAD_STORAGE_FAILED');
    expect(failure.status).toBe(503);
    expect(failure.reason).toBe('SlowDown');

    await new Promise((resolve) => flaky.close(resolve));
  });

  test('a refused signature is not tried again', async () => {
    let seen = 0;
    const strict = http.createServer((req, res) => {
      seen += 1;
      res.writeHead(403);
      res.end(
        '<Error><Code>SignatureDoesNotMatch</Code><Message>no</Message></Error>'
      );
    });

    await new Promise((resolve) => strict.listen(0, '127.0.0.1', resolve));

    const client = new S3Client({
      accessKeyId: 'a',
      bucket: 'henri-uploads',
      endpoint: `http://127.0.0.1:${strict.address().port}`,
      region: 'us-east-1',
      secretAccessKey: 'b',
    });

    await expect(client.get('a/b.png')).rejects.toThrow(
      /403 SignatureDoesNotMatch/u
    );
    expect(seen).toBe(1);

    await new Promise((resolve) => strict.close(resolve));
  });

  test('a redirect names the region instead of being followed', async () => {
    const moved = http.createServer((req, res) => {
      res.writeHead(301, { 'x-amz-bucket-region': 'eu-west-1' });
      res.end('<Error><Code>PermanentRedirect</Code></Error>');
    });

    await new Promise((resolve) => moved.listen(0, '127.0.0.1', resolve));

    const client = new S3Client({
      accessKeyId: 'a',
      bucket: 'henri-uploads',
      endpoint: `http://127.0.0.1:${moved.address().port}`,
      region: 'us-east-1',
      secretAccessKey: 'b',
    });
    const failure = await client.get('a/b.png').catch((error) => error);

    expect(failure.code).toBe('HENRI_UPLOAD_STORAGE_MISCONFIGURED');
    expect(failure.message).toContain('eu-west-1');

    await new Promise((resolve) => moved.close(resolve));
  });
});
