const { build, target } = require('./helpers');
const { modelErrors } = require('@usehenri/core/src/base/model-errors');

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
 * The `{ field: message }` a controller would answer with
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

describe('slugs on a sequelize store', () => {
  describe('the column henri adds', () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Article = adapter.addModel(articleModel(), 'user');
      await adapter.start();
    });

    afterAll(() => adapter.stop());

    test('is unique and not null', () => {
      expect(Article.rawAttributes.slug.allowNull).toBe(false);
      // `true` everywhere but SQL Server, where henri names the constraint
      // so that a duplicate answers `{ slug: ... }` and not the name SQL
      // Server gave it (../index.js, nameUniqueConstraints)
      expect(Article.rawAttributes.slug.unique).toBe(
        target.name === 'mssql' ? 'Article_slug_unique' : true
      );
    });

    test('is filled from the source field on insert', async () => {
      const article = await Article.create({ title: 'How we ship' });

      expect(article.slug.startsWith('how-we-ship-')).toBe(true);
      expect(article.slug).toHaveLength('how-we-ship-'.length + 6);
    });

    test('is filled on a bulk insert too', async () => {
      const created = await Article.bulkCreate([
        { title: 'One thing' },
        { title: 'One thing' },
      ]);

      expect(created[0].slug.startsWith('one-thing-')).toBe(true);
      expect(created[0].slug).not.toBe(created[1].slug);
    });

    test('answers something for a title with no ASCII in it', async () => {
      const article = await Article.create({ title: 'こんにちは' });

      expect(article.slug).toHaveLength(6);
    });

    test('does not move when the title changes', async () => {
      const article = await Article.create({ title: 'First name' });
      const before = article.slug;

      await article.update({ title: 'Second name' });

      expect(article.slug).toBe(before);
    });
  });

  describe('the lookup', () => {
    let Article;
    let adapter;
    let article;

    beforeAll(async () => {
      ({ adapter } = build());
      Article = adapter.addModel(articleModel(), 'user');
      await adapter.start();
      article = await Article.create({ title: 'How we ship' });
    });

    afterAll(() => adapter.stop());

    test('findById() takes the slug and the public identifier', async () => {
      expect((await Article.findById(article.slug)).id).toBe(article.id);
      expect((await Article.findById(article.externalId)).id).toBe(article.id);
    });

    test('findById() does not take the primary key', async () => {
      expect(await Article.findById(article.id)).toBeNull();
      expect(await Article.findById(String(article.id))).toBeNull();
    });

    test('a name that names nothing answers the same null', async () => {
      expect(await Article.findById('4812')).toBeNull();
      expect(await Article.findById('no-such-article')).toBeNull();
    });

    test('findBySlug() takes a slug and nothing else', async () => {
      expect((await Article.findBySlug(article.slug)).id).toBe(article.id);
      expect(await Article.findBySlug(article.externalId)).toBeNull();
      expect(await Article.findBySlug(article.id)).toBeNull();
    });

    test('findByKey() is still the primary key door', async () => {
      expect((await Article.findByKey(article.id)).id).toBe(article.id);
    });
  });

  describe('a slug the application writes itself', () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Article = adapter.addModel(articleModel(), 'user');
      await adapter.start();
    });

    afterAll(() => adapter.stop());

    test('wins over the one henri would have made', async () => {
      const article = await Article.create({
        slug: 'how-we-ship',
        title: 'Something else entirely',
      });

      expect(article.slug).toBe('how-we-ship');
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
      ).toEqual({ slug: 'slug must be unique' });
    });
  });

  describe("on: 'change'", () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Article = adapter.addModel(
        articleModel({ from: 'title', on: 'change' }),
        'user'
      );
      await adapter.start();
    });

    afterAll(() => adapter.stop());

    test('follows the source, and the old url stops working', async () => {
      const article = await Article.create({ title: 'First name' });
      const before = article.slug;

      await article.update({ title: 'Second name' });

      expect(article.slug.startsWith('second-name-')).toBe(true);
      expect(await Article.findById(before)).toBeNull();
    });

    test('refuses a mass update that names the source', async () => {
      expect(
        await errorsOf(
          Article.update({ title: 'One name for all' }, { where: {} })
        )
      ).toEqual({ code: 'HENRI_MODEL_SLUG_MASS_WRITE' });
    });

    test('allows a mass update that does not', async () => {
      await expect(
        Article.update({ body: 'swept' }, { where: {} })
      ).resolves.toBeDefined();
    });
  });

  describe('suffix: false', () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Article = adapter.addModel(
        articleModel({ from: 'title', suffix: false }),
        'user'
      );
      await adapter.start();
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
      ).toEqual({ slug: 'slug must be unique' });
    });

    test('refuses a title it cannot fold rather than writing an empty name', async () => {
      expect(await errorsOf(Article.create({ title: 'こんにちは' }))).toEqual({
        code: 'HENRI_MODEL_SLUG_EMPTY',
      });
    });
  });
});
