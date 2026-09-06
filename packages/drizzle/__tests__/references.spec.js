const { build, target } = require('./helpers');

// The two halves of what core's exit gate reads from a store: which fields
// were declared to point at another model, and the public identifiers of
// the rows a set of primary keys names.

const authorModel = {
  /**
   * An author has many posts
   *
   * @param {object} models the models of the store
   * @returns {void}
   */
  associate(models) {
    models.Author.hasMany(models.Post, { as: 'posts', foreignKey: 'authorId' });
  },
  globalId: 'Author',
  identity: 'author',
  options: { timestamps: false },
  schema: { name: { type: 'string' } },
};

const postModel = {
  /**
   * A post belongs to an author
   *
   * @param {object} models the models of the store
   * @returns {void}
   */
  associate(models) {
    models.Post.belongsTo(models.Author, {
      as: 'author',
      foreignKey: 'authorId',
    });
  },
  globalId: 'Post',
  identity: 'post',
  options: { timestamps: false },
  schema: {
    // Declared by hand rather than through an association
    editionId: {
      references: { model: 'Edition' },
      type: 'integer',
    },
    // A column holding an id and saying nothing: henri does not guess
    ownerId: { type: 'integer' },
    title: { type: 'string' },
  },
};

const editionModel = {
  globalId: 'Edition',
  identity: 'edition',
  // Soft deletes: a withdrawn row still has to answer with an identifier
  options: { paranoid: true, timestamps: false },
  schema: { year: { type: 'integer' } },
};

const noteModel = {
  globalId: 'Note',
  identity: 'note',
  options: { externalId: false, timestamps: false },
  schema: { body: { type: 'string' } },
};

describe(`references (${target.name})`, () => {
  let adapter;
  let Author;
  let Post;
  let Edition;
  let Note;

  beforeAll(async () => {
    ({ adapter } = build());
    Author = adapter.addModel(authorModel, 'user');
    Post = adapter.addModel(postModel, 'user');
    Edition = adapter.addModel(editionModel, 'user');
    Note = adapter.addModel(noteModel, 'user');
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  test('names the foreign keys a model declared, and nothing else', () => {
    const described = adapter.references();

    expect(described.Post.externalId).toBe(true);
    expect(described.Post.references.authorId).toEqual({
      as: 'author',
      target: 'Author',
    });
    // A `references: { model }` on the field alone is a declaration too
    expect(described.Post.references.editionId).toEqual({
      as: null,
      target: 'Edition',
    });
    // A column that says nothing is not a foreign key, whatever its name
    expect(described.Post.references.ownerId).toBeUndefined();
    // A hasMany puts no column on this table
    expect(described.Author.references).toEqual({});
  });

  test('says which models carry a public identifier', () => {
    const described = adapter.references();

    expect(described.Author.externalId).toBe(true);
    expect(described.Note.externalId).toBe(false);
  });

  test('answers the public identifiers of a set of primary keys, in one call', async () => {
    const ada = await Author.create({ name: 'Ada' });
    const alan = await Author.create({ name: 'Alan' });
    const found = await adapter.externalIdsOf('Author', [
      ada.id,
      alan.id,
      424242,
    ]);

    expect(found.get(String(ada.id))).toBe(ada.externalId);
    expect(found.get(String(alan.id))).toBe(alan.externalId);
    expect(found.has('424242')).toBe(false);
  });

  test('a malformed key is dropped rather than thrown', async () => {
    expect((await adapter.externalIdsOf('Author', ['nonsense'])).size).toBe(0);
    expect((await adapter.externalIdsOf('Author', [])).size).toBe(0);
    expect((await adapter.externalIdsOf('Nope', [1])).size).toBe(0);
  });

  test('a model that opted out answers nothing', async () => {
    const note = await Note.create({ body: 'no public id' });

    expect((await adapter.externalIdsOf('Note', [note.id])).size).toBe(0);
  });

  test('an eager loaded association still holds the key core checks against', async () => {
    const ada = await Author.create({ name: 'Eager' });
    const post = await Post.create({ authorId: ada.id, title: 'included' });
    const loaded = await Post.findByKey(post.id, { include: 'author' });

    // What core's exit gate reads to take the public identifier for free:
    // the loaded instance still carries the primary key its parent's
    // foreign key names, so the identity can be checked rather than assumed
    expect(loaded.author.id).toBe(ada.id);
    expect(loaded.author.externalId).toBe(ada.externalId);
    expect(loaded.authorId).toBe(ada.id);
    // ... and the serialization does not, which is why the live instance is
    // what gets read
    expect(loaded.toJSON().author.id).toBeUndefined();
  });

  test('a soft deleted row still has a public identifier to give', async () => {
    const edition = await Edition.create({ year: 2026 });
    const post = await Post.create({
      editionId: edition.id,
      title: 'pointing at it',
    });

    await Edition.deleteMany({ id: edition.id });

    const found = await adapter.externalIdsOf('Edition', [edition.id]);

    expect(found.get(String(edition.id))).toBe(edition.externalId);
    expect(post.editionId).toBe(edition.id);
  });
});
