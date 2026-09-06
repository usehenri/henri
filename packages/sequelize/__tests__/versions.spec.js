// Model versioning against a real Sequelize store.
//
// The feature lives in @usehenri/core; this is the adapter's half -- the
// hooks that notice a change, and the refusal a mass write gets. It runs on
// sqlite in memory offline and on the PostgreSQL or MySQL server of
// HENRI_TEST_POSTGRES_URL / HENRI_TEST_MYSQL_URL (`pnpm test:sql:live`).
const Versions = require('@usehenri/core/src/4.versions');

const { build, target } = require('./helpers');

const bookModel = {
  globalId: 'Book',
  identity: 'book',
  options: { paranoid: true, timestamps: true, versioned: true },
  schema: {
    apiToken: { type: 'string' },
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

describe(`versions on ${target.name} (sequelize)`, () => {
  let adapter = null;
  let henri = null;
  let versions = null;
  let Book = null;
  let Shelf = null;

  beforeAll(async () => {
    ({ adapter, henri } = build({ versions: {} }));
    [bookModel, shelfModel].forEach((model) => adapter.addModel(model, 'user'));
    await adapter.start();
    ({ Book, Shelf } = adapter.getModels());

    henri.model = {
      models: [bookModel, shelfModel],
      stores: { default: adapter },
    };
    henri.privacy = { modelOf: (name) => adapter.getModels()[name] || null };
    versions = new Versions();
    versions.henri = henri;
    henri.versions = versions;
    await versions.init();
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  beforeEach(async () => {
    await Book.destroy({
      force: true,
      paranoid: false,
      versions: false,
      where: {},
    });
    await Shelf.destroy({ where: {} });
    await adapter.query(`DELETE FROM ${versions.settings.table}`);
  });

  test('only a model that asked is versioned', async () => {
    expect(versions.enabled).toBe(true);
    expect(versions.watches('Book')).toBe(true);
    expect(versions.watches('Shelf')).toBe(false);

    await Shelf.create({ name: 'Fiction' });

    expect(await versions.count({})).toBe(0);
  });

  test('a create, an update, a soft delete and a real one', async () => {
    const book = await Book.create({ pages: 300, title: 'Dune' });

    await book.update({ title: 'Dune Messiah' });
    await book.destroy();
    await book.restore();
    await book.destroy({ force: true });

    const history = await versions.of({
      model: 'Book',
      record: book.externalId,
    });

    expect(history.map((entry) => entry.event)).toEqual([
      'destroy',
      'update',
      'update',
      'update',
      'create',
    ]);
    expect(history[4].changes.title).toEqual([null, 'Dune']);
    expect(history[3].changes).toEqual({ title: ['Dune', 'Dune Messiah'] });
    // The soft delete is the update it is
    expect(history[2].changes.deletedAt[0]).toBeNull();
    // ... and so is the restore
    expect(history[1].changes.deletedAt[1]).toBeNull();
    // Only the row that left the table carries a snapshot
    expect(history[0].snapshot.title).toBe('Dune Messiah');
    expect(history[0].snapshot.pages).toBe(300);
  });

  test('a name filterParameters matches is named and not kept', async () => {
    const book = await Book.create({ apiToken: 'sk-live-1', title: 'Dune' });
    const [version] = await versions.of({
      model: 'Book',
      record: book.externalId,
    });

    expect(version.changes.apiToken).toBeNull();
    expect(JSON.stringify(version)).not.toContain('sk-live-1');
  });

  test('a bulk write is refused, and individualHooks is the way through', async () => {
    await Book.create({ title: 'Dune' });

    await expect(
      Book.update({ pages: 1 }, { where: { title: 'Dune' } })
    ).rejects.toMatchObject({ code: 'HENRI_VERSION_MASS_WRITE' });

    await expect(
      Book.destroy({ where: { title: 'Dune' } })
    ).rejects.toMatchObject({ code: 'HENRI_VERSION_MASS_WRITE' });

    // Sequelize's own answer: it loads the rows and runs the instance
    // hooks, which is exactly what a version needs
    await Book.update(
      { pages: 2 },
      { individualHooks: true, where: { title: 'Dune' } }
    );

    expect(await versions.count({ event: 'update' })).toBe(1);

    // ... and the other way through writes nothing
    await Book.update(
      { pages: 3 },
      { versions: false, where: { title: 'Dune' } }
    );

    expect(await versions.count({ event: 'update' })).toBe(1);
  });

  test('bulkCreate is not refused: a create loses nothing', async () => {
    await Book.bulkCreate([{ title: 'One' }, { title: 'Two' }]);

    expect(await versions.count({ event: 'create' })).toBe(2);
  });

  test('reify and restore go through the same core', async () => {
    const book = await Book.create({ pages: 300, title: 'Dune' });
    const [created] = await versions.of({
      model: 'Book',
      record: book.externalId,
    });

    await book.update({ pages: 412, title: 'Dune Messiah' });

    const reified = await versions.reify(created.id);

    expect(reified.complete).toBe(true);
    expect(reified.attributes.title).toBe('Dune');

    const { created: made, record } = await versions.restore(created.id);

    expect(made).toBe(false);
    expect(record.title).toBe('Dune');
    expect(record.pages).toBe(300);
  });
});
