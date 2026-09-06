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
    authorId: { type: 'integer' },
    // A column holding an id and saying nothing: henri does not guess
    ownerId: { type: 'integer' },
    title: { type: 'string' },
  },
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
  let Note;

  beforeAll(async () => {
    ({ adapter } = build());
    Author = adapter.addModel(authorModel, 'user');
    Post = adapter.addModel(postModel, 'user');
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

  test('a key the column cannot hold is null, not a database error', async () => {
    // On PostgreSQL a uuid handed to an integer key is a DatabaseError, and
    // a 500 with a fragment of SQL in it is an answer of its own
    await expect(
      Author.findByKey('0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11')
    ).resolves.toBeNull();
    await expect(Author.findByKey('nonsense')).resolves.toBeNull();
    await expect(Author.findByKey('')).resolves.toBeNull();
    await expect(Author.findByKey(null)).resolves.toBeNull();
    await expect(Author.findByKey(undefined)).resolves.toBeNull();
  });

  test('an empty set and an unknown model answer nothing', async () => {
    expect((await adapter.externalIdsOf('Author', [])).size).toBe(0);
    expect((await adapter.externalIdsOf('Nope', [1])).size).toBe(0);
  });

  test('a model that opted out answers nothing', async () => {
    const note = await Note.create({ body: 'no public id' });

    expect((await adapter.externalIdsOf('Note', [note.id])).size).toBe(0);
  });

  test('the foreign key of a post is what the reference table names', async () => {
    const ada = await Author.create({ name: 'Grace' });
    const post = await Post.create({ authorId: ada.id, title: 'compiled' });

    expect(post.authorId).toBe(ada.id);
    expect(
      (await adapter.externalIdsOf('Author', [post.authorId])).get(
        String(ada.id)
      )
    ).toBe(ada.externalId);
  });
});
