const { MongoMemoryServer } = require('mongodb-memory-server');
const Mongoose = require('../index');
const { modelErrors } = require('@usehenri/core/src/base/model-errors');

let mongod;
let sequence = 0;

/**
 * Builds a minimal henri stand-in for the adapter
 *
 * @returns {object} fake henri
 */
const fakeHenri = () => {
  const pen = {};

  ['error', 'fatal', 'info', 'warn'].forEach((level) => {
    pen[level] = () => undefined;
  });

  return {
    _user: null,
    config: { get: () => undefined, has: () => false },
    isTest: true,
    pen,
    user: { encrypt: async (password) => `hashed:${password}` },
  };
};

/**
 * A model file that asks for a slug
 *
 * @param {*} [slug='title'] What `options.slug` says
 * @returns {object} The model file
 */
const articleModel = (slug = 'title') => ({
  globalId: 'Article',
  identity: 'article',
  options: { slug, timestamps: true },
  schema: {
    body: { type: 'text' },
    title: { required: true, type: 'string' },
  },
  store: 'default',
});

/**
 * An adapter with the model on a database of its own
 *
 * @param {*} [slug] What `options.slug` says
 * @returns {Promise<{adapter: object, Article: object}>} Both
 */
const boot = async (slug) => {
  const adapter = new Mongoose(
    'default',
    { url: mongod.getUri(`slug${(sequence += 1)}`) },
    fakeHenri()
  );
  const Article = adapter.addModel(articleModel(slug), 'user');

  await adapter.start();
  await Article.syncIndexes();

  return { Article, adapter };
};

/**
 * The error a write threw, as `{ field: message }` or `{ code }`
 *
 * @param {Promise} promise The write
 * @returns {Promise<object>} What it refused with
 */
const errorsOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return modelErrors(error) || { code: error.code };
  }

  return null;
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
}, 60000);

afterAll(() => mongod && mongod.stop());

