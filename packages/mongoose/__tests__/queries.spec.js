// What this adapter reports to `henri.queries`, against a real MongoDB.
//
// The seam is core's and its design is argued in `base/queries.js`; what is
// proved here is the mapping this package owns, and above all the two things
// that make Mongoose different from the other adapters: that instrumenting it
// does not turn a chainable `Query` into a promise, and that the N+1 a loop
// makes through a `ref` is counted.
const { MongoMemoryServer } = require('mongodb-memory-server');
const Queries = require('@usehenri/core/src/0.queries');
const { context } = require('@usehenri/core/src/base/request-id');
const { queryOperations } = require('mongoose/lib/constants');
const Mongoose = require('../index');
const { QUERIES } = require('../queries');

const authorModel = {
  globalId: 'Author',
  identity: 'author',
  options: { timestamps: true },
  schema: { name: { type: 'string' } },
};

const bookModel = {
  globalId: 'Book',
  identity: 'book',
  options: { timestamps: true },
  schema: {
    authorId: { index: true, ref: 'Author', type: 'string' },
    title: { type: 'string' },
  },
};

/**
 * A minimal henri stand-in carrying the real seam
 *
 * @param {object} [settings={}] configuration values
 * @returns {object} fake henri
 */
const fakeHenri = (settings = {}) => {
  const henri = {
    _user: null,
    config: {
      get: (key) => settings[key],
      has: (key) => typeof settings[key] !== 'undefined',
    },
    cwd: () => process.cwd(),
    isProduction: false,
    isTest: true,
    pen: { error() {}, fatal() {}, info() {}, warn() {} },
    user: { encrypt: async (password) => `hashed:${password}` },
  };

  // The real module, not a stand-in: what is being tested is that this
  // adapter reports what core's seam expects
  const queries = new Queries();

  queries.henri = henri;
  queries.init();
  henri.queries = queries;

  return henri;
};

/** Runs something as if it were a request, so the detector has a bucket */
const inRequest = (id, fn) => context.run({ id }, fn);

describe('the query seam (mongoose)', () => {
  let mongod;
  let adapter;
  let henri;
  let Author;
  let Book;
  let seen;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    henri = fakeHenri();
    adapter = new Mongoose('default', { url: mongod.getUri('queries') }, henri);
    Author = adapter.addModel(authorModel, 'nobody');
    Book = adapter.addModel(bookModel, 'nobody');
    await adapter.start();
  }, 120000);

  afterAll(async () => {
    await adapter.stop();
    await mongod.stop();
  });

  beforeEach(() => {
    seen = [];
    henri.queries.onQuery((event) => seen.push(event));
  });

  afterEach(async () => {
    henri.queries.onQuery(null);
    await Book.deleteMany({});
    await Author.deleteMany({});
  });

  test('the operations table is the one Mongoose declares', () => {
    // A Mongoose release that adds a query operation should fail here rather
    // than leave a silent gap in what henri reports
    expect(Object.keys(QUERIES).sort()).toEqual([...queryOperations].sort());
  });

  test('a query is still a chainable Query, not a promise', async () => {
    await Author.create({ name: 'Ada' });
    await Author.create({ name: 'Grace' });

    const query = Author.find();

    // The whole reason this adapter is instrumented with middleware: a
    // wrapper would have executed the query and handed back a promise
    expect(typeof query.sort).toBe('function');
    expect(typeof query.limit).toBe('function');

    const records = await query.sort('name').limit(1);

    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('Ada');
  });

  test('a read is one event carrying the model and the operation', async () => {
    await Author.create({ name: 'Ada' });
    seen = [];

    await Author.find({ name: 'Ada' });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      adapter: 'mongoose',
      dialect: null,
      method: 'find',
      model: 'Author',
      operation: 'select',
      rows: 1,
      store: 'default',
    });
  });

  test('the filter contributes its key names and none of its values', async () => {
    await Author.find({ name: 'nothing-matches-this' });

    expect(seen[0].keys).toEqual(['name']);

    const serialized = JSON.stringify(seen[0]);

    expect(serialized).not.toContain('nothing-matches-this');
    expect(seen[0]).not.toHaveProperty('sql');
    expect(seen[0]).not.toHaveProperty('statement');
  });

  test('paginate is one event, not the find and the count it is built of', async () => {
    await Author.create({ name: 'Ada' });
    seen = [];

    const page = await Author.paginate({ page: 1, perPage: 10 });

    expect(page.total).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('paginate');
    expect(seen[0].operation).toBe('select');
  });

  test('create is one event named create, not the save inside it', async () => {
    await Author.create({ name: 'Grace' });

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('create');
    expect(seen[0].operation).toBe('insert');
  });

  test('a write per document is reported', async () => {
    const author = await Author.create({ name: 'Alan' });

    seen = [];
    author.name = 'Alan Turing';
    await author.save();

    expect(seen).toHaveLength(1);
    expect(seen[0].operation).toBe('insert');
    expect(seen[0].model).toBe('Author');
  });

  test('an update reports how many documents it changed', async () => {
    await Author.create({ name: 'Ada' });
    await Author.create({ name: 'Ada' });
    seen = [];

    await Author.updateMany({ name: 'Ada' }, { name: 'Ada Lovelace' });

    expect(seen).toHaveLength(1);
    expect(seen[0].operation).toBe('update');
    expect(seen[0].rows).toBe(2);
  });

  test('the request id is the join, and it is null outside a request', async () => {
    await Author.find();

    expect(seen[0].requestId).toBeNull();

    seen = [];
    // A Mongoose query is lazy, so it has to be awaited *inside* the scope:
    // `run(fn)` where fn answers an unexecuted Query would run it after the
    // context closed, and the event would carry no id
    await inRequest('a-request-id', async () => {
      await Author.find();
    });

    expect(seen[0].requestId).toBe('a-request-id');
  });

  test('the N+1 a loop makes through a ref is what the detector counts', async () => {
    const author = await Author.create({ name: 'Ada' });

    for (let index = 0; index < 6; index += 1) {
      await Book.create({
        authorId: String(author._id),
        title: `book ${index}`,
      });
    }

    const { detector } = henri.queries;

    const findings = await inRequest('n-plus-one', async () => {
      const books = await Book.find();

      // The shape this whole tranche is about: one lookup per record, where
      // one lookup for the set would do
      for (const book of books) {
        await Author.findByKey(book.authorId);
      }

      return detector.findings(context.getStore().queries);
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      count: 6,
      model: 'Author',
      operation: 'select',
    });
    // The one query that fetched the books is never a finding
    expect(findings.some((one) => one.model === 'Book')).toBe(false);
  });

  test('one query for the whole set is never a finding', async () => {
    const author = await Author.create({ name: 'Grace' });

    for (let index = 0; index < 6; index += 1) {
      await Book.create({
        authorId: String(author._id),
        title: `owned ${index}`,
      });
    }

    const { detector } = henri.queries;

    const findings = await inRequest('eager', async () => {
      // What the loop above should have been: six books and one lookup
      const books = await Book.find();

      await Author.find({ _id: { $in: books.map((book) => book.authorId) } });

      return detector.findings(context.getStore().queries);
    });

    expect(findings).toEqual([]);
  });
});
