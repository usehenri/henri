const { driverError } = require('../dialects');
const { ValidationError } = require('../validation');
const { build, target, taskModel } = require('./helpers');

// The driver error code of a foreign key violation
const FOREIGN_KEY = {
  mysql: 'ER_NO_REFERENCED_ROW_2',
  postgres: '23503',
  sqlite: 'SQLITE_CONSTRAINT_FOREIGNKEY',
};

/**
 * The parameter placeholder of the target (`?`, or `$1` on postgres)
 *
 * @param {number} index The parameter position, from 1
 * @returns {string} The placeholder
 */
const placeholder = (index) => target.dialect.placeholder(index);

describe(`model API (${target.name})`, () => {
  let adapter;
  let Task;
  let Post;
  let Author;
  let Profile;
  const hooks = [];

  beforeAll(async () => {
    ({ adapter } = build());
    Task = adapter.addModel(
      {
        ...taskModel,
        afterCreate: (task) => hooks.push(['afterCreate', task.name]),
        afterDestroy: (task) => hooks.push(['afterDestroy', task.id]),
        afterUpdate: (task) => hooks.push(['afterUpdate', task.name]),
        beforeCreate: (values) => {
          values.name = values.name.trim();
        },
        beforeDestroy: (task) => hooks.push(['beforeDestroy', task.id]),
        beforeUpdate: (values) => hooks.push(['beforeUpdate', values]),
        hooks: {
          beforeValidate: (attrs) => {
            if (attrs.name === 'shout') {
              attrs.name = 'SHOUT';
            }
          },
        },
        schema: {
          ...taskModel.schema,
          notes: { maxLength: 10, type: 'text' },
          priority: { max: 5, min: 1, type: 'integer' },
          slug: {
            match: [/^[a-z-]+$/, 'must be a slug'],
            type: 'string',
          },
          tags: 'json',
          weight: {
            type: 'number',
            validate: (value) => value !== 13 || 'is unlucky',
          },
        },
      },
      'user'
    );
    Author = adapter.addModel(
      { globalId: 'Author', identity: 'author', schema: { name: 'string' } },
      'user'
    );
    Post = adapter.addModel(
      {
        /**
         * Posts belong to an author, authors have many posts and one profile
         *
         * @param {object} models The models
         * @returns {void}
         */
        associate: (models) => {
          models.Post.belongsTo(models.Author, { as: 'author' });
          models.Author.hasMany(models.Post, {
            as: 'posts',
            foreignKey: 'authorId',
          });
          models.Author.hasOne(models.Profile, { as: 'profile' });
        },
        globalId: 'Post',
        identity: 'post',
        schema: { title: { required: true, type: 'string' } },
      },
      'user'
    );
    Profile = adapter.addModel(
      { globalId: 'Profile', identity: 'profile', schema: { bio: 'text' } },
      'user'
    );
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  afterEach(async () => {
    await Task.destroy();
    await Post.destroy();
    await Profile.destroy();
    await Author.destroy();
    hooks.length = 0;
  });

  describe('create and read', () => {
    test('creates rows with defaults, coercion and timestamps', async () => {
      const task = await Task.create({ name: '  write docs ', priority: '3' });

      expect(task.id).toEqual(expect.any(Number));
      expect(task.name).toBe('write docs');
      expect(task.category).toBe('low');
      expect(task.done).toBe(false);
      expect(task.priority).toBe(3);
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.updatedAt).toEqual(task.createdAt);
      expect(task.isNew).toBe(false);
      expect(task.externalId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      // The primary key never leaves the server: the public identifier does
      expect(JSON.parse(JSON.stringify(task))).toEqual({
        category: 'low',
        createdAt: task.createdAt.toISOString(),
        done: false,
        externalId: task.externalId,
        name: 'write docs',
        notes: null,
        priority: 3,
        slug: null,
        tags: null,
        updatedAt: task.updatedAt.toISOString(),
        weight: null,
      });
    });

    test('creates many, stores json and reads them back', async () => {
      const created = await Task.create([
        { name: 'a', tags: ['x', 'y'] },
        { name: 'b', tags: { nested: true } },
      ]);

      expect(created).toHaveLength(2);
      expect((await Task.findByKey(created[0].id)).tags).toEqual(['x', 'y']);
      expect((await Task.findByKey(created[1].id)).tags).toEqual({
        nested: true,
      });
    });

    test('find, findOne, findById, all, first and last', async () => {
      const [one, two] = await Task.create([{ name: 'one' }, { name: 'two' }]);

      expect((await Task.find()).map((task) => task.name)).toEqual([
        'one',
        'two',
      ]);
      expect(
        (await Task.findAll({ name: 'two' })).map((task) => task.id)
      ).toEqual([two.id]);
      expect((await Task.findOne({ name: 'one' })).id).toBe(one.id);
      expect(await Task.findOne({ name: 'three' })).toBeNull();
      expect((await Task.findByKey(String(two.id))).name).toBe('two');
      expect((await Task.findByPk(two.id)).name).toBe('two');
      // The primary key is not an identifier from outside any more
      expect(await Task.findById(two.id)).toBeNull();
      expect((await Task.findById(two.externalId)).name).toBe('two');
      expect(await Task.findById('abc')).toBeNull();
      expect(await Task.findById(999)).toBeNull();
      expect((await Task.all()).length).toBe(2);
      expect((await Task.first()).id).toBe(one.id);
      expect((await Task.last()).id).toBe(two.id);
    });

    test('accepts sequelize style { where, order, limit } arguments', async () => {
      await Task.create([{ name: 'b' }, { name: 'a' }, { name: 'c' }]);

      const rows = await Task.find({ order: 'name', where: { done: false } });

      expect(rows.map((task) => task.name)).toEqual(['a', 'b', 'c']);
      expect(await Task.count({ where: { name: 'a' } })).toBe(1);
      expect((await Task.findOne({ order: '-name' })).name).toBe('c');
    });
  });

  describe('where chains', () => {
    beforeEach(async () => {
      await Task.create([
        { category: 'high', name: 'alpha', priority: 1 },
        { category: 'low', done: true, name: 'beta', priority: 2 },
        { category: 'urgent', name: 'gamma', priority: 3 },
      ]);
    });

    test('order, limit, offset, count, first, exists and pluck', async () => {
      const relation = Task.where({ done: false }).order('-priority');

      expect((await relation).map((task) => task.name)).toEqual([
        'gamma',
        'alpha',
      ]);
      expect((await relation.limit(1)).map((task) => task.name)).toEqual([
        'gamma',
      ]);
      expect(
        (await relation.limit(1).offset(1)).map((task) => task.name)
      ).toEqual(['alpha']);
      expect(await relation.count()).toBe(2);
      expect((await relation.first()).name).toBe('gamma');
      expect((await relation.last()).name).toBe('alpha');
      expect(await relation.exists()).toBe(true);
      expect(await Task.where({ name: 'nope' }).exists()).toBe(false);
      expect(await Task.order({ name: 'desc' }).pluck('name')).toEqual([
        'gamma',
        'beta',
        'alpha',
      ]);
      expect(await Task.order(['name', 'DESC']).limit(1).pluck('name')).toEqual(
        ['gamma']
      );
      expect(await Task.count()).toBe(3);
      expect(await Task.countDocuments({ done: true })).toBe(1);
    });

    test('operators, lists, null, or and functions', async () => {
      const names = async (condition) =>
        (await Task.where(condition).order('name')).map((task) => task.name);

      expect(await names({ priority: { gt: 1 } })).toEqual(['beta', 'gamma']);
      expect(await names({ priority: { $gte: 2, $lt: 3 } })).toEqual(['beta']);
      expect(await names({ category: ['high', 'urgent'] })).toEqual([
        'alpha',
        'gamma',
      ]);
      expect(await names({ category: { $nin: ['high', 'urgent'] } })).toEqual([
        'beta',
      ]);
      expect(await names({ name: { like: '%a' } })).toEqual([
        'alpha',
        'beta',
        'gamma',
      ]);
      expect(await names({ name: { ne: 'beta' } })).toEqual(['alpha', 'gamma']);
      expect(await names({ notes: null })).toEqual(['alpha', 'beta', 'gamma']);
      expect(await names({ notes: { not: null } })).toEqual([]);
      expect(await names({ or: [{ name: 'alpha' }, { priority: 3 }] })).toEqual(
        ['alpha', 'gamma']
      );
      expect(
        await names({
          $and: [{ done: false }, { priority: { between: [1, 2] } }],
        })
      ).toEqual(['alpha']);
      expect(await names({ category: [] })).toEqual([]);
      expect(await names((table, { eq }) => eq(table.name, 'beta'))).toEqual([
        'beta',
      ]);
      expect(await names(undefined)).toEqual(['alpha', 'beta', 'gamma']);
    });

    test('refuses unknown fields, operators and orders', async () => {
      await expect(Task.find({ nmae: 'x' })).rejects.toThrow(
        "Unknown field 'nmae' on Task"
      );
      await expect(Task.find({ name: { $regex: 'x' } })).rejects.toThrow(
        "Unknown operator '$regex'"
      );
      await expect(Task.order('nmae').toArray()).rejects.toThrow(
        "Unknown field 'nmae'"
      );
      await expect(
        Task.where({ name: 'x' }).include('nope').toArray()
      ).rejects.toThrow("Unknown association 'nope' on Task");
    });
  });

  describe('update and destroy', () => {
    test('findByIdAndUpdate validates, bumps updatedAt and answers null when missing', async () => {
      const task = await Task.create({ name: 'draft' });
      const before = task.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 5));

      const updated = await Task.findByIdAndUpdate(
        task.externalId,
        { done: 'true', name: 'final' },
        { new: true, runValidators: true }
      );

      expect(updated.done).toBe(true);
      expect(updated.name).toBe('final');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(before.getTime());
      expect(updated.createdAt).toEqual(task.createdAt);
      expect(await Task.findByIdAndUpdate(999, { name: 'x' })).toBeNull();
      expect(await Task.findByIdAndUpdate('nope', { name: 'x' })).toBeNull();
      expect(hooks).toContainEqual(['afterUpdate', 'final']);
      expect(
        hooks.find((entry) => entry[0] === 'beforeUpdate')[1]
      ).toMatchObject({ done: true, name: 'final' });
    });

    test('instances save only what changed', async () => {
      const task = await Task.create({ name: 'draft', priority: 2 });

      task.name = 'edited';
      expect(task.changed()).toEqual(['name']);
      await task.save();
      expect(task.changed()).toEqual([]);
      expect((await Task.findByKey(task.id)).name).toBe('edited');

      await task.update({ priority: 4 });
      expect((await Task.findByKey(task.id)).priority).toBe(4);

      const built = Task.build({ name: 'built' });

      expect(built.isNew).toBe(true);
      await built.save();
      expect(built.isNew).toBe(false);
      expect(built.id).toEqual(expect.any(Number));
      await built.reload();
      expect(built.category).toBe('low');
    });

    test('mass update and destroy return counts', async () => {
      await Task.create([
        { name: 'a' },
        { name: 'b' },
        { done: true, name: 'c' },
      ]);

      expect(await Task.update({ done: false }, { category: 'high' })).toBe(2);
      expect(await Task.updateMany({ name: 'c' }, { category: 'urgent' })).toBe(
        1
      );
      expect(
        await Task.where({ category: 'high' }).update({ done: true })
      ).toBe(2);
      expect(await Task.count({ done: true })).toBe(3);
      expect(await Task.update({}, {})).toBe(3);
      expect(await Task.where({ name: 'a' }).destroy()).toBe(1);
      expect(await Task.destroy({ name: ['b', 'c'] })).toBe(2);
      expect(await Task.deleteMany()).toBe(0);
    });

    test('findByIdAndDelete, findOneAndDelete and instance destroy run the hooks', async () => {
      const task = await Task.create({ name: 'gone' });
      const other = await Task.create({ name: 'other' });

      expect((await Task.findByIdAndDelete(task.externalId)).name).toBe('gone');
      expect(await Task.findByIdAndDelete(task.externalId)).toBeNull();
      expect(await Task.findByIdAndRemove('abc')).toBeNull();
      expect((await Task.findOneAndDelete({ name: 'other' })).id).toBe(
        other.id
      );
      expect(await Task.count()).toBe(0);
      expect(hooks).toContainEqual(['beforeDestroy', task.id]);
      expect(hooks).toContainEqual(['afterDestroy', task.id]);

      const third = await Task.create({ name: 'third' });

      await third.destroy();
      expect(third.isNew).toBe(true);
      expect(await Task.count()).toBe(0);
      expect(
        await Task.findOneAndUpdate({ name: 'nope' }, { name: 'x' })
      ).toBeNull();
    });
  });

  describe('validation', () => {
    test('throws a ValidationError with one message per field', async () => {
      let error;

      try {
        await Task.create({ category: 'nope', done: 'maybe', priority: 9 });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe(
        'Task validation failed: category: must be one of urgent, high, medium, low, done: must be a boolean, name: is required, priority: must be at most 5'
      );
      expect(
        Object.fromEntries(
          Object.entries(error.errors).map(([field, detail]) => [
            field,
            detail.message,
          ])
        )
      ).toEqual({
        category: 'must be one of urgent, high, medium, low',
        done: 'must be a boolean',
        name: 'is required',
        priority: 'must be at most 5',
      });
      expect(error.errors.name).toMatchObject({
        kind: 'required',
        path: 'name',
      });
      expect(error.toJSON()).toEqual({
        category: 'must be one of urgent, high, medium, low',
        done: 'must be a boolean',
        name: 'is required',
        priority: 'must be at most 5',
      });
    });

    test('coerces and checks numbers, dates, lengths, patterns and custom validators', async () => {
      const existing = await Task.create({ name: 'to update' });

      await expect(
        Task.create({ name: 'x', priority: 'abc' })
      ).rejects.toMatchObject({
        errors: { priority: { message: 'must be an integer' } },
      });
      await expect(
        Task.create({ name: 'x', priority: 0 })
      ).rejects.toMatchObject({
        errors: { priority: { message: 'must be at least 1' } },
      });
      await expect(
        Task.create({ name: 'x', notes: 'x'.repeat(11) })
      ).rejects.toMatchObject({
        errors: { notes: { message: 'must be at most 10 characters' } },
      });
      await expect(
        Task.create({ name: 'x', slug: 'Not Slug' })
      ).rejects.toMatchObject({
        errors: { slug: { message: 'must be a slug' } },
      });
      await expect(
        Task.create({ name: 'x', weight: 13 })
      ).rejects.toMatchObject({
        errors: { weight: { message: 'is unlucky' } },
      });
      await expect(
        Task.create({ name: 'x', weight: 'heavy' })
      ).rejects.toMatchObject({
        errors: { weight: { message: 'must be a number' } },
      });
      await expect(
        Task.findByIdAndUpdate(existing.externalId, { name: '' })
      ).rejects.toMatchObject({
        errors: { name: { message: 'is required' } },
      });

      const task = await Task.create({
        name: 'ok',
        slug: 'fine',
        weight: '1.5',
      });

      expect(task.weight).toBe(1.5);
      expect(task.slug).toBe('fine');
    });

    test('drops unknown attributes and never mass-assigns timestamps', async () => {
      const task = await Task.create({
        createdAt: new Date('2000-01-01'),
        name: 'safe',
        rogue: true,
      });

      expect(task.rogue).toBeUndefined();
      expect(task.createdAt.getFullYear()).not.toBe(2000);
    });

    test('runs beforeValidate before validation and the after hooks', async () => {
      const task = await Task.create({ name: 'shout' });

      expect(task.name).toBe('SHOUT');
      expect(hooks).toContainEqual(['afterCreate', 'SHOUT']);
    });
  });

  describe('associations', () => {
    test('adds the foreign keys and eager loads with include', async () => {
      const ada = await Author.create({ name: 'Ada' });
      const bob = await Author.create({ name: 'Bob' });
      const post = await Post.create({ authorId: ada.id, title: 'first' });

      await Post.create({ authorId: ada.id, title: 'second' });
      await Profile.create({ authorId: ada.id, bio: 'engine' });

      expect(Object.keys(Post.fields)).toContain('authorId');
      expect(Object.keys(Profile.fields)).toContain('authorId');

      const loaded = await Post.where({ id: post.id })
        .include('author')
        .first();

      expect(loaded.author).toBeInstanceOf(Author);
      expect(loaded.author.name).toBe('Ada');
      // Nested records are serialized the same way: no primary key
      const json = JSON.parse(JSON.stringify(loaded));

      expect(json).toMatchObject({
        author: { externalId: ada.externalId, name: 'Ada' },
        title: 'first',
      });
      expect(json.id).toBeUndefined();
      expect(json.author.id).toBeUndefined();
      // The foreign key stays what it is: joins are made of primary keys
      expect(json.authorId).toBe(ada.id);

      const authors = await Author.include('posts', 'profile').order('name');

      expect(authors[0].posts.map((entry) => entry.title)).toEqual([
        'first',
        'second',
      ]);
      expect(authors[0].posts[0]).toBeInstanceOf(Post);
      expect(authors[0].profile.bio).toBe('engine');
      expect(authors[1].posts).toEqual([]);
      expect(authors[1].profile).toBeNull();

      const nested = await Post.find({ include: ['author.posts'] });

      expect(nested[0].author.posts).toHaveLength(2);
      expect(
        (await Post.findByKey(post.id, { include: 'author' })).author.id
      ).toBe(ada.id);
      expect(
        await Post.where({ authorId: bob.id }).include('author').count()
      ).toBe(0);
    });

    test('rejects a foreign key to a missing row', async () => {
      const failed = await Post.create({
        authorId: 999,
        title: 'orphan',
      }).catch((error) => error);

      expect(failed).toBeInstanceOf(Error);
      expect(driverError(failed).code).toBe(FOREIGN_KEY[target.name]);
    });
  });

  describe('transactions and raw queries', () => {
    test('rolls back on error and commits otherwise, nested calls join', async () => {
      await expect(
        adapter.transaction(async () => {
          await Task.create({ name: 'inside' });
          await adapter.transaction(async () => {
            await Task.create({ name: 'nested' });
          });
          expect(await Task.count()).toBe(2);
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      expect(await Task.count()).toBe(0);

      const result = await adapter.transaction(async (tx) => {
        // The synchronous driver runs BEGIN/COMMIT on the database itself
        expect(tx === adapter.rawDatabase()).toBe(target.dialect.synchronous);
        await Task.create({ name: 'kept' });

        return 'done';
      });

      expect(result).toBe('done');
      expect(await Task.count()).toBe(1);
    });

    test('exposes ping and query', async () => {
      await Task.create({ name: 'raw' });

      await expect(adapter.ping()).resolves.toBe(true);

      const rows = await adapter.query(
        `SELECT COUNT(*) AS total FROM tasks WHERE name = ${placeholder(1)}`,
        ['raw']
      );

      // Postgres counts in a bigint, which the driver reads as a string
      expect(Number(rows[0].total)).toBe(1);

      await adapter.query(`UPDATE tasks SET name = ${placeholder(1)}`, [
        'renamed',
      ]);
      expect((await Task.first()).name).toBe('renamed');
    });
  });
});
