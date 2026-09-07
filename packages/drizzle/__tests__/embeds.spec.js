// The `_embedded` relations of `@usehenri/core` against a real Drizzle
// store.
//
// `base/embeds.js` loads a relation through the model API rather than
// through SQL of its own -- the condition comes from `base/filters.js` and
// the order from the same place -- so what has to be proved here is that
// the one statement it builds is one this adapter runs, that it answers the
// right rows for the right parent, and that it stays one statement whatever
// the number of parents. This file runs on whatever the environment points
// at: sqlite offline, a PostgreSQL or a MySQL server with
// HENRI_TEST_POSTGRES_URL or HENRI_TEST_MYSQL_URL (`pnpm test:sql:live`).
const { build, target } = require('./helpers');

const {
  DEFAULTS,
  declarations,
  gather,
  verify,
} = require('@usehenri/core/src/base/embeds');
const { build: referenceTable } = require('@usehenri/core/src/base/references');

const authorModel = {
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
  schema: { title: { type: 'string' } },
};

/**
 * The declaration of one action, compiled and bound the way the router
 * binds it at boot
 *
 * @param {object} relations what the controller wrote
 * @param {string} model the model the action answers
 * @param {object} table the reference table
 * @returns {object} the bound declaration
 */
const declare = (relations, model, table) =>
  verify(
    declarations({ embeds: { show: relations } }, 'posts', ['show']).show,
    {
      model,
      table,
      where: 'posts#show',
    }
  );

describe(`embeds (${target.name})`, () => {
  let adapter;
  let henri;
  let Author;
  let Post;
  let table;
  let authors;

  beforeAll(async () => {
    ({ adapter, henri } = build());
    Author = adapter.addModel(authorModel, 'user');
    Post = adapter.addModel(postModel, 'user');
    await adapter.start();

    henri.model = { referenceTable: null, stores: { default: adapter } };
    table = referenceTable(henri.model.stores);
    henri.model.referenceTable = table;
    henri.api = {
      settings: { embeds: DEFAULTS, strict: false },
      warned: new Set(),
    };

    authors = await Promise.all([
      Author.create({ name: 'Ada' }),
      Author.create({ name: 'Grace' }),
      Author.create({ name: 'Nobody' }),
    ]);

    for (const [index, author] of authors.entries()) {
      // Ada gets three posts, Grace one, Nobody none
      for (let post = 0; post < [3, 1, 0][index]; post++) {
        await Post.create({
          authorId: author.id,
          title: `${author.name} ${post}`,
        });
      }
    }
  });

  afterAll(async () => {
    await adapter.stop();
  });

  test('the key of a record names the row it points at', async () => {
    const declaration = declare({ author: 'authorId' }, 'Post', table);
    const posts = await Post.find({}, { order: { id: 'asc' } });
    const { nodes, plans } = await gather(henri, null, {
      declaration,
      names: ['author'],
      route: 'get /posts',
      sources: posts,
    });

    expect(nodes.length).toBeGreaterThan(0);

    for (const [index, post] of posts.entries()) {
      expect(nodes[plans[index].author].id).toBe(post.authorId);
    }
  });

  test('the other side answers the rows naming each record', async () => {
    const declaration = declare(
      { posts: { through: 'Post.authorId' } },
      'Author',
      table
    );
    const { nodes, plans } = await gather(henri, null, {
      declaration,
      names: ['posts'],
      route: 'get /authors',
      sources: authors,
    });
    const titles = plans.map((plan) =>
      plan.posts.map((at) => nodes[at].title).sort()
    );

    expect(titles).toEqual([['Ada 0', 'Ada 1', 'Ada 2'], ['Grace 0'], []]);
  });

  test('the declared limit caps the rows of one record', async () => {
    const declaration = declare(
      { posts: { limit: 2, through: 'Post.authorId' } },
      'Author',
      table
    );
    const { plans } = await gather(henri, null, {
      declaration,
      names: ['posts'],
      route: 'get /authors',
      sources: authors,
    });

    expect(plans.map((plan) => plan.posts.length)).toEqual([2, 1, 0]);
    // ... and the application is told its declaration does not describe
    // its data, once per route and relation
    expect(
      henri.calls.filter(
        ([level, area, message]) =>
          level === 'warn' && area === 'api' && message.includes('"posts"')
      ).length
    ).toBe(1);
  });

  test('`one: true` answers a record rather than a list', async () => {
    const declaration = declare(
      { latest: { one: true, through: 'Post.authorId' } },
      'Author',
      table
    );
    const { nodes, plans } = await gather(henri, null, {
      declaration,
      names: ['latest'],
      route: 'get /authors',
      sources: authors,
    });

    expect(typeof plans[0].latest).toBe('number');
    expect(nodes[plans[0].latest].authorId).toBe(authors[0].id);
    expect(plans[2].latest).toBeUndefined();
  });

  test('one statement per relation, whatever the number of records', async () => {
    const declaration = declare(
      { posts: { through: 'Post.authorId' } },
      'Author',
      table
    );
    const counted = [];

    henri.queries.onQuery((event) => counted.push(event));

    try {
      await gather(henri, null, {
        declaration,
        names: ['posts'],
        route: 'get /authors',
        sources: [authors[0]],
      });

      const one = counted.length;

      counted.length = 0;
      await gather(henri, null, {
        declaration,
        names: ['posts'],
        route: 'get /authors',
        sources: authors,
      });

      expect(counted.length).toBe(one);
      expect(one).toBe(1);
    } finally {
      henri.queries.onQuery(null);
    }
  });

  test('a record with no key embeds nothing rather than everything', async () => {
    const declaration = declare({ author: 'authorId' }, 'Post', table);
    const orphan = Post.build({ title: 'nobody wrote this' });
    const { plans } = await gather(henri, null, {
      declaration,
      names: ['author'],
      route: 'get /posts',
      sources: [orphan],
    });

    expect(plans[0]).toEqual({});
  });
});
