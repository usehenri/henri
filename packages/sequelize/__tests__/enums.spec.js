// The enum predicates and scopes of `@usehenri/core` against a real
// Sequelize store. The methods are core's (`base/enums.js`); what is proved
// here is that they land on this adapter's model and its instances, and
// that the condition a scope answers -- an `Op.and` taken from this model's
// own connection -- is one Sequelize runs.
const { build, target } = require('./helpers');

const { attach } = require('@usehenri/core/src/base/enums');

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

describe(`enum predicates and scopes on ${target.name}`, () => {
  let Post;
  let adapter;

  beforeAll(async () => {
    ({ adapter } = build());
    Post = adapter.addModel(postModel, 'user');
    attach(Post, postModel);
    await adapter.start();

    await Post.bulkCreate([
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

  test('the predicate reads a row that came back from the database', async () => {
    const post = await Post.findOne({ where: { title: 'Two' } });

    expect(post.isLive()).toBe(true);
    expect(post.isDraft()).toBe(false);
    expect(post.isInReview()).toBe(false);
  });

  test('a scope is a condition this adapter runs', async () => {
    const live = await Post.findAll({ where: Post.live() });

    expect(live.map((row) => row.title).sort()).toEqual(['Three', 'Two']);
    expect(live.every((row) => row.isLive())).toBe(true);
  });

  test('a scope narrows a condition rather than replacing it', async () => {
    const mine = await Post.findAll({ where: Post.live({ ownerId: 1 }) });

    expect(mine.map((row) => row.title)).toEqual(['Two']);
  });

  test('two conditions on the column both hold, so nothing widens', async () => {
    expect(
      await Post.findAll({ where: Post.live({ status: 'draft' }) })
    ).toEqual([]);
  });

  test('it pages, which is what an index writes', async () => {
    const { records, total } = await Post.paginate({
      order: [['title', 'ASC']],
      page: 1,
      perPage: 10,
      where: Post.inReview(),
    });

    expect(total).toBe(1);
    expect(records.map((row) => row.title)).toEqual(['Four']);
  });

  test('and it counts', async () => {
    expect(await Post.count({ where: Post.live() })).toBe(2);
  });
});
