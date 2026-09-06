const supertest = require('supertest');

const {
  ELF,
  PDF,
  PNG,
  application,
  objects,
  temporaries,
} = require('./helpers');

const MB = 1024 * 1024;

/** Bytes that are not text, so nothing is recognized but the size */
const noise = (size) => Buffer.alloc(size, 0xf0);

describe('the limits, which exist before the first byte is read', () => {
  test('a 6mb file is refused when the limit is 5mb, and nothing is kept', async () => {
    const { app, uploads } = await application({
      maxFileSize: '5mb',
      maxTotalSize: '50mb',
    });
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', noise(6 * MB), {
        contentType: 'application/octet-stream',
        filename: 'big.bin',
      });

    expect(answer.status).toBe(413);
    expect(answer.body.code).toBe('FILE_TOO_LARGE');
    expect(answer.body.data).toEqual({ field: 'scan', limit: 5 * MB });
    expect(objects(uploads)).toEqual([]);
    expect(temporaries(uploads)).toEqual([]);
  });

  test('a 5mb file is accepted when the limit is 5mb', async () => {
    const { app, uploads } = await application({
      maxFileSize: '5mb',
      maxTotalSize: '50mb',
    });
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', noise(5 * MB), { filename: 'big.bin' });

    expect(answer.status).toBe(201);
    expect(answer.body.stored[0].size).toBe(5 * MB);
    expect(objects(uploads)).toHaveLength(1);
    expect(temporaries(uploads)).toEqual([]);
  });

  test('the whole body is bounded, whatever one file weighs', async () => {
    const { app, uploads } = await application({
      maxFileSize: '5mb',
      maxTotalSize: '2mb',
    });
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', noise(3 * MB), { filename: 'big.bin' });

    expect(answer.status).toBe(413);
    expect(answer.body.code).toBe('TOTAL_TOO_LARGE');
    expect(objects(uploads)).toEqual([]);
    expect(temporaries(uploads)).toEqual([]);
  });

  test('a Content-Length past the total is refused before a parser is built', async () => {
    const { app } = await application({ maxTotalSize: 1024 });
    // Not a multipart body at all: had a parser been built, this would come
    // back MALFORMED_MULTIPART. The header alone is what refuses it.
    const answer = await supertest(app)
      .post('/upload')
      .set('Content-Type', 'multipart/form-data; boundary=x')
      .send(Buffer.alloc(1200, 0x41));

    expect(answer.status).toBe(413);
    expect(answer.body.code).toBe('TOTAL_TOO_LARGE');
    expect(answer.body.data).toEqual({ limit: 1024 });
  });

  test('how many files a request may carry', async () => {
    const { app, uploads } = await application({ maxFiles: 2 });
    const answer = await supertest(app)
      .post('/upload')
      .attach('scans', PNG, { filename: 'a.png' })
      .attach('scans', PNG, { filename: 'b.png' })
      .attach('scans', PNG, { filename: 'c.png' });

    expect(answer.status).toBe(413);
    expect(answer.body.code).toBe('TOO_MANY_FILES');
    expect(objects(uploads)).toEqual([]);
    expect(temporaries(uploads)).toEqual([]);
  });

  test('how many non-file fields it may carry', async () => {
    const { app } = await application({ maxFields: 3 });
    const request = supertest(app).post('/upload');

    for (let index = 0; index < 5; index++) {
      request.field(`f${index}`, 'x');
    }

    const answer = await request;

    expect(answer.status).toBe(413);
    expect(answer.body.code).toBe('TOO_MANY_FIELDS');
  });

  test('how long a field name may be', async () => {
    const { app } = await application({ maxFieldNameSize: 8 });
    const answer = await supertest(app)
      .post('/upload')
      .field('a-very-long-field-name', 'x');

    expect(answer.status).toBe(413);
    expect(answer.body.code).toBe('FIELD_NAME_TOO_LONG');
  });

  test('how long a field value may be, defaulting to config.bodyLimit', async () => {
    const { app } = await application({ maxFieldSize: 16 });
    const answer = await supertest(app)
      .post('/upload')
      .field('title', 'x'.repeat(64));

    expect(answer.status).toBe(413);
    expect(answer.body.code).toBe('VALUE_TOO_LARGE');
    expect(answer.body.data).toEqual({ field: 'title', limit: 16 });
  });

  test('a body that is not a multipart body at all', async () => {
    const { app } = await application();
    const answer = await supertest(app)
      .post('/upload')
      .set('Content-Type', 'multipart/form-data')
      .send('no boundary anywhere');

    expect(answer.status).toBe(400);
    expect(answer.body.code).toBe('MALFORMED_MULTIPART');
  });

  test('files keep the order the body had, not the order the disk answered in', async () => {
    const { app } = await application();
    const answer = await supertest(app)
      .post('/upload')
      .attach('scans', Buffer.alloc(512 * 1024, 0x41), { filename: 'slow.bin' })
      .attach('scans', PNG, { filename: 'quick.png' })
      .attach('scan', PDF, { filename: 'other.pdf' });

    expect(answer.status).toBe(201);
    expect(answer.body.stored.map((file) => file.name)).toEqual([
      'slow.bin',
      'quick.png',
      'other.pdf',
    ]);
  });

  test('a request that carries no file is not a refusal', async () => {
    const { app } = await application();
    const answer = await supertest(app).post('/upload').field('title', 'hi');

    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({ body: { title: 'hi' }, stored: [] });
  });
});

