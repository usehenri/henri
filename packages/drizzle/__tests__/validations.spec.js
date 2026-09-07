const { build, target } = require('./helpers');

/**
 * A model file declaring what must be true of its records
 *
 * @param {object} [validates] The `validates` block
 * @returns {object} The model file
 */
const postModel = (validates) => ({
  globalId: 'Post',
  identity: 'post',
  options: { timestamps: true },
  schema: {
    body: { type: 'text' },
    slug: { type: 'string' },
    status: { enum: ['draft', 'live'], type: 'string' },
    title: { required: true, type: 'string' },
    views: { type: 'integer' },
  },
  store: 'default',
  validates,
});

/**
 * The `{ field: message }` of a rejected write
 *
 * @param {Promise} promise The write
 * @returns {Promise<object>} The messages by field
 */
const errorsOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error.toJSON ? error.toJSON() : { code: error.code };
  }

  return null;
};

describe('validations on a drizzle store', () => {
  describe('what a validates block checks', () => {
    let Post;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Post = adapter.addModel(
        postModel({
          slug: { maxLength: 8, minLength: 3, pattern: /^[a-z-]+$/u },
          views: { max: 1000, min: 0 },
        }),
        'user'
      );
      await adapter.start();
    });

    afterAll(() => adapter.stop());

    test('on a create', async () => {
      expect(await errorsOf(Post.create({ slug: 'A', title: 'a' }))).toEqual({
        slug: 'must be at least 3 characters',
      });
      expect(
        await errorsOf(Post.create({ slug: 'shouting', title: 'a' }))
      ).toBeNull();
      expect(
        await errorsOf(Post.create({ slug: 'Shouting', title: 'b' }))
      ).toEqual({ slug: 'is not in the expected format' });
      expect(await errorsOf(Post.create({ title: 'c', views: -1 }))).toEqual({
        views: 'must be at least 0',
      });
    });

    test('on an instance update', async () => {
      // One record per write: `instance.update()` is `set()` then
      // `save()`, so a refused value is still on the instance afterwards
      expect(
        await errorsOf(
          (await Post.create({ title: 'one' })).update({ slug: 'no' })
        )
      ).toEqual({ slug: 'must be at least 3 characters' });
      expect(
        await errorsOf(
          (await Post.create({ title: 'two' })).update({ views: 9000 })
        )
      ).toEqual({ views: 'must be at most 1000' });
    });

    test('on a mass update, which is the one a save() hook would miss', async () => {
      await Post.create({ title: 'two' });
      expect(
        await errorsOf(Post.update({ title: 'two' }, { slug: 'no' }))
      ).toEqual({ slug: 'must be at least 3 characters' });
      expect(
        await errorsOf(Post.where({ title: 'two' }).update({ views: 9000 }))
      ).toEqual({ views: 'must be at most 1000' });
      expect(
        await errorsOf(Post.updateMany({ title: 'two' }, { slug: 'no' }))
      ).toEqual({ slug: 'must be at least 3 characters' });
    });

    test('a field the update does not name is left alone', async () => {
      const post = await Post.create({ slug: 'fine', title: 'three' });

      await post.update({ title: 'four' });
      expect((await Post.findById(post.externalId)).slug).toBe('fine');
    });
  });

  describe('a validator of one’s own', () => {
    test('reads the value, and says what is wrong with it', async () => {
      const { adapter } = build();
      const Post = adapter.addModel(
        postModel({
          slug: {
            validate: (value) => value !== 'taken' || 'that one is spoken for',
          },
        }),
        'user'
      );

      await adapter.start();
      expect(
        await errorsOf(Post.create({ slug: 'taken', title: 'a' }))
      ).toEqual({ slug: 'that one is spoken for' });
      // And on the mass path too, because it only reads the value
      await Post.create({ slug: 'free', title: 'b' });
      expect(
        await errorsOf(Post.update({ title: 'b' }, { slug: 'taken' }))
      ).toEqual({ slug: 'that one is spoken for' });
      await adapter.stop();
    });

    test('a rule asking for the record gets it, on every single write', async () => {
      const { adapter } = build();
      const Post = adapter.addModel(
        postModel({
          status: {
            validate: (value, record) =>
              value !== 'live' ||
              Boolean(record.body) ||
              'cannot go live without a body',
          },
        }),
        'user'
      );

      await adapter.start();
      expect(
        await errorsOf(Post.create({ status: 'live', title: 'a' }))
      ).toEqual({ status: 'cannot go live without a body' });
      expect(
        await errorsOf(
          Post.create({ body: 'here', status: 'live', title: 'b' })
        )
      ).toBeNull();

      const empty = await Post.create({ title: 'c' });

      // The record it is given is the record as it will be, so a body
      // written in the same call counts
      expect(await errorsOf(empty.update({ status: 'live' }))).toEqual({
        status: 'cannot go live without a body',
      });
      expect(
        await errorsOf(empty.update({ body: 'now', status: 'live' }))
      ).toBeNull();
      await adapter.stop();
    });

    test('and a mass write on that model is refused, naming the loop', async () => {
      const { adapter } = build();
      const Post = adapter.addModel(
        postModel({
          status: { validate: (value, record) => Boolean(record) },
        }),
        'user'
      );

      await adapter.start();
      await Post.create({ title: 'a' });

      for (const write of [
        () => Post.update({ title: 'a' }, { status: 'live' }),
        () => Post.updateMany({ title: 'a' }, { status: 'live' }),
        () => Post.where({ title: 'a' }).update({ status: 'live' }),
      ]) {
        const error = await write().catch((thrown) => thrown);

        expect(error.code).toBe('HENRI_MODEL_VALIDATION_MASS_WRITE');
        expect(error.message).toMatch(/status of Post is validated by a rule/u);
        expect(error.message).toMatch(
          /for \(const record of await Post\.find\(where\)\) await record\.update\(attrs\)/u
        );
      }

      // A mass write that does not name the validated field still works:
      // the refusal is about the rule, not about the model
      await expect(Post.update({ title: 'a' }, { views: 3 })).resolves.toBe(1);
      await adapter.stop();
    });

    test('findByIdAndUpdate reads the record rather than refusing', async () => {
      const { adapter } = build();
      const Post = adapter.addModel(
        postModel({
          status: {
            validate: (value, record) =>
              value !== 'live' || Boolean(record.body) || 'no body',
          },
        }),
        'user'
      );

      await adapter.start();

      const post = await Post.create({ body: 'here', title: 'a' });
      const bare = await Post.create({ title: 'b' });

      await expect(
        Post.findByIdAndUpdate(post.externalId, { status: 'live' })
      ).resolves.toMatchObject({ status: 'live' });
      expect(
        await errorsOf(
          Post.findByIdAndUpdate(bare.externalId, { status: 'live' })
        )
      ).toEqual({ status: 'no body' });
      await adapter.stop();
    });
  });

  describe('the schema’s own required and enum', () => {
    let Post;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Post = adapter.addModel(postModel(), 'user');
      await adapter.start();
    });

    afterAll(() => adapter.stop());

    test('are the same sentence on every write path', async () => {
      expect(await errorsOf(Post.create({}))).toEqual({
        title: 'is required',
      });
      expect(await errorsOf(Post.create({ status: 'x', title: 'a' }))).toEqual({
        status: 'must be one of draft, live',
      });

      await Post.create({ title: 'here' });
      expect(
        await errorsOf(Post.update({ title: 'here' }, { status: 'x' }))
      ).toEqual({ status: 'must be one of draft, live' });
    });
  });

  describe('a declaration henri cannot carry out', () => {
    test('fails the boot, naming the model and the field', () => {
      const { adapter } = build();

      expect(() =>
        adapter.addModel(postModel({ title: { min: 3 } }), 'user')
      ).toThrow(/Post declares `validates.title` with "min"/u);
      expect(() =>
        adapter.addModel(postModel({ ttile: { maxLength: 3 } }), 'user')
      ).toThrow(/which its schema has no field for/u);

      const thrown = (() => {
        try {
          return adapter.addModel(
            postModel({ title: { maxLenght: 3 } }),
            'user'
          );
        } catch (error) {
          return error;
        }
      })();

      expect(thrown.code).toBe('HENRI_MODEL_VALIDATION_INVALID');
    });
  });

  afterAll(() => target.cleanup());
});
