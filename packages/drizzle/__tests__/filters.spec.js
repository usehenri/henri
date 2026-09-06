// The declared filters of `@usehenri/core` against a real Drizzle store.
//
// `base/filters.js` turns what a client asked for into the adapter's own
// condition and never into SQL, so what has to be proved here is that the
// condition it builds is one this adapter runs and answers correctly. This
// file runs on whatever the environment points at -- sqlite offline, a
// PostgreSQL or a MySQL server with HENRI_TEST_POSTGRES_URL or
// HENRI_TEST_MYSQL_URL (`pnpm test:sql:live`).
const {
  build,
  buildWith,
  generateKey,
  target,
  withKeys,
} = require('./helpers');

const {
  conditionFor,
  declaration,
  narrow,
  orderFor,
  read,
  verify,
} = require('../../core/src/base/filters');
const { columnsOf, settingsOf } = require('../../core/src/base/openapi');

/** A moment, that many days ago */
const ago = (days) => new Date(Date.now() - days * 86400000);

const model = {
  globalId: 'Talk',
  identity: 'talk',
  options: { timestamps: true },
  schema: {
    abstract: { type: 'text' },
    length: { type: 'integer' },
    room: { type: 'string' },
    startsAt: { type: 'date' },
    state: { enum: ['draft', 'accepted', 'rejected'], type: 'string' },
    title: { type: 'string' },
  },
  store: 'default',
};

/** The declaration these suites ask with, bound to the model above */
const bound = verify(
  declaration(
    {
      default: '-startsAt',
      sort: ['length', 'room', 'startsAt', 'title'],
      where: {
        length: { type: 'integer' },
        room: { type: 'string' },
        startsAt: { type: 'date' },
        state: { enum: ['draft', 'accepted', 'rejected'], type: 'string' },
        title: { operators: ['contains', 'ends', 'starts'], type: 'string' },
      },
    },
    'talks#index'
  ),
  {
    columns: columnsOf(model, settingsOf({})),
    model: 'Talk',
    where: 'talks#index',
  }
);

