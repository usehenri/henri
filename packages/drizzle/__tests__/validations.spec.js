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
 * A model whose name is unique, so the database has a refusal of its own
 *
 * @param {object} [validates] The `validates` block
 * @returns {object} The model file
 */
const noteModel = (validates) => ({
  globalId: 'Note',
  identity: 'note',
  options: { timestamps: true },
  schema: {
    slug: { type: 'string', unique: true },
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
      // One record per write, so the two refusals are independent of each
      // other. What one of them leaves on the record is the block below
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

  describe('what the record holds after a write the store refused', () => {
    // `update()` is `set()` then `save()`, so a refusal used to leave the
    // value the store refused on the record and the next `update()` was
    // measured against it (`packages/drizzle/model.js`, `rollbackOf()`)
    let Note;
    let adapter;

    beforeAll(async () => {
      ({ adapter } = build());
      Note = adapter.addModel(
        noteModel({ views: { max: 1000, min: 0 } }),
        'user'
      );
      await adapter.start();
    });

    afterAll(() => adapter.stop());

    test('a rule of the validates block puts its value back', async () => {
      const note = await Note.create({ title: 'a', views: 1 });

      expect(await errorsOf(note.update({ views: 9000 }))).toEqual({
        views: 'must be at most 1000',
      });
      expect(note.views).toBe(1);
      expect(note.changed()).toEqual([]);
    });

    test('the schema’s own required and enum do too', async () => {
      const note = await Note.create({ status: 'draft', title: 'b' });

      expect(await errorsOf(note.update({ title: null }))).toEqual({
        title: 'is required',
      });
      expect(note.title).toBe('b');
      expect(await errorsOf(note.update({ status: 'gone' }))).toEqual({
        status: 'must be one of draft, live',
      });
      expect(note.status).toBe('draft');
      expect(note.changed()).toEqual([]);
    });

    test('and so does the unique index, the database refusing', async () => {
      await Note.create({ slug: 'taken', title: 'c' });
      const note = await Note.create({ slug: 'mine', title: 'd' });

      expect(await errorsOf(note.update({ slug: 'taken' }))).toEqual({
        slug: 'must be unique',
      });
      expect(note.slug).toBe('mine');
      expect(note.changed()).toEqual([]);
    });

    test('so the next update is not measured against a refused value', async () => {
      const note = await Note.create({ title: 'e', views: 1 });

      await errorsOf(note.update({ views: 9000 }));
      // The write that used to be refused for a field it never named
      expect(await errorsOf(note.update({ title: 'renamed' }))).toBeNull();

      const stored = await Note.findByKey(note.id);

      expect([stored.title, stored.views]).toEqual(['renamed', 1]);
    });

    test('set() and save() are two steps and keep what was set', async () => {
      const note = await Note.create({ title: 'f', views: 1 });

      note.set({ views: 9000 });
      expect(await errorsOf(note.save())).toEqual({
        views: 'must be at most 1000',
      });
      // The one way to keep what a person typed after the store said no
      expect(note.views).toBe(9000);
    });

    test('a failure that is not a refusal rolls nothing back', async () => {
      const { adapter: other } = build();
      const Broken = other.addModel(
        {
          ...noteModel(),
          afterUpdate: () => {
            throw new Error('the hook says no');
          },
        },
        'user'
      );

      await other.start();

      const note = await Broken.create({ title: 'g', views: 1 });

      // The row moved before the hook ran, so the record keeps the value
      // that is now stored rather than being put back over it
      await expect(note.update({ views: 2 })).rejects.toThrow(
        'the hook says no'
      );
      expect(note.views).toBe(2);
      expect((await Broken.findByKey(note.id)).views).toBe(2);
      await other.stop();
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
