const fs = require('node:fs');
const path = require('node:path');
const supertest = require('supertest');
const Henri = require('../henri');

const password = 'difference-engine';
const email = 'ada@usehenri.io';

/** A one pixel png */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Reads a cookie value from a response
 *
 * @param {object} res supertest response
 * @param {string} name cookie name
 * @returns {?string} the value or null
 */
const cookieOf = (res, name) => {
  const line = (res.headers['set-cookie'] || []).find((cookie) =>
    cookie.startsWith(`${name}=`)
  );

  return line ? line.split(';')[0].slice(name.length + 1) : null;
};

describe('uploads (demo app, @usehenri/uploads)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let request;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    request = supertest(app);
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;

    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }
  });

  test('the module comes from the package the application depends on', () => {
    expect(henri.uploads).toBeDefined();
    expect(henri.uploads.enabled).toBe(true);
    expect(henri.uploads.name).toBe('uploads');
    // Before the user module, which is where CSRF reads the body
    expect(henri.uploads.runlevel).toBe(3);
    expect(henri.uploads.before).toContain('user');
  });

  test('a file arrives, is typed by its bytes, and is handed back', async () => {
    const answer = await request
      .post('/uploads')
      .field('title', 'a scan')
      .attach('scan', PNG, { contentType: 'image/gif', filename: 'a.png' });

    expect(answer.status).toBe(201);
    expect(answer.body.title).toBe('a scan');
    expect(answer.body.declaredType).toBe('image/gif');
    expect(answer.body.mistyped).toBe(true);
    expect(answer.body.file).toMatchObject({
      name: 'a.png',
      size: PNG.length,
      storage: 'local',
      type: 'image/png',
    });
    expect(answer.body.file.key).toMatch(
      /^demo\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/u
    );

    const stored = path.join(henri.uploads.storage.root, answer.body.file.key);

    expect(fs.existsSync(stored)).toBe(true);

    const download = await request.get(`/uploads/${answer.body.file.checksum}`);

    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-disposition']).toContain(
      'attachment; filename="a.png"'
    );
    expect(Buffer.from(download.body).equals(PNG)).toBe(true);
  });

  test('the parser runs before CSRF, so a multipart form can carry its token', async () => {
    const agent = supertest.agent(app);
    const registered = await agent
      .post('/register')
      .send({ email, name: 'ada', password });

    expect(registered.status).toBe(201);

    const logged = await agent.post('/login').send({ email, password });

    expect(logged.status).toBe(200);

    const token = cookieOf(registered, 'henri.csrf');

    expect(token).toBeTruthy();

    const without = await agent
      .post('/uploads')
      .attach('scan', PNG, { filename: 'a.png' });

    expect(without.status).toBe(403);

    const with_ = await agent
      .post('/uploads')
      .field('_csrf', token)
      .attach('scan', PNG, { filename: 'a.png' });

    expect(with_.status).toBe(201);
  });

  test('the limits of the configuration are the ones enforced', async () => {
    const big = await request
      .post('/uploads')
      .set('Accept', 'application/json')
      .attach('scan', Buffer.alloc(600 * 1024, 0xf0), { filename: 'big.bin' });

    expect(big.status).toBe(413);
    expect(big.body.error).toBe('Payload Too Large');
    expect(big.body.message).toContain('larger than the 524288 bytes');

    const many = await request
      .post('/uploads')
      .set('Accept', 'application/json')
      .attach('scan', PNG, { filename: 'a.png' })
      .attach('scan', PNG, { filename: 'b.png' })
      .attach('scan', PNG, { filename: 'c.png' });

    expect(many.status).toBe(413);
    expect(many.body.message).toContain('2 files');
  });

  test('a request with no file at all is answered, not refused', async () => {
    const answer = await request
      .post('/uploads')
      .set('Accept', 'application/json')
      .field('title', 'nothing');

    expect(answer.status).toBe(400);
    expect(answer.body.message).toContain('no file');
  });

  test('a JSON body is untouched by any of this', async () => {
    const answer = await request.post('/echo').send({ hello: 'world' });

    expect(answer.status).toBe(200);
    expect(answer.body.body).toEqual({ hello: 'world' });
  });

  test('nothing is left in the temporary directory', async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(fs.readdirSync(henri.uploads.storage.tmp)).toEqual([]);
  });
});
