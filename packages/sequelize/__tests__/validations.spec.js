const { build, target } = require('./helpers');
const { modelErrors } = require('@usehenri/core/src/base/model-errors');

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
 * The `{ field: message }` a controller would answer with
 *
 * @param {Promise} promise The write
 * @returns {Promise<object>} The messages by field, through core's helper
 */
const errorsOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    // The point of the shape: whatever the ORM threw, this is what a
    // controller reads, and it is the same object on all three adapters
    return modelErrors(error) || { code: error.code };
  }

  return null;
};

describe('validations on a sequelize store', () => {
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
      expect(await errorsOf(Post.create({ title: 'b', views: -1 }))).toEqual({
        views: 'must be at least 0',
      });
      expect(
        await errorsOf(Post.create({ slug: 'shouting', title: 'c' }))
      ).toBeNull();
    });

    test('on an instance update', async () => {
      const post = await Post.create({ title: 'one' });

      expect(await errorsOf(post.update({ slug: 'no' }))).toEqual({
        slug: 'must be at least 3 characters',
      });
    });

    test('on the mass Model.update', async () => {
      await Post.create({ title: 'two' });
      expect(
        await errorsOf(
          Post.update({ views: 9000 }, { where: { title: 'two' } })
        )
      ).toEqual({ views: 'must be at most 1000' });
    });

    test('on bulkCreate, which Sequelize does not validate on its own', async () => {
      expect(
        await errorsOf(
          Post.bulkCreate([{ title: 'x' }, { slug: 'no', title: 'y' }])
        )
      ).toEqual({ slug: 'must be at least 3 characters' });
      // And nothing of the batch was written
      expect(await Post.count({ where: { title: 'x' } })).toBe(0);
    });

    test('on upsert', async () => {
      expect(await errorsOf(Post.upsert({ slug: 'no', title: 'up' }))).toEqual({
        slug: 'must be at least 3 characters',
      });
    });

    test('a field the update does not name is left alone', async () => {
      const post = await Post.create({ slug: 'fine', title: 'three' });

      await post.update({ title: 'four' });
      expect((await Post.findByPk(post.id)).slug).toBe('fine');
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

    test('answer henri’s sentence, whatever the dialect makes of the column', async () => {
      expect(await errorsOf(Post.create({}))).toEqual({
        title: 'is required',
      });
      // The one this fixes: on postgres and mysql the column is a native
      // ENUM, so the server used to refuse the value with a
      // SequelizeDatabaseError -- which `henri.model.errors()` answers
      // null for, so an application answered 500 where sqlite answered 422
      expect(await errorsOf(Post.create({ status: 'x', title: 'a' }))).toEqual({
        status: 'must be one of draft, live',
      });
      expect(
        await errorsOf(Post.bulkCreate([{ status: 'x', title: 'b' }]))
      ).toEqual({ status: 'must be one of draft, live' });
      expect(
        await errorsOf(
          Post.update({ status: 'x' }, { where: { title: 'nobody' } })
        )
      ).toEqual({ status: 'must be one of draft, live' });
    });

    test('a blank string is a missing value, as it is on the other two', async () => {
      expect(await errorsOf(Post.create({ title: '   ' }))).toEqual({
        title: 'is required',
      });
    });
  });

  describe('a validator asking for the record', () => {
    let Post;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Post = adapter.addModel(
        postModel({
          status: {
            validate: (value, record) =>
              value !== 'live' || Boolean(record.body) || 'no body',
          },
        }),
        'user'
      );
      await adapter.start();
    });

    afterAll(() => adapter.stop());

    test('gets it on a create and on an instance update', async () => {
      expect(
        await errorsOf(Post.create({ status: 'live', title: 'a' }))
      ).toEqual({ status: 'no body' });
      expect(
        await errorsOf(
          Post.create({ body: 'here', status: 'live', title: 'b' })
        )
      ).toBeNull();

      const post = await Post.create({ title: 'c' });

      expect(await errorsOf(post.update({ status: 'live' }))).toEqual({
        status: 'no body',
      });
    });

    test('and the mass update is refused', async () => {
      const error = await Post.update(
        { status: 'live' },
        { where: { title: 'a' } }
      ).catch((thrown) => thrown);

      expect(error.code).toBe('HENRI_MODEL_VALIDATION_MASS_WRITE');
      expect(error.message).toMatch(/status of Post is validated by a rule/u);
      // A mass write that does not name the validated field is untouched
      await expect(
        Post.update({ views: 2 }, { where: { title: 'a' } })
      ).resolves.toBeDefined();
    });
  });

  describe('a write no Sequelize hook reaches', () => {
    test('increment on a validated field is refused', async () => {
      const { adapter } = build();
      const Post = adapter.addModel(postModel({ views: { max: 10 } }), 'user');

      await adapter.start();

      const post = await Post.create({ title: 'a', views: 1 });
      const error = await Post.increment('views', {
        where: { id: post.id },
      }).catch((thrown) => thrown);

      expect(error.code).toBe('HENRI_MODEL_VALIDATION_UNCHECKED_WRITE');
      expect(error.message).toMatch(/Post\.increment\(\) writes without/u);
      // A field nothing validates still increments
      await expect(
        Post.increment('id', { by: 0, where: { id: post.id } })
      ).resolves.toBeDefined();
      await adapter.stop();
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
    });

    test('so does a `validate` function in the schema, which Sequelize ignores', () => {
      const { adapter } = build();
      const model = postModel();

      model.schema.slug = { type: 'string', validate: () => true };
      expect(() => adapter.addModel(model, 'user')).toThrow(
        /has a `validate` function, which Sequelize reads as nothing/u
      );
    });
  });

  afterAll(() => target.cleanup());
});
