const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const supertest = require('supertest');

const { PNG, application, objects, temporaries } = require('./helpers');

/**
 * Waits until a condition holds, or gives up
 *
 * @param {function} condition what to check
 * @param {number} [ms=3000] how long to wait
 * @returns {Promise<boolean>} whether it held
 */
const waitFor = async (condition, ms = 3000) => {
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  return condition();
};

/**
 * The bytes of a multipart body holding one file
 *
 * @param {string} boundary the boundary
 * @param {Buffer} content the file
 * @returns {{head: Buffer, tail: Buffer}} the two halves around the content
 */
const multipart = (boundary, content) => ({
  head: Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="scan"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`
  ),
  tail: Buffer.from(`\r\n--${boundary}--\r\n`),
});

describe('nothing is kept unless a controller says so', () => {
  test('a file the controller never stores is swept when the response closes', async () => {
    const { app, uploads } = await application(
      {},
      {
        handler: (req, res) => res.json({ files: Object.keys(req.files) }),
      }
    );
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', PNG, { filename: 'a.png' });

    expect(answer.body.files).toEqual(['scan']);
    expect(await waitFor(() => temporaries(uploads).length === 0)).toBe(true);
    expect(objects(uploads)).toEqual([]);
  });

  test('permitFiles removes what the controller did not ask for, on the spot', async () => {
    const { app, uploads } = await application(
      {},
      {
        handler: (req, res) => {
          const arrived = req._uploads.slice();
          const kept = req.permitFiles('scan');

          res.json({
            after: Object.keys(req.files),
            kept: Object.keys(kept),
            // Released the moment permitFiles() ran, not at the end of the
            // request: what a controller did not ask for is not held on to
            released: arrived.map((file) => [file.field, file.released]),
          });
        },
      }
    );
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', PNG, { filename: 'a.png' })
      .attach('sneaky', PNG, { filename: 'b.png' });

    expect(answer.body.kept).toEqual(['scan']);
    expect(answer.body.after).toEqual(['scan']);
    expect(answer.body.released).toEqual([
      ['scan', false],
      ['sneaky', true],
    ]);
    expect(await waitFor(() => temporaries(uploads).length === 0)).toBe(true);
    expect(objects(uploads)).toEqual([]);
  });

  test('a stored file is not swept, and keeps its record', async () => {
    const { app, uploads } = await application();
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', PNG, { contentType: 'image/png', filename: 'a.png' });

    expect(answer.status).toBe(201);
    expect(answer.body.stored[0]).toMatchObject({
      name: 'a.png',
      size: PNG.length,
      storage: 'local',
      type: 'image/png',
    });
    expect(answer.body.stored[0].checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(await waitFor(() => temporaries(uploads).length === 0)).toBe(true);
    expect(objects(uploads)).toHaveLength(1);

    const stored = fs.readFileSync(
      path.join(uploads.storage.root, answer.body.stored[0].key)
    );

    expect(stored.equals(PNG)).toBe(true);
  });

  test('a handler that throws leaves nothing behind', async () => {
    const { app, uploads } = await application(
      {},
      {
        handler: () => {
          throw new Error('boom');
        },
      }
    );
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', PNG, { filename: 'a.png' });

    expect(answer.status).toBe(500);
    expect(await waitFor(() => temporaries(uploads).length === 0)).toBe(true);
    expect(objects(uploads)).toEqual([]);
  });

  test('store() after the request is over says so rather than half-working', async () => {
    let escaped = null;
    const { app } = await application(
      {},
      {
        handler: (req, res) => {
          escaped = req.file('scan');
          res.json({ ok: true });
        },
      }
    );

    await supertest(app)
      .post('/upload')
      .attach('scan', PNG, { filename: 'a.png' });
    await waitFor(() => escaped && escaped.released);

    await expect(escaped.store()).rejects.toThrow('already released');
  });
});

describe('a request that is abandoned half-way', () => {
  test('leaves nothing on the disk', async () => {
    const { app, uploads } = await application({ maxFileSize: '20mb' });
    const server = app.listen(0, '127.0.0.1');

    await new Promise((resolve) => server.once('listening', resolve));

    const boundary = 'henriboundary';
    const content = Buffer.alloc(4 * 1024 * 1024, 0x41);
    const { head, tail } = multipart(boundary, content);
    const request = http.request({
      headers: {
        'content-length': String(head.length + content.length + tail.length),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      host: '127.0.0.1',
      method: 'POST',
      path: '/upload',
      port: server.address().port,
    });

    request.on('error', () => {});
    request.write(head);
    request.write(content.subarray(0, 1024 * 1024));

    // The server has a part open and bytes on the disk; the client vanishes
    await waitFor(() => temporaries(uploads).length > 0);
    expect(temporaries(uploads).length).toBeGreaterThan(0);

    request.destroy();

    expect(await waitFor(() => temporaries(uploads).length === 0)).toBe(true);
    expect(objects(uploads)).toEqual([]);

    await new Promise((resolve) => server.close(resolve));
  }, 20000);
});

describe('what a process that was killed left behind', () => {
  test('is swept when the storage starts', async () => {
    const { uploads } = await application();
    const stale = path.join(uploads.storage.tmp, 'deadbeef.part');

    fs.writeFileSync(stale, 'left by a SIGKILL');
    fs.writeFileSync(path.join(uploads.storage.tmp, 'not-a-part.txt'), 'kept');

    expect(temporaries(uploads)).toHaveLength(2);

    await uploads.storage.start();

    expect(temporaries(uploads)).toEqual(['not-a-part.txt']);
  });
});
