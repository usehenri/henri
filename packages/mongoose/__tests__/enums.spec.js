// The enum predicates and scopes of `@usehenri/core` against a real
// Mongoose store. The methods are core's (`base/enums.js`); what is proved
// here is that they land on this adapter's model and its documents, and
// that the condition a scope answers is one MongoDB runs.
const { MongoMemoryServer } = require('mongodb-memory-server');
const Mongoose = require('../index');
const { attach } = require('@usehenri/core/src/base/enums');

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

const postModel = {
  globalId: 'Post',
  identity: 'post',
  options: { timestamps: true },
  schema: {
    ownerId: { type: 'integer' },
    status: {
      default: 'draft',
      enum: ['draft', 'in_review', 'live'],
      type: 'string',
    },
    title: { type: 'string' },
  },
  store: 'default',
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
}, 60000);

afterAll(() => mongod && mongod.stop());

describe('enum predicates and scopes on a mongoose store', () => {
  let Post;
  let adapter;

  beforeAll(async () => {
    adapter = new Mongoose(
      'default',
      { url: mongod.getUri(`enums${(sequence += 1)}`) },
      fakeHenri()
    );
    Post = adapter.addModel(postModel, 'user');
    attach(Post, postModel);
    await adapter.start();

    await Post.create([
      { ownerId: 1, status: 'draft', title: 'One' },
      { ownerId: 1, status: 'live', title: 'Two' },
      { ownerId: 2, status: 'live', title: 'Three' },
      { ownerId: 2, status: 'in_review', title: 'Four' },
    ]);
  }, 60000);

  afterAll(() => adapter.stop());

  test('the list of values is on the model', () => {
    expect(Post.enums).toEqual({ status: ['draft', 'in_review', 'live'] });
  });

  test('the predicate reads a document that came back from the server', async () => {
    const post = await Post.findOne({ title: 'Two' });

    expect(post.isLive()).toBe(true);
    expect(post.isDraft()).toBe(false);
    expect(post.isInReview()).toBe(false);
  });

  test('and it is not part of what the document serializes', async () => {
    const post = await Post.findOne({ title: 'Two' });

    expect(Object.keys(post.toJSON())).not.toContain('isLive');
  });

  test('a scope is a condition this adapter runs', async () => {
    const live = await Post.find(Post.live());

    expect(live.map((row) => row.title).sort()).toEqual(['Three', 'Two']);
    expect(live.every((row) => row.isLive())).toBe(true);
  });

  test('and it chains, because it is a filter and not a query', async () => {
    const rows = await Post.find(Post.live()).sort({ title: 1 }).limit(1);

    expect(rows.map((row) => row.title)).toEqual(['Three']);
  });

  test('a scope narrows a condition rather than replacing it', async () => {
    const mine = await Post.find(Post.live({ ownerId: 1 }));

    expect(mine.map((row) => row.title)).toEqual(['Two']);
  });

  test('two conditions on the column both hold, so nothing widens', async () => {
    expect(await Post.find(Post.live({ status: 'draft' }))).toEqual([]);
  });

  test('it pages, which is what an index writes', async () => {
    const { records, total } = await Post.paginate({
      page: 1,
      perPage: 10,
      where: Post.inReview(),
    });

    expect(total).toBe(1);
    expect(records.map((row) => row.title)).toEqual(['Four']);
  });

  test('and it counts', async () => {
    expect(await Post.countDocuments(Post.live())).toBe(2);
  });
});
