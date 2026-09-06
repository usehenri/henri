// Model versioning against a real Drizzle store.
//
// The feature lives in @usehenri/core and the table is per-dialect DDL, so
// this file runs it on whatever the environment points at -- sqlite
// offline, a PostgreSQL or a MySQL server with HENRI_TEST_POSTGRES_URL or
// HENRI_TEST_MYSQL_URL (`pnpm test:sql:live`).
const Versions = require('@usehenri/core/src/4.versions');

const { build, target, withKeys } = require('./helpers');
const { install } = require('@usehenri/core/src/base/version-store');

const bookModel = {
  globalId: 'Book',
  identity: 'book',
  options: { paranoid: true, timestamps: true, versioned: true },
  schema: {
    apiToken: { type: 'string' },
    notes: { type: 'text' },
    pages: { type: 'integer' },
    title: { required: true, type: 'string' },
  },
  store: 'default',
};

const shelfModel = {
  globalId: 'Shelf',
  identity: 'shelf',
  options: { timestamps: true },
  schema: { name: { type: 'string' } },
  store: 'default',
};

/**
 * A henri whose versions module is loaded against an adapter
 *
 * @param {object} henri The fake henri
 * @param {object} adapter The store adapter
 * @param {Array<object>} models The model files
 * @returns {Promise<object>} The versions module
 */
const versionsOn = async (henri, adapter, models) => {
  henri.model = { models, stores: { default: adapter } };
  henri.privacy = {
    modelOf: (name) => adapter.getModels()[name] || null,
  };

  const versions = new Versions();

  versions.henri = henri;
  henri.versions = versions;

  await versions.init();

  return versions;
};

