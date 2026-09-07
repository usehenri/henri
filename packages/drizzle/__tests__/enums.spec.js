// The enum predicates and scopes of `@usehenri/core` against a real Drizzle
// store.
//
// `base/enums.js` puts the methods on the model the adapter built and spells
// the scope's condition for it, so what has to be proved here is that the
// condition is one this adapter runs, that the predicate reads a row that
// came back from the database, and that a scope narrows a condition rather
// than replacing it. This file runs on whatever the environment points at --
// sqlite offline, a PostgreSQL or a MySQL server with HENRI_TEST_POSTGRES_URL
// or HENRI_TEST_MYSQL_URL (`pnpm test:sql:live`).
const { build, target } = require('./helpers');

const { attach } = require('../../core/src/base/enums');

const model = {
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

describe(`enum predicates and scopes on ${target.name}`, () => {
  let adapter = null;
  let Post = null;

  beforeAll(async () => {
    ({ adapter } = build());
    Post = adapter.addModel(model, 'user');
    attach(Post, model);
    await adapter.start();

    await Post.create([
      { ownerId: 1, status: 'draft', title: 'One' },
      { ownerId: 1, status: 'live', title: 'Two' },
      { ownerId: 2, status: 'live', title: 'Three' },
      { ownerId: 2, status: 'in_review', title: 'Four' },
    ]);
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  test('the list of values is on the model', () => {
    expect(Post.enums).toEqual({ status: ['draft', 'in_review', 'live'] });
  });

  test('the predicate reads a row that came back from the database', async () => {
    const post = await Post.findOne({ title: 'Two' });

    expect(post.isLive()).toBe(true);
    expect(post.isDraft()).toBe(false);
    expect(post.isInReview()).toBe(false);
  });

  test('a scope is a condition this adapter runs', async () => {
    const live = await Post.find(Post.live());

    expect(live.map((row) => row.title).sort()).toEqual(['Three', 'Two']);
    expect(live.every((row) => row.isLive())).toBe(true);
  });

  test('and the fluent form takes the same value', async () => {
    const rows = await Post.where(Post.inReview()).order('title');

    expect(rows.map((row) => row.title)).toEqual(['Four']);
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
      order: 'title',
      page: 1,
      perPage: 1,
      where: Post.live({ ownerId: 2 }),
    });

    expect(total).toBe(1);
    expect(records.map((row) => row.title)).toEqual(['Three']);
  });

  test('and it counts', async () => {
    expect(await Post.count(Post.live())).toBe(2);
  });

  test('a value outside the enum is still refused by the validations', async () => {
    await expect(
      Post.create({ status: 'nope', title: 'Five' })
    ).rejects.toThrow(/must be one of/u);
  });
});