describe(`declared filters on ${target.name}`, () => {
  let adapter = null;
  let Talk = null;

  /**
   * What a query string answers, through the whole path a request takes
   *
   * @param {object} query the query string, as express parses it
   * @param {*} [scope=null] what the policy said the list is
   * @returns {Promise<Array<string>>} the titles, in the order they came
   */
  const ask = async (query, scope = null) => {
    const asked = read(bound, { query });

    expect(asked.errors).toEqual({});

    const where = narrow(Talk, scope, conditionFor(Talk, asked.terms));
    const rows = await Talk.where(where).order(
      orderFor(Talk, asked.sort, bound.tiebreak)
    );

    return rows.map((row) => row.title);
  };

  beforeAll(async () => {
    ({ adapter } = build());
    adapter.addModel(model, 'user');
    await adapter.start();
    Talk = adapter.getModels().Talk;

    await Talk.create([
      {
        abstract: 'a',
        length: 30,
        room: 'Aurora',
        startsAt: ago(3),
        state: 'accepted',
        title: 'Rust in the kernel',
      },
      {
        abstract: 'b',
        length: 45,
        room: 'Borealis',
        startsAt: ago(2),
        state: 'accepted',
        title: 'Rust for the web',
      },
      {
        abstract: 'c',
        length: 15,
        room: 'Aurora',
        startsAt: ago(1),
        state: 'draft',
        title: 'A 50% faster build',
      },
      {
        abstract: 'd',
        length: 60,
        room: null,
        startsAt: null,
        state: 'rejected',
        title: 'Nobody wanted this',
      },
    ]);
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  test('an equality, a negation and a membership', async () => {
    expect(await ask({ 'filter[state]': 'draft' })).toEqual([
      'A 50% faster build',
    ]);
    expect((await ask({ 'filter[state][ne]': 'accepted' })).sort()).toEqual([
      'A 50% faster build',
      'Nobody wanted this',
    ]);
    expect(
      (await ask({ 'filter[state][in]': 'draft,rejected' })).sort()
    ).toEqual(['A 50% faster build', 'Nobody wanted this']);
    expect(
      (await ask({ 'filter[state][nin]': 'draft,rejected' })).sort()
    ).toEqual(['Rust for the web', 'Rust in the kernel']);
  });

  test('a range, and two terms on one column that are one range', async () => {
    expect((await ask({ 'filter[length][gte]': '45' })).sort()).toEqual([
      'Nobody wanted this',
      'Rust for the web',
    ]);
    expect(
      await ask({ 'filter[length][gt]': '15', 'filter[length][lte]': '30' })
    ).toEqual(['Rust in the kernel']);
    expect((await ask({ 'filter[length][between]': '30,45' })).sort()).toEqual([
      'Rust for the web',
      'Rust in the kernel',
    ]);
  });

  test('a date range reaches the database as a date', async () => {
    const recent = await ask({
      'filter[startsAt][gte]': ago(2.5).toISOString(),
    });

    expect(recent.sort()).toEqual(['A 50% faster build', 'Rust for the web']);
  });

  test('null, and its negation', async () => {
    expect(await ask({ 'filter[room][null]': 'true' })).toEqual([
      'Nobody wanted this',
    ]);
    expect((await ask({ 'filter[room][null]': 'false' })).length).toBe(3);
  });

  test('the three text operators, on a value that is a literal', async () => {
    expect((await ask({ 'filter[title][starts]': 'Rust' })).sort()).toEqual([
      'Rust for the web',
      'Rust in the kernel',
    ]);
    expect(await ask({ 'filter[title][ends]': 'kernel' })).toEqual([
      'Rust in the kernel',
    ]);
    expect(await ask({ 'filter[title][contains]': 'for the' })).toEqual([
      'Rust for the web',
    ]);
  });

  test('a wildcard in a text value is refused rather than escaped', () => {
    const asked = read(bound, { query: { 'filter[title][contains]': '50%' } });

    expect(asked.errors['filter[title][contains]']).toMatch(/may not contain/u);

    // ... and the row holding one is found by a literal that avoids it
    expect(asked.terms).toEqual([]);
  });

  test('the order is the adapter s own, and the page is stable', async () => {
    expect(await ask({ sort: 'length' })).toEqual([
      'A 50% faster build',
      'Rust in the kernel',
      'Rust for the web',
      'Nobody wanted this',
    ]);
    expect(await ask({ sort: '-length,title' })).toEqual([
      'Nobody wanted this',
      'Rust for the web',
      'Rust in the kernel',
      'A 50% faster build',
    ]);

    // Two rows in the same room: the tiebreaker is what keeps the order of
    // a page from changing between two requests
    const first = await ask({ 'filter[room]': 'Aurora', sort: 'room' });
    const again = await ask({ 'filter[room]': 'Aurora', sort: 'room' });

    expect(orderFor(Talk, [], bound.tiebreak)).toEqual({ externalId: 'asc' });
    expect(first).toEqual(again);
    expect(first).toHaveLength(2);
  });

  test('a filter narrows what the scope said, and never widens it', async () => {
    const scope = { state: 'accepted' };

    // Inside the scope: the filter narrows further
    expect(await ask({ 'filter[title][starts]': 'Rust' }, scope)).toHaveLength(
      2
    );
    expect(await ask({ 'filter[length][gte]': '45' }, scope)).toEqual([
      'Rust for the web',
    ]);

    // Outside it: the row exists, matches the filter, and does not come back
    expect(await ask({ 'filter[state]': 'draft' }, scope)).toEqual([]);
    expect(await Talk.count({ state: 'draft' })).toBe(1);

    // ... and asking for nothing is the scope alone
    expect((await ask({}, scope)).sort()).toEqual([
      'Rust for the web',
      'Rust in the kernel',
    ]);
  });

  test('a scope written with an operator is intersected the same way', async () => {
    const scope = { length: { $lte: 45 } };

    expect(await ask({ 'filter[length][gte]': '45' }, scope)).toEqual([
      'Rust for the web',
    ]);
    expect(await ask({ 'filter[length][gte]': '60' }, scope)).toEqual([]);
  });
});

describe(`declared filters over an encrypted column on ${target.name}`, () => {
  const key = generateKey();
  const secret = {
    globalId: 'Badge',
    identity: 'badge',
    options: { timestamps: true },
    schema: {
      code: { encrypted: { deterministic: true }, type: 'string' },
      name: { type: 'string' },
    },
    store: 'default',
  };

  let adapter = null;
  let Badge = null;

  beforeAll(async () => {
    const henri = await withKeys([key]);

    ({ adapter } = buildWith(henri));
    adapter.addModel(secret, 'user');
    await adapter.start();
    Badge = adapter.getModels().Badge;

    await Badge.create([
      { code: 'B-1', name: 'Ada' },
      { code: 'B-2', name: 'Grace' },
    ]);
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  test('a deterministic column keeps the equality the declaration allowed', async () => {
    const compiled = verify(
      declaration({ where: { code: 'string' } }, 'badges#index'),
      {
        columns: columnsOf(secret, settingsOf({})),
        model: 'Badge',
        where: 'badges#index',
      }
    );
    const asked = read(compiled, { query: { 'filter[code]': 'B-1' } });
    const rows = await Badge.where(conditionFor(Badge, asked.terms));

    expect(rows.map((row) => row.name)).toEqual(['Ada']);
  });

  test('a randomised one, and every order, are refused before the boot ends', () => {
    const randomised = {
      ...secret,
      schema: { ...secret.schema, code: { encrypted: true, type: 'string' } },
    };
    const bind = (written, file) =>
      verify(declaration(written, 'badges#index'), {
        columns: columnsOf(file, settingsOf({})),
        model: 'Badge',
        where: 'badges#index',
      });

    expect(() => bind({ where: { code: 'string' } }, randomised)).toThrow(
      /randomised scheme/u
    );
    expect(() => bind({ sort: ['code'] }, secret)).toThrow(/Badge encrypts/u);
    expect(() =>
      bind(
        { where: { code: { operators: ['starts'], type: 'string' } } },
        secret
      )
    ).toThrow(/keeps an equality and nothing else/u);
  });
});
