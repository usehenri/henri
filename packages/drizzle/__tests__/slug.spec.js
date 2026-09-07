const { build } = require('./helpers');

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
 * The error a write threw, as `{ field: message }` or `{ code }`
 *
 * @param {Promise} promise The write
 * @returns {Promise<object>} What it refused with
 */
const errorsOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error.toJSON ? error.toJSON() : { code: error.code };
  }

  return null;
};

describe('slugs on a drizzle store', () => {
  describe('the column henri adds', () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Article = adapter.addModel(articleModel(), 'user');
      await adapter.start();
    });

    afterAll(() => adapter.stop());

    test('is unique, not null, and the length of the name plus its suffix', () => {
      expect(Article.fields.slug).toMatchObject({
        required: true,
        type: 'string',
        unique: true,
      });
      expect(Article.fields.slug.length).toBe(87);
    });

    test('is filled from the source field on insert', async () => {
      const article = await Article.create({ title: 'How we ship' });

      expect(article.slug.startsWith('how-we-ship-')).toBe(true);
      expect(article.slug).toHaveLength('how-we-ship-'.length + 6);
    });

    test('lets two records share a title', async () => {
      const first = await Article.create({ title: 'Getting started' });
      const second = await Article.create({ title: 'Getting started' });

      expect(first.slug).not.toBe(second.slug);
      expect(first.slug.startsWith('getting-started-')).toBe(true);
      expect(second.slug.startsWith('getting-started-')).toBe(true);
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

    test('findById() takes the slug', async () => {
      const found = await Article.findById(article.slug);

      expect(found.id).toBe(article.id);
    });

    test('findById() still takes the public identifier', async () => {
      const found = await Article.findById(article.externalId);

      expect(found.id).toBe(article.id);
    });

    test('findById() does not take the primary key', async () => {
      // The whole point: a slug column answering a `WHERE slug = ?` cannot
      // say anything about a row named by its number
      expect(await Article.findById(article.id)).toBeNull();
      expect(await Article.findById(String(article.id))).toBeNull();
      expect(await Article.findById(1)).toBeNull();
    });

    test('a number that names no slug answers the null an unknown slug answers', async () => {
      expect(await Article.findById('4812')).toBeNull();
      expect(await Article.findById('no-such-article')).toBeNull();
      expect(
        await Article.findById('01a07d06-e6c4-73cd-9021-31eb06befdd7')
      ).toBeNull();
    });

    test('a slug that is a number reaches its own row and no other', async () => {
      const numbered = await Article.create({
        slug: String(article.id),
        title: 'Numbered',
      });
      const found = await Article.findById(String(article.id));

      expect(found.id).toBe(numbered.id);
      expect(found.id).not.toBe(article.id);
    });

    test('findBySlug() takes a slug and nothing else', async () => {
      expect((await Article.findBySlug(article.slug)).id).toBe(article.id);
      expect(await Article.findBySlug(article.externalId)).toBeNull();
      expect(await Article.findBySlug(article.id)).toBeNull();
    });

    test('findByKey() is still the primary key door', async () => {
      expect((await Article.findByKey(article.id)).id).toBe(article.id);
    });

    test('findByIdAndUpdate() reaches the same rows findById() does', async () => {
      const updated = await Article.findByIdAndUpdate(article.slug, {
        body: 'written',
      });

      expect(updated.id).toBe(article.id);
      expect(await Article.findByIdAndUpdate(article.id, { body: 'no' })).toBe(
        null
      );
      expect(
        (await Article.findByIdAndUpdate(article.externalId, { body: 'yes' }))
          .id
      ).toBe(article.id);
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

    test('may be any script henri ships no table for', async () => {
      const article = await Article.create({
        slug: 'こんにちは',
        title: 'Hello',
      });

      expect(article.slug).toBe('こんにちは');
      expect((await Article.findById('こんにちは')).id).toBe(article.id);
    });

    test('is refused when it cannot be one path segment', async () => {
      expect(
        await errorsOf(Article.create({ slug: 'a/b', title: 'x' }))
      ).toEqual({ slug: 'must not hold "/"' });
      expect(
        await errorsOf(Article.create({ slug: 'a b', title: 'x' }))
      ).toEqual({ slug: 'must not hold a space or a control character' });
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

    test('is refused when it is a path henri already mounts', async () => {
      expect(
        await errorsOf(Article.create({ slug: 'new', title: 'x' }))
      ).toEqual({
        slug: 'must not be "new", which is a path henri already mounts',
      });
    });

    test('is refused when the database already holds it', async () => {
      await Article.create({ slug: 'taken', title: 'x' });

      expect(
        await errorsOf(Article.create({ slug: 'taken', title: 'y' }))
      ).toEqual({ slug: 'must be unique' });
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
      ).toEqual({ slug: 'must be unique' });
    });

    test('refuses a title it cannot fold rather than writing an empty name', async () => {
      expect(await errorsOf(Article.create({ title: 'こんにちは' }))).toEqual({
        code: 'HENRI_MODEL_SLUG_EMPTY',
      });
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

    test('leaves the slug alone when the write does not name the source', async () => {
      const article = await Article.create({ title: 'Third name' });
      const before = article.slug;

      await article.update({ body: 'written' });

      expect(article.slug).toBe(before);
    });

    test('refuses a mass update that names the source', async () => {
      const refused = await errorsOf(
        Article.update({ body: 'written' }, { title: 'One name for all' })
      );

      expect(refused).toEqual({ code: 'HENRI_MODEL_SLUG_MASS_WRITE' });
    });

    test('allows a mass update that does not', async () => {
      await expect(
        Article.update({ title: 'Third name' }, { body: 'swept' })
      ).resolves.toBeDefined();
    });
  });

  describe('a declaration henri cannot carry out', () => {
    /**
     * Adds a model and answers the code it was refused with
     *
     * @param {*} slug What `options.slug` says
     * @param {object} [schema] The schema, when it matters
     * @returns {?string} The code
     */
    const refusalOf = (slug, schema) => {
      const { adapter } = build();
      const model = articleModel(slug);

      if (schema) {
        model.schema = schema;
      }

      try {
        adapter.addModel(model, 'user');
      } catch (error) {
        return `${error.code}: ${error.message}`;
      }

      return null;
    };

    test('a "from" the schema does not declare', () => {
      expect(refusalOf('headline')).toContain(
        'HENRI_MODEL_SLUG_DECLARATION_INVALID'
      );
      expect(refusalOf('headline')).toContain('the schema does not declare');
    });

    test('a "from" that is not made of words', () => {
      expect(refusalOf('views', { views: { type: 'integer' } })).toContain(
        'not a string or a text'
      );
    });

    test('a "from" that is encrypted', () => {
      expect(
        refusalOf('title', { title: { encrypted: true, type: 'string' } })
      ).toContain('which is encrypted');
    });

    test('a schema that declares the column itself', () => {
      expect(
        refusalOf('title', {
          slug: { type: 'string' },
          title: { type: 'string' },
        })
      ).toContain('a "slug" field of its own');
    });

    test('an unknown key', () => {
      expect(refusalOf({ from: 'title', history: true })).toContain(
        'the unknown key "history"'
      );
    });

    test('an "on" henri has no event for', () => {
      expect(refusalOf({ from: 'title', on: 'save' })).toContain(
        'an "on" of "save"'
      );
    });
  });

  describe('a model with no slug', () => {
    let Article;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Article = adapter.addModel(
        { ...articleModel(), options: { timestamps: true } },
        'user'
      );
      await adapter.start();
    });

    afterAll(() => adapter.stop());

    test('has no column, no declaration and no lookup', async () => {
      const article = await Article.create({ title: 'How we ship' });

      expect(Article.fields.slug).toBeUndefined();
      expect(Article.slug).toBeNull();
      expect(await Article.findBySlug('how-we-ship')).toBeNull();
      expect(await Article.findById(article.externalId)).not.toBeNull();
      expect(await Article.findById(article.id)).toBeNull();
    });
  });
});