describe('the type is what the bytes say', () => {
  test('a png named .png with the right header is accepted', async () => {
    const { app } = await application({ allow: ['image/png'] });
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', PNG, { contentType: 'image/png', filename: 'a.png' });

    expect(answer.status).toBe(201);
    expect(answer.body.stored[0].type).toBe('image/png');
    expect(answer.body.stored[0].key).toMatch(/\.png$/u);
  });

  test('an executable calling itself a png is refused, and nothing is kept', async () => {
    const { app, uploads } = await application({ allow: ['image/png'] });
    const answer = await supertest(app).post('/upload').attach('scan', ELF, {
      contentType: 'image/png',
      filename: 'avatar.png',
    });

    expect(answer.status).toBe(415);
    expect(answer.body.code).toBe('TYPE_NOT_ALLOWED');
    expect(answer.body.data.type).toBe('application/x-elf');
    expect(objects(uploads)).toEqual([]);
    expect(temporaries(uploads)).toEqual([]);
  });

  test('the declared type is kept as a claim, never as the answer', async () => {
    const { app } = await application({}, { handler: null });
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', PDF, { contentType: 'image/png', filename: 'a.png' });

    expect(answer.status).toBe(201);
    expect(answer.body.stored[0].type).toBe('application/pdf');
    expect(answer.body.stored[0].key).toMatch(/\.pdf$/u);
  });

  test('html and svg are stored under a name no web server renders', async () => {
    const { app } = await application();
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', Buffer.from('<svg onload="alert(1)"></svg>'), {
        contentType: 'image/svg+xml',
        filename: 'x.svg',
      });

    expect(answer.body.stored[0].type).toBe('image/svg+xml');
    expect(answer.body.stored[0].key).toMatch(/\.bin$/u);
  });

  test('with sniffing off, the client decides -- which is the point of the audit check', async () => {
    const { app } = await application({ allow: ['image/png'], sniff: false });
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', ELF, { contentType: 'image/png', filename: 'a.png' });

    expect(answer.status).toBe(201);
    expect(answer.body.stored[0].type).toBe('image/png');
  });
});

describe('the surface', () => {
  test('paths narrow where a multipart body is read at all', async () => {
    const { app } = await application({ paths: ['/elsewhere'] });
    const answer = await supertest(app)
      .post('/upload')
      .attach('scan', PNG, { filename: 'a.png' });

    expect(answer.status).toBe(201);
    expect(answer.body.stored).toEqual([]);
  });

  test('a GET never carries one', async () => {
    const { app } = await application();
    const answer = await supertest(app).get('/upload');

    expect(answer.status).toBe(404);
  });
});
