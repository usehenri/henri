/* global Article */
const supertest = require('supertest');
const Henri = require('../henri');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SUFFIX = /^how-we-ship-[a-z2-9]{6}$/;

describe('slugs (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let request;
  let article;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    request = supertest(henri.server.app);
    article = await Article.create({
      body: 'nothing yet',
      title: 'How we ship',
    });
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }
  }, 60000);

  describe('what the model wrote', () => {
    test('a name built from the title, with its discriminator', () => {
      expect(article.slug).toMatch(SUFFIX);
    });

    test('next to the public identifier, which did not move', () => {
      expect(article.externalId).toMatch(UUID);
    });
  });

  describe('the url of a record', () => {
    test('every href carries the slug and not the uuid', async () => {
      const res = await request.get(`/articles/${article.slug}`);

      expect(res.status).toBe(200);
      expect(res.body._links.self.href).toBe(`/articles/${article.slug}`);
      expect(res.body._links.collection.href).toBe('/articles');
      expect(JSON.stringify(res.body._links)).not.toContain(article.externalId);
    });

    test('the payload still carries the public identifier, and never the key', async () => {
      const res = await request.get(`/articles/${article.slug}`);

      expect(res.body.externalId).toBe(article.externalId);
      expect(res.body.slug).toBe(article.slug);
      expect(res.body.id).toBeUndefined();
      expect(res.body._id).toBeUndefined();
    });

    test('a collection names each of its rows the same way', async () => {
      const res = await request.get('/articles');

      expect(res.status).toBe(200);

      const [first] = res.body._embedded.articles;

      expect(first._links.self.href).toBe(`/articles/${first.slug}`);
      expect(first.externalId).toMatch(UUID);
      expect(first.id).toBeUndefined();
    });

    test('the Location of a 201 is the new name', async () => {
      const res = await request
        .post('/articles')
        .send({ title: 'Something new' });

      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/articles/${res.body.slug}`);
      expect(res.body.slug.startsWith('something-new-')).toBe(true);
    });
  });

  describe('what the url resolves', () => {
    test('the slug', async () => {
      expect((await request.get(`/articles/${article.slug}`)).status).toBe(200);
    });

    test('the public identifier, still', async () => {
      const res = await request.get(`/articles/${article.externalId}`);

      expect(res.status).toBe(200);
      // And it answers with the name, so a client that followed a uuid
      // finds the record's url in the answer
      expect(res.body._links.self.href).toBe(`/articles/${article.slug}`);
    });

    test('never the primary key', async () => {
      const key = String(article._id || article.id);

      expect((await request.get(`/articles/${key}`)).status).toBe(404);
    });

    test('and a name that names nothing is the same 404', async () => {
      const nothing = await request.get('/articles/no-such-article');
      const key = await request.get(
        `/articles/${String(article._id || article.id)}`
      );

      expect(nothing.status).toBe(404);
      expect(key.status).toBe(404);
      expect(key.body).toEqual(nothing.body);
    });
  });

  describe('a title in a script henri folds nothing to', () => {
    test('still answers a working url', async () => {
      const res = await request.post('/articles').send({ title: 'こんにちは' });

      expect(res.status).toBe(201);
      expect(res.body.slug).toHaveLength(6);
      expect((await request.get(`/articles/${res.body.slug}`)).status).toBe(
        200
      );
    });
  });

  describe('a model with no slug', () => {
    test('keeps the urls it had', async () => {
      const created = await request
        .post('/api/v1/artworks')
        .set('Accept', 'application/json')
        .send({ title: 'Nighthawks', year: 1942 });

      expect(created.status).toBe(201);
      expect(created.body._links.self.href).toMatch(
        /^\/api\/v1\/artworks\/[0-9a-f]{8}-/
      );
    });
  });
});
