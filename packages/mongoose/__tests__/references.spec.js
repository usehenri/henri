const { MongoMemoryServer } = require('mongodb-memory-server');
const Mongoose = require('../index');

// The two halves of what core's exit gate reads from a store: which paths
// were declared to point at another model, and the public identifiers of
// the documents a set of document ids names.

const authorModel = {
  globalId: 'Author',
  identity: 'author',
  options: { timestamps: false },
  schema: { name: { type: 'string' } },
};

const postModel = {
  globalId: 'Post',
  identity: 'post',
  options: { timestamps: false },
  schema: {
    authorId: { ref: 'Author', type: 'ObjectId' },
    // A `ref` naming a model this store does not have is not a reference
    externalRef: { ref: 'Elsewhere', type: 'ObjectId' },
    // A path holding an id and saying nothing: henri does not guess
    ownerId: { type: 'string' },
    reviewerIds: [{ ref: 'Author', type: 'ObjectId' }],
    // The target is named by a sibling field, per document: henri leaves it
    // alone rather than resolve it against the wrong collection
    subjectId: { refPath: 'subjectType', type: 'ObjectId' },
    subjectType: { type: 'string' },
    title: { type: 'string' },
  },
};

const noteModel = {
  globalId: 'Note',
  identity: 'note',
  options: { externalId: false, timestamps: false },
  schema: { body: { type: 'string' } },
};

/**
 * A minimal henri stand-in
 *
 * @returns {object} fake henri
 */
const fakeHenri = () => ({
  _user: null,
  config: { get: () => undefined, has: () => false },
  isTest: true,
  pen: { error() {}, fatal() {}, info() {}, warn() {} },
  user: { encrypt: async (password) => `hashed:${password}` },
});

describe('references (mongoose)', () => {
  let mongod;
  let adapter;
  let Author;
  let Note;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    adapter = new Mongoose(
      'default',
      { url: mongod.getUri('references') },
      fakeHenri()
    );
    Author = adapter.addModel(authorModel, 'user');
    adapter.addModel(postModel, 'user');
    Note = adapter.addModel(noteModel, 'user');
    await adapter.start();
  }, 120000);

  afterAll(async () => {
    await adapter.stop();
    await mongod.stop();
  });

  test('names the paths a schema declared a ref on, and nothing else', () => {
    const described = adapter.references();

    expect(described.Post.references.authorId).toEqual({
      as: null,
      target: 'Author',
    });
    // An array of refs is a reference too, entry by entry
    expect(described.Post.references.reviewerIds).toEqual({
      as: null,
      target: 'Author',
    });
    // What henri will not guess
    expect(described.Post.references.ownerId).toBeUndefined();
    expect(described.Post.references.subjectId).toBeUndefined();
    expect(described.Post.references.externalRef).toBeUndefined();
  });

  test('says which models carry a public identifier', () => {
    const described = adapter.references();

    expect(described.Author.externalId).toBe(true);
    expect(described.Note.externalId).toBe(false);
  });

  test('answers the public identifiers of a set of document ids', async () => {
    const ada = await Author.create({ name: 'Ada' });
    const alan = await Author.create({ name: 'Alan' });
    const found = await adapter.externalIdsOf('Author', [
      ada._id,
      String(alan._id),
      '000000000000000000000000',
    ]);

    expect(found.get(String(ada._id))).toBe(ada.externalId);
    expect(found.get(String(alan._id))).toBe(alan.externalId);
    expect(found.has('000000000000000000000000')).toBe(false);
  });

  test('a malformed document id is dropped rather than thrown', async () => {
    expect((await adapter.externalIdsOf('Author', ['nonsense'])).size).toBe(0);
    expect((await adapter.externalIdsOf('Author', [])).size).toBe(0);
    expect((await adapter.externalIdsOf('Nope', ['x'])).size).toBe(0);
  });

  test('a model that opted out answers nothing', async () => {
    const note = await Note.create({ body: 'no public id' });

    expect((await adapter.externalIdsOf('Note', [note._id])).size).toBe(0);
  });
});
