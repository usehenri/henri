const { build, taskModel } = require('./helpers');

describe('timestamps, soft deletes and paginate (sqlite in memory)', () => {
  let adapter;
  let Task;
  let Note;
  let Bare;
  const hooks = [];

  beforeAll(async () => {
    ({ adapter } = build());
    Task = adapter.addModel(
      {
        ...taskModel,
        afterDestroy: (task, options) =>
          hooks.push(['afterDestroy', task.id, Boolean(options.force)]),
        beforeDestroy: (task) => hooks.push(['beforeDestroy', task.id]),
        options: { paranoid: true },
      },
      'user'
    );
    Note = adapter.addModel(
      { globalId: 'Note', identity: 'note', schema: { body: 'text' } },
      'user'
    );
    Bare = adapter.addModel(
      {
        globalId: 'Bare',
        identity: 'bare',
        options: { timestamps: false },
        schema: { body: 'text' },
      },
      'user'
    );
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  afterEach(async () => {
    await Task.withDeleted().destroy({ force: true });
    await Note.destroy();
    hooks.length = 0;
  });

  describe('timestamps', () => {
    test('a model without options gets createdAt and updatedAt', async () => {
      const note = await Note.create({ body: 'written' });

      expect(Note.timestamps).toBe(true);
      expect(note.createdAt).toBeInstanceOf(Date);
      expect(note.updatedAt).toBeInstanceOf(Date);
      expect(Object.keys(Note.fields)).toContain('createdAt');
    });

    test('options.timestamps false opts out', async () => {
      const bare = await Bare.create({ body: 'plain' });

      expect(Bare.timestamps).toBe(false);
      expect(bare.createdAt).toBeUndefined();
      expect(Object.keys(Bare.fields)).not.toContain('updatedAt');
    });

    test('updatedAt moves on an update, createdAt does not', async () => {
      const note = await Note.create({ body: 'first' });
      const created = note.createdAt.getTime();

      await new Promise((resolve) => setTimeout(resolve, 5));
      await note.update({ body: 'second' });

      expect(note.createdAt.getTime()).toBe(created);
      expect(note.updatedAt.getTime()).toBeGreaterThanOrEqual(created);
    });
  });

  describe('soft deletes (options.paranoid)', () => {
    test('destroy stamps deletedAt and hides the row', async () => {
      const task = await Task.create({ name: 'archived' });

      await task.destroy();

      expect(task.deletedAt).toBeInstanceOf(Date);
      expect(task.isNew).toBe(false);
      expect(await Task.count()).toBe(0);
      expect(await Task.findById(task.id)).toBeNull();
      expect(await Task.find()).toEqual([]);
      expect(await Task.exists({ name: 'archived' })).toBe(false);
      expect(hooks).toEqual([
        ['beforeDestroy', task.id],
        ['afterDestroy', task.id, false],
      ]);
    });

    test('withDeleted, onlyDeleted and restore bring the row back', async () => {
      const kept = await Task.create({ name: 'kept' });
      const gone = await Task.create({ name: 'gone' });

      await gone.destroy();

      expect(await Task.withDeleted().count()).toBe(2);
      expect(await Task.onlyDeleted().pluck('name')).toEqual(['gone']);
      expect((await Task.findById(gone.id, { withDeleted: true })).name).toBe(
        'gone'
      );

      await gone.restore();

      expect(gone.deletedAt).toBeNull();
      expect(await Task.pluck('name')).toEqual([kept.name, gone.name]);
    });

    test('mass destroy and restore work on a condition', async () => {
      await Task.create([{ name: 'one' }, { name: 'two' }, { name: 'three' }]);

      expect(await Task.destroy({ name: ['one', 'two'] })).toBe(2);
      expect(await Task.pluck('name')).toEqual(['three']);
      expect(await Task.restore({ name: 'one' })).toBe(1);
      expect(await Task.pluck('name')).toEqual(['one', 'three']);
    });

    test('force deletes for real, soft deleted rows included', async () => {
      const task = await Task.create({ name: 'temporary' });

      await task.destroy();
      await Task.destroy({ name: 'temporary' }, { force: true });

      expect(await Task.withDeleted().count()).toBe(0);
    });

    test('updates and counts ignore the soft deleted rows', async () => {
      const task = await Task.create({ name: 'stale' });

      await Task.create({ name: 'fresh' });
      await task.destroy();

      expect(await Task.update({}, { category: 'high' })).toBe(1);
      expect(await Task.countDocuments()).toBe(1);
      expect(
        (await Task.findById(task.id, { withDeleted: true })).category
      ).toBe('low');
    });

    test('deletedAt is never mass-assigned', async () => {
      const task = await Task.create({
        deletedAt: new Date(),
        name: 'honest',
      });

      expect(task.deletedAt).toBeNull();
      expect(await Task.count()).toBe(1);
    });

    test('a model without paranoid deletes for real', async () => {
      const note = await Note.create({ body: 'bye' });

      expect(Note.paranoid).toBe(false);
      await note.destroy();

      expect(note.isNew).toBe(true);
      expect(await Note.count()).toBe(0);
      expect(Object.keys(Note.fields)).not.toContain('deletedAt');
    });
  });

  describe('paginate', () => {
    beforeEach(async () => {
      await Task.create(['a', 'b', 'c', 'd', 'e'].map((name) => ({ name })));
    });

    test('returns the records and the counters res.collection wants', async () => {
      const page = await Task.paginate({ page: 2, perPage: 2 });

      expect(page.records.map((task) => task.name)).toEqual(['c', 'd']);
      expect(page).toMatchObject({ page: 2, pages: 3, perPage: 2, total: 5 });
    });

    test('defaults to the first page of 25 and bounds the numbers', async () => {
      const page = await Task.paginate();

      expect(page).toMatchObject({ page: 1, pages: 1, perPage: 25, total: 5 });
      expect(page.records).toHaveLength(5);

      const bad = await Task.paginate({ page: 'x', perPage: -3 });

      expect(bad).toMatchObject({ page: 1, perPage: 25 });
    });

    test('takes the query options and chains on a relation', async () => {
      const filtered = await Task.paginate({
        order: '-name',
        page: 1,
        perPage: 2,
        where: { name: ['a', 'b', 'c'] },
      });

      expect(filtered.total).toBe(3);
      expect(filtered.records.map((task) => task.name)).toEqual(['c', 'b']);

      const chained = await Task.where({ done: false })
        .order('name')
        .paginate({ page: 3, perPage: 2 });

      expect(chained).toMatchObject({ page: 3, pages: 3, total: 5 });
      expect(chained.records.map((task) => task.name)).toEqual(['e']);
    });

    test('counts only the rows that are not soft deleted', async () => {
      await Task.destroy({ name: ['a', 'b'] });

      const page = await Task.paginate({ perPage: 10 });
      const all = await Task.withDeleted().paginate({ perPage: 10 });

      expect(page.total).toBe(3);
      expect(all.total).toBe(5);
    });
  });
});