describe(`versions on ${target.name}`, () => {
  let adapter = null;
  let henri = null;
  let versions = null;
  let Book = null;
  let Shelf = null;

  beforeAll(async () => {
    henri = await withKeys([], { versions: { keep: '30d' } });
    ({ adapter } = build({}, {}, 'versions'));
    adapter.henri = henri;
    henri.config.get = (key) =>
      ({ versions: { keep: '30d' } })[key] ?? undefined;
    henri.config.has = (key) => key === 'versions';
    [bookModel, shelfModel].forEach((model) => adapter.addModel(model, 'user'));
    await adapter.start();
    ({ Book, Shelf } = adapter.getModels());
    versions = await versionsOn(henri, adapter, [bookModel, shelfModel]);
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  beforeEach(async () => {
    await Book.withDeleted()
      .where({})
      .destroy({ force: true, versions: false });
    await Shelf.where({}).destroy({ force: true });
    await adapter.query(`DELETE FROM ${versions.settings.table}`);
  });

  test('the table is created and only a versioned model writes to it', async () => {
    expect(versions.enabled).toBe(true);
    expect(versions.watches('Book')).toBe(true);
    expect(versions.watches('Shelf')).toBe(false);

    await Shelf.create({ name: 'Fiction' });

    expect(await versions.count({})).toBe(0);
  });

  test('a create holds every stored field as null to value', async () => {
    const book = await Book.create({ pages: 300, title: 'Dune' });
    const [version] = await versions.of(book);

    expect(version.event).toBe('create');
    expect(version.model).toBe('Book');
    expect(version.record).toBe(book.externalId);
    expect(version.changes.title).toEqual([null, 'Dune']);
    expect(version.changes.pages).toEqual([null, 300]);
    // The public identifier is the row's `record`, and the primary key
    // never leaves the server
    expect(version.changes.id).toBeUndefined();
    expect(version.changes.externalId).toBeUndefined();
    expect(version.changes.createdAt).toBeUndefined();
    expect(version.snapshot).toBeNull();
    // Nothing said who, outside a request
    expect(version.actor).toBeNull();
    expect(version.source).toBe('system');
  });

  test('an update holds the changed fields only, and nothing when nothing changed', async () => {
    const book = await Book.create({ pages: 300, title: 'Dune' });

    await book.update({ title: 'Dune Messiah' });
    await book.update({ title: 'Dune Messiah' });

    const history = await versions.of(book);

    expect(history.map((entry) => entry.event)).toEqual(['update', 'create']);
    expect(history[0].changes).toEqual({
      title: ['Dune', 'Dune Messiah'],
    });
  });

  test('a soft delete is an update, and a real one is a destroy with a snapshot', async () => {
    const book = await Book.create({ pages: 300, title: 'Dune' });

    await book.destroy();

    const [soft] = await versions.of(book);

    expect(soft.event).toBe('update');
    expect(soft.changes.deletedAt[0]).toBeNull();
    expect(soft.snapshot).toBeNull();

    await book.destroy({ force: true });

    const [hard] = await versions.of(book);

    expect(hard.event).toBe('destroy');
    expect(hard.changes).toEqual({});
    expect(hard.snapshot.title).toBe('Dune');
    expect(hard.snapshot.pages).toBe(300);
  });

  test('a restore of a soft deleted record is recorded too', async () => {
    const book = await Book.create({ title: 'Dune' });

    await book.destroy();
    await book.restore();

    const history = await versions.of(book);

    expect(history[0].event).toBe('update');
    expect(history[0].changes.deletedAt[1]).toBeNull();
  });

  test('reify folds backwards from the live record', async () => {
    const book = await Book.create({ pages: 300, title: 'Dune' });
    const [created] = await versions.of(book);

    await book.update({ pages: 412, title: 'Dune Messiah' });
    await book.update({ title: 'Children of Dune' });

    const reified = await versions.reify(created.id);

    expect(reified.complete).toBe(true);
    expect(reified.existed).toBe(true);
    expect(reified.attributes.title).toBe('Dune');
    expect(reified.attributes.pages).toBe(300);
  });

  test('reify of a destroy answers the snapshot, and restore brings it back', async () => {
    const book = await Book.create({ pages: 300, title: 'Dune' });
    const external = book.externalId;

    await book.update({ title: 'Dune Messiah' });
    await book.destroy({ force: true });

    const [destroyed] = await versions.of(book);
    const reified = await versions.reify(destroyed.id);

    expect(reified.existed).toBe(false);
    expect(reified.complete).toBe(true);
    expect(reified.attributes.title).toBe('Dune Messiah');

    const { created, record } = await versions.restore(destroyed.id);

    expect(created).toBe(true);
    // The same public identifier: every link that named this record still
    // names it
    expect(record.externalId).toBe(external);
    expect(record.title).toBe('Dune Messiah');
    expect(record.pages).toBe(300);

    // And the restore is itself a change
    const history = await versions.of({ model: 'Book', record: external });

    expect(history[0].event).toBe('create');
  });

  test('restore writes an older version back over a record that still exists', async () => {
    const book = await Book.create({ pages: 300, title: 'Dune' });
    const [created] = await versions.of(book);

    await book.update({ pages: 412, title: 'Dune Messiah' });

    const { created: made, record } = await versions.restore(created.id);

    expect(made).toBe(false);
    expect(record.title).toBe('Dune');
    expect(record.pages).toBe(300);
    expect((await Book.findById(book.externalId)).title).toBe('Dune');
  });

  test('a field whose values are not kept makes a restore refuse', async () => {
    const book = await Book.create({ apiToken: 'sk-live-1', title: 'Dune' });
    const [created] = await versions.of(book);

    // `apiToken` matches the default filterParameters (`token`), so the
    // change is named and its values are not kept
    expect(created.changes.apiToken).toBeNull();
    expect(created.changes.title).toEqual([null, 'Dune']);

    const reified = await versions.reify(created.id);

    expect(reified.complete).toBe(false);
    expect(reified.missing).toEqual(['apiToken']);

    await expect(versions.restore(created.id)).rejects.toMatchObject({
      code: 'HENRI_VERSION_INCOMPLETE',
    });

    // ... and says what to do about it
    const forced = await versions.restore(created.id, { force: true });

    expect(forced.record.title).toBe('Dune');
    expect(forced.record.apiToken).toBe('sk-live-1');
  });

  test('a mass write is refused, and says how to do it instead', async () => {
    await Book.create({ title: 'Dune' });

    await expect(
      Book.update({ title: 'Dune' }, { pages: 1 })
    ).rejects.toMatchObject({ code: 'HENRI_VERSION_MASS_WRITE' });

    await expect(Book.destroy({ title: 'Dune' })).rejects.toMatchObject({
      code: 'HENRI_VERSION_MASS_WRITE',
    });

    await expect(
      Book.where({ title: 'Dune' }).update({ pages: 2 })
    ).rejects.toMatchObject({ code: 'HENRI_VERSION_MASS_WRITE' });

    let error = null;

    try {
      await Book.update({ title: 'Dune' }, { pages: 1 });
    } catch (thrown) {
      error = thrown;
    }

    expect(error.hint).toContain(
      'for (const record of await Book.find(where))'
    );
    expect(error.hint).toContain('{ versions: false }');

    // The way through, and it writes no version
    expect(
      await Book.update({ title: 'Dune' }, { pages: 3 }, { versions: false })
    ).toBe(1);
    expect(await versions.count({ event: 'update' })).toBe(0);

    // Nothing was versioned, and the row did change
    expect((await Book.findOne({ title: 'Dune' })).pages).toBe(3);
  });

  test('a mass write on a model that keeps no versions is untouched', async () => {
    await Shelf.create({ name: 'Fiction' });

    expect(await Shelf.update({ name: 'Fiction' }, { name: 'Poetry' })).toBe(1);
  });

  test('findByIdAndUpdate reads the record so the diff is real', async () => {
    const book = await Book.create({ pages: 300, title: 'Dune' });

    await Book.findByIdAndUpdate(book.externalId, { pages: 412 });

    const [version] = await versions.of(book);

    expect(version.event).toBe('update');
    expect(version.changes.pages).toEqual([300, 412]);
  });

  test('acting() says who, and it is an async context', async () => {
    const book = await versions.acting(
      { actor: '018f0000-0000-7000-8000-0000000000aa', source: 'job' },
      () => Book.create({ title: 'Dune' })
    );
    const [version] = await versions.of(book);

    expect(version.actor).toBe('018f0000-0000-7000-8000-0000000000aa');
    expect(version.source).toBe('job');

    await Book.create({ title: 'Elsewhere' });

    const [outside] = await versions.list({ limit: 1 });

    expect(outside.actor).toBeNull();
    expect(outside.source).toBe('system');
  });

  test('the prune takes the rows past versions.keep away', async () => {
    const book = await Book.create({ title: 'Dune' });

    await book.update({ title: 'Dune Messiah' });

    expect(await versions.count({})).toBe(2);

    const kept = await versions.prune({ now: Date.now() });

    expect(kept.removed).toBe(0);

    const swept = await versions.prune({
      now: Date.now() + 31 * 86400000,
    });

    expect(swept.removed).toBe(2);
    expect(await versions.count({})).toBe(0);
  });

  test('an erasure follows what happened to the record', async () => {
    const kept = await Book.create({ notes: 'by Ada', title: 'Dune' });
    const gone = await Book.create({ notes: 'by Ada', title: 'Elsewhere' });

    await kept.update({ notes: 'by Ada Lovelace' });

    const done = await versions.erase(
      [
        {
          action: 'anonymize',
          ids: [kept.externalId],
          model: 'Book',
          values: { notes: null },
        },
        {
          action: 'delete',
          ids: [gone.externalId],
          model: 'Book',
          values: {},
        },
      ],
      { actor: null }
    );

    expect(done.strategy).toBe('follow');
    // The deleted record's history went with it
    expect(await versions.of(gone)).toEqual([]);

    // The kept record's history survived, without the erased values
    const history = await versions.of(kept);

    expect(history).toHaveLength(2);
    expect(history[0].changes.notes).toBeNull();
    expect(history[0].erasedAt).not.toBeNull();
    expect(history[1].changes.title).toEqual([null, 'Dune']);
  });

  test('the DDL is idempotent, and every dialect has one', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql', 'mssql']) {
      const statements = install(dialect, 'henri_versions');

      expect(statements.length).toBeGreaterThan(0);
      expect(statements[0]).toContain('henri_versions');
      expect(statements.join('\n')).toMatch(/record/u);
    }

    expect(() => install('cassandra', 'henri_versions')).toThrow(
      /cannot be kept/u
    );
    expect(() => install('sqlite', 'drop table; --')).toThrow(
      /invalid table name/u
    );
  });

  test('the table henri owns is reserved from a drizzle-kit push', () => {
    expect([...adapter.reservedTables()]).toContain('henri_versions');
  });
});
