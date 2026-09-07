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
 * An adapter with the model on a database of its own
 *
 * @param {object} [validates] The `validates` block
 * @returns {Promise<{adapter: object, Post: object}>} Both
 */
const boot = async (validates) => {
  const adapter = new Mongoose(
    'default',
    { url: mongod.getUri(`validations${(sequence += 1)}`) },
    fakeHenri()
  );
  const Post = adapter.addModel(postModel(validates), 'user');

  await adapter.start();

  return { Post, adapter };
};

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
    return modelErrors(error) || { code: error.code };
  }

  return null;
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
}, 60000);

afterAll(() => mongod && mongod.stop());

describe('validations on a mongoose store', () => {
  describe('what a validates block checks', () => {
    let Post;
    let adapter;

    beforeAll(async () => {
      ({ Post, adapter } = await boot({
        slug: { maxLength: 8, minLength: 3, pattern: /^[a-z-]+$/u },
        views: { max: 1000, min: 0 },
      }));
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

    test('on a document save', async () => {
      const post = await Post.create({ title: 'one' });

      post.slug = 'no';
      expect(await errorsOf(post.save())).toEqual({
        slug: 'must be at least 3 characters',
      });
    });

    test('on insertMany', async () => {
      expect(
        await errorsOf(Post.insertMany([{ slug: 'no', title: 'x' }]))
      ).toEqual({ slug: 'must be at least 3 characters' });
    });

    test('on the query updates, which Mongoose validates on none of', async () => {
      await Post.create({ title: 'two' });

      for (const write of [
        () => Post.updateOne({ title: 'two' }, { slug: 'no' }),
        () => Post.updateMany({ title: 'two' }, { slug: 'no' }),
        () => Post.findOneAndUpdate({ title: 'two' }, { slug: 'no' }),
        () => Post.updateOne({ title: 'two' }, { $set: { slug: 'no' } }),
      ]) {
        expect(await errorsOf(write())).toEqual({
          slug: 'must be at least 3 characters',
        });
      }

      expect((await Post.findOne({ title: 'two' })).slug).toBeUndefined();
    });

    test('and on the one that takes a value away', async () => {
      await Post.create({ title: 'three' });
      expect(
        await errorsOf(
          Post.updateOne({ title: 'three' }, { $unset: { title: '' } })
        )
      ).toEqual({ title: 'is required' });
    });

    test('a field the update does not name is left alone', async () => {
      await Post.create({ slug: 'fine', title: 'four' });
      await Post.updateOne({ title: 'four' }, { views: 3 });
      expect((await Post.findOne({ title: 'four' })).slug).toBe('fine');
    });
  });

  describe('the schema’s own required and enum', () => {
    let Post;
    let adapter;

    beforeAll(async () => {
      ({ Post, adapter } = await boot());
    });

    afterAll(() => adapter.stop());

    test('are checked on the query updates too, which is the hole', async () => {
      // Measured before this existed: `updateMany` wrote a null over a
      // required field and a value outside the enum into the document,
      // because Mongoose runs its own validators on save(), create() and
      // insertMany() and on nothing else
      await Post.create({ status: 'draft', title: 'here' });
      expect(
        await errorsOf(Post.updateMany({ title: 'here' }, { title: null }))
      ).toEqual({ title: 'is required' });
      expect(
        await errorsOf(Post.updateOne({ title: 'here' }, { status: 'x' }))
      ).toEqual({ status: 'must be one of draft, live' });

      const post = await Post.findOne({ title: 'here' });

      expect(post.title).toBe('here');
      expect(post.status).toBe('draft');
    });

    test('and answer henri’s sentence on the paths Mongoose did cover', async () => {
      expect(await errorsOf(Post.create({}))).toEqual({
        title: 'is required',
      });
      expect(await errorsOf(Post.create({ title: '   ' }))).toEqual({
        title: 'is required',
      });
    });
  });

  describe('a validator asking for the record', () => {
    let Post;
    let adapter;

    beforeAll(async () => {
      ({ Post, adapter } = await boot({
        status: {
          validate: (value, record) =>
            value !== 'live' || Boolean(record.body) || 'no body',
        },
      }));
    });

    afterAll(() => adapter.stop());

    test('gets it on a create and on a save', async () => {
      expect(
        await errorsOf(Post.create({ status: 'live', title: 'a' }))
      ).toEqual({ status: 'no body' });
      expect(
        await errorsOf(
          Post.create({ body: 'here', status: 'live', title: 'b' })
        )
      ).toBeNull();
    });

    test('and on a query update that names one document, which is read', async () => {
      await Post.create({ title: 'bare' });
      await Post.create({ body: 'has one', title: 'full' });
      expect(
        await errorsOf(Post.updateOne({ title: 'bare' }, { status: 'live' }))
      ).toEqual({ status: 'no body' });
      expect(
        await errorsOf(Post.updateOne({ title: 'full' }, { status: 'live' }))
      ).toBeNull();
    });

    test('while updateMany is refused, naming the loop', async () => {
      const error = await Post.updateMany(
        { title: 'bare' },
        { status: 'live' }
      ).catch((thrown) => thrown);

      expect(error.code).toBe('HENRI_MODEL_VALIDATION_MASS_WRITE');
      expect(error.message).toMatch(/status of Post is validated by a rule/u);
      // One that does not name the validated field is untouched
      await expect(
        Post.updateMany({ title: 'bare' }, { views: 1 })
      ).resolves.toBeDefined();
    });
  });

  describe('a write no Mongoose middleware reaches', () => {
    let Post;
    let adapter;

    beforeAll(async () => {
      ({ Post, adapter } = await boot({ views: { max: 10 } }));
    });

    afterAll(() => adapter.stop());

    test('bulkWrite is refused', async () => {
      const error = await Post.bulkWrite([
        { insertOne: { document: { title: 'a', views: 99 } } },
      ]).catch((thrown) => thrown);

      expect(error.code).toBe('HENRI_MODEL_VALIDATION_UNCHECKED_WRITE');
      expect(error.message).toMatch(/Mongoose runs no middleware/u);
    });

    test('so is an operator that describes a change rather than a value', async () => {
      await Post.create({ title: 'a', views: 1 });

      const error = await Post.updateOne(
        { title: 'a' },
        { $inc: { views: 100 } }
      ).catch((thrown) => thrown);

      expect(error.code).toBe('HENRI_MODEL_VALIDATION_UNCHECKED_WRITE');
      expect(error.message).toMatch(/views is changed by an operator/u);
      // An operator on a field nothing validates is nothing to refuse
      await expect(
        Post.updateOne({ title: 'a' }, { $unset: { slug: '' } })
      ).resolves.toBeDefined();
    });
  });

  describe('a declaration henri cannot carry out', () => {
    test('fails the boot, naming the model and the field', () => {
      const adapter = new Mongoose(
        'default',
        { url: mongod.getUri('validations-boot') },
        fakeHenri()
      );

      expect(() =>
        adapter.addModel(postModel({ title: { min: 3 } }), 'user')
      ).toThrow(/Post declares `validates.title` with "min"/u);
      expect(() =>
        adapter.addModel(postModel({ ttile: { maxLength: 3 } }), 'user')
      ).toThrow(/which its schema has no field for/u);
    });
  });
});