describe('slugs on a mongoose store', () => {
  describe('the path henri adds', () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ Article, adapter } = await boot());
    });

    afterAll(() => adapter.stop());

    test('is filled from the source field on insert', async () => {
      const article = await Article.create({ title: 'How we ship' });

      expect(article.slug.startsWith('how-we-ship-')).toBe(true);
      expect(article.slug).toHaveLength('how-we-ship-'.length + 6);
    });

    test('lets two documents share a title', async () => {
      const first = await Article.create({ title: 'Getting started' });
      const second = await Article.create({ title: 'Getting started' });

      expect(first.slug).not.toBe(second.slug);
    });

    test('answers something for a title with no ASCII in it', async () => {
      const article = await Article.create({ title: 'こんにちは' });

      expect(article.slug).toHaveLength(6);
    });

    test('does not move when the title changes', async () => {
      const article = await Article.create({ title: 'First name' });
      const before = article.slug;

      article.title = 'Second name';
      await article.save();

      expect(article.slug).toBe(before);
    });

    test('is not moved by a query update either', async () => {
      const article = await Article.create({ title: 'Third name' });

      await Article.updateOne({ _id: article._id }, { title: 'Fourth name' });

      expect((await Article.findByKey(article._id)).slug).toBe(article.slug);
    });
  });

  describe('the lookup', () => {
    let Article;
    let adapter;
    let article;

    beforeAll(async () => {
      ({ Article, adapter } = await boot());
      article = await Article.create({ title: 'How we ship' });
    });

    afterAll(() => adapter.stop());

    test('findById() takes the slug', async () => {
      expect(String((await Article.findById(article.slug))._id)).toBe(
        String(article._id)
      );
    });

    test('findById() still takes the public identifier', async () => {
      expect(String((await Article.findById(article.externalId))._id)).toBe(
        String(article._id)
      );
    });

    test('findById() does not take the document id', async () => {
      expect(await Article.findById(article._id)).toBeNull();
      expect(await Article.findById(String(article._id))).toBeNull();
    });

    test('a name that names nothing answers the same null', async () => {
      expect(await Article.findById('4812')).toBeNull();
      expect(await Article.findById('no-such-article')).toBeNull();
    });

    test('findBySlug() takes a slug and nothing else', async () => {
      expect(await Article.findBySlug(article.slug)).not.toBeNull();
      expect(await Article.findBySlug(article.externalId)).toBeNull();
      expect(await Article.findBySlug(String(article._id))).toBeNull();
    });

    test('findByKey() is still the document id door', async () => {
      expect(await Article.findByKey(article._id)).not.toBeNull();
    });

    test('findByIdAndUpdate() reaches the same documents findById() does', async () => {
      expect(
        await Article.findByIdAndUpdate(article.slug, { body: 'written' })
      ).not.toBeNull();
      expect(
        await Article.findByIdAndUpdate(String(article._id), { body: 'no' })
      ).toBeNull();
    });
  });

  describe('a slug the application writes itself', () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ Article, adapter } = await boot());
    });

    afterAll(() => adapter.stop());

    test('wins over the one henri would have made', async () => {
      const article = await Article.create({
        slug: 'how-we-ship',
        title: 'Something else entirely',
      });

      expect(article.slug).toBe('how-we-ship');
    });

    test('may be any script henri ships no table for', async () => {
      await Article.create({ slug: 'こんにちは', title: 'Hello' });

      expect(await Article.findById('こんにちは')).not.toBeNull();
    });

    test('is refused when it cannot be one path segment', async () => {
      expect(
        await errorsOf(Article.create({ slug: 'a/b', title: 'x' }))
      ).toEqual({ slug: 'must not hold "/"' });
    });

    test('is refused when it is shaped like a public identifier', async () => {
      expect(
        await errorsOf(
          Article.create({
            slug: '01a07d06-e6c4-73cd-9021-31eb06befdd7',
            title: 'x',
          })
        )
      ).toEqual({ slug: 'must not be shaped like a public identifier' });
    });

    test('is refused when the database already holds it', async () => {
      await Article.create({ slug: 'taken', title: 'x' });

      expect(
        await errorsOf(Article.create({ slug: 'taken', title: 'y' }))
      ).toEqual({ slug: 'must be unique' });
    });
  });

  describe("on: 'change'", () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ Article, adapter } = await boot({ from: 'title', on: 'change' }));
    });

    afterAll(() => adapter.stop());

    test('follows the source on a save, and the old url stops working', async () => {
      const article = await Article.create({ title: 'First name' });
      const before = article.slug;

      article.title = 'Second name';
      await article.save();

      expect(article.slug.startsWith('second-name-')).toBe(true);
      expect(await Article.findById(before)).toBeNull();
    });

    test('follows the source on a query update naming one document', async () => {
      const article = await Article.create({ title: 'Third name' });

      await Article.updateOne({ _id: article._id }, { title: 'Fourth name' });

      const found = await Article.findByKey(article._id);

      expect(found.slug.startsWith('fourth-name-')).toBe(true);
    });

    test('refuses a mass update that names the source', async () => {
      expect(
        await errorsOf(
          Article.updateMany({ body: null }, { title: 'One name for all' })
        )
      ).toEqual({ code: 'HENRI_MODEL_SLUG_MASS_WRITE' });
    });

    test('allows a mass update that does not', async () => {
      await expect(
        Article.updateMany({ body: null }, { body: 'swept' })
      ).resolves.toBeDefined();
    });
  });

  describe('suffix: false', () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ Article, adapter } = await boot({ from: 'title', suffix: false }));
    });

    afterAll(() => adapter.stop());

    test('is the slugified source and nothing else', async () => {
      const article = await Article.create({ title: 'How we ship' });

      expect(article.slug).toBe('how-we-ship');
    });

    test('leaves the unique index to refuse the second one', async () => {
      await Article.create({ title: 'Getting started' });

      expect(
        await errorsOf(Article.create({ title: 'Getting started' }))
      ).toEqual({ slug: 'must be unique' });
    });

    test('refuses a title it cannot fold rather than writing an empty name', async () => {
      expect(await errorsOf(Article.create({ title: 'こんにちは' }))).toEqual({
        code: 'HENRI_MODEL_SLUG_EMPTY',
      });
    });
  });
});
