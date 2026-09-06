/* global Memo */
const supertest = require('supertest');
const Henri = require('../henri');
const {
  DEFAULTS,
  NAMES,
  OPERATORS,
  conditionFor,
  declaration,
  declarations,
  defaultOperators,
  escapeRegex,
  narrow,
  orderFor,
  parseKey,
  read,
  verify,
} = require('../base/filters');

const password = 'difference-engine';
const ownerEmail = 'filters-owner@usehenri.io';
const strangerEmail = 'filters-stranger@usehenri.io';

/** A declaration compiled the way a controller would write it */
const compile = (written, where = 'proposals#index') =>
  declaration(written, where);

/** The columns of a model, as `verify()` reads them */
const columns = (extra = {}) => ({
  createdAt: { type: 'date' },
  externalId: { type: 'uuid', unique: true },
  title: { type: 'string' },
  ...extra,
});

/**
 * Reads a cookie value from a response
 *
 * @param {object} res supertest response
 * @param {string} name cookie name
 * @returns {?string} the value or null
 */
const cookieOf = (res, name) => {
  const line = (res.headers['set-cookie'] || []).find((cookie) =>
    cookie.startsWith(`${name}=`)
  );

  return line ? line.split(';')[0].slice(name.length + 1) : null;
};

/**
 * Registers and logs a user in, answering an agent and its csrf token
 *
 * @param {object} app the express app
 * @param {string} email the email
 * @returns {Promise<{agent: object, csrf: string, user: object}>} the agent
 */
const signUp = async (app, email) => {
  const agent = supertest.agent(app);
  const registered = await agent
    .post('/register')
    .send({ email, name: email.split('@')[0], password });

  if (registered.status !== 201) {
    throw new Error(`unable to register ${email}: ${registered.status}`);
  }

  const logged = await agent.post('/login').send({ email, password });

  if (logged.status !== 200) {
    throw new Error(`unable to log ${email} in: ${logged.status}`);
  }

  return {
    agent,
    csrf: cookieOf(registered, 'henri.csrf'),
    user: await henri.user.findByEmail(email),
  };
};

describe('the declaration', () => {
  test('a filter is a parameter rule, plus what may be asked of it', () => {
    const compiled = compile({
      sort: ['title'],
      where: { title: 'string', year: { max: 2100, type: 'integer' } },
    });

    expect(compiled.where.title.rule).toEqual({ type: 'string' });
    expect(compiled.where.title.column).toBe('title');
    expect(compiled.where.year.rule.max).toBe(2100);
    expect(compiled.sort).toEqual({ title: 'title' });
  });

  test('an equality comes free and a range comes with an ordered type', () => {
    expect(defaultOperators('string')).toEqual([
      'eq',
      'in',
      'ne',
      'nin',
      'null',
    ]);
    expect(defaultOperators('date')).toContain('between');
    expect(defaultOperators('integer')).toContain('gte');
    expect(defaultOperators('boolean')).not.toContain('gt');
  });

  test('the three text operators are opt-in, per field, by name', () => {
    const compiled = compile({
      where: {
        body: { operators: ['contains'], type: 'string' },
        title: 'string',
      },
    });

    expect(compiled.where.title.operators).not.toContain('contains');
    expect(compiled.where.body.operators).toContain('contains');
    expect(compiled.where.body.operators).toContain('eq');
  });

  test('an operator a type does not take fails at declaration time', () => {
    expect(() =>
      compile({ where: { year: { operators: ['contains'], type: 'integer' } } })
    ).toThrow(/does not take: it is for string and text/u);

    expect(() =>
      compile({ where: { name: { operators: ['gte'], type: 'string' } } })
    ).toThrow(/does not take: it is for bigint, date/u);

    expect(() =>
      compile({
        where: { name: { operators: ['soundslike'], type: 'string' } },
      })
    ).toThrow(/unknown operator "soundslike"/u);
  });

  test('a filter is never required and never has a default', () => {
    expect(() =>
      compile({ where: { state: { required: true, type: 'string' } } })
    ).toThrow(/never what it has to ask for/u);

    expect(() =>
      compile({ where: { state: { default: 'draft', type: 'string' } } })
    ).toThrow(/never what it has to ask for/u);
  });

  test('a declaration that lets nobody ask for anything is a mistake', () => {
    expect(() => compile({})).toThrow(/neither a `where` nor a `sort`/u);
    expect(() => compile({ model: 'Memo' })).toThrow(/neither a `where`/u);
  });

  test('an unknown key, and a `sort` that is not a list of names', () => {
    expect(() => compile({ order: ['title'] })).toThrow(/unknown key "order"/u);
    expect(() => compile({ sort: [42] })).toThrow(
      /not a list of column names/u
    );
    expect(() => compile({ sort: 'title' })).toThrow(/not a list of column/u);
  });

  test('a default order names what a client may name', () => {
    expect(compile({ default: '-title', sort: ['title'] }).default).toEqual([
      { column: 'title', descending: true, name: 'title' },
    ]);

    expect(() => compile({ default: 'year', sort: ['title'] })).toThrow(
      /which is not one of the columns it lets a client sort by \(title\)/u
    );
  });

  test('a sort may rename the column a client writes', () => {
    const compiled = compile({
      default: 'newest',
      sort: { newest: 'createdAt' },
    });

    expect(compiled.sort).toEqual({ newest: 'createdAt' });
    expect(compiled.default[0].column).toBe('createdAt');
  });

  test('a list, a json rule and a null are not comparisons', () => {
    expect(() =>
      compile({ where: { tags: { of: 'string', type: 'array' } } })
    ).toThrow(/which is not something a column is compared against/u);
    expect(() => compile({ where: { meta: 'json' } })).toThrow(
      /not something a column is compared against/u
    );
    expect(() => compile({ where: { title: null } })).toThrow(
      /declares the filter "title" as null/u
    );
  });

  test('declarations() reads the selectors `params` and `before` read', () => {
    const controller = {
      filters: {
        all: { where: { title: 'string' } },
        'index,search': { sort: ['title'] },
        search: { where: { year: 'integer' } },
      },
      index: () => null,
      search: () => null,
      show: () => null,
    };
    const compiled = declarations(controller, 'proposals', [
      'index',
      'search',
      'show',
    ]);

    expect(Object.keys(compiled).sort()).toEqual(['index', 'search', 'show']);
    expect(Object.keys(compiled.search.where).sort()).toEqual([
      'title',
      'year',
    ]);
    expect(compiled.index.sort).toEqual({ title: 'title' });
    // `all` alone: a where and no sort is still something to ask for
    expect(Object.keys(compiled.show.where)).toEqual(['title']);
  });

  test('a selector naming something that is not an action fails', () => {
    expect(() =>
      declarations(
        { filters: { list: { sort: ['title'] } }, index: () => null },
        'proposals',
        ['index']
      )
    ).toThrow(/which is not one of its actions \(index\)/u);
  });

  test('a controller declaring nothing compiles to nothing', () => {
    expect(declarations({}, 'proposals', ['index'])).toEqual({});
    expect(declarations({ filters: null }, 'proposals', ['index'])).toEqual({});
    expect(() => declarations({ filters: 42 }, 'proposals', [])).toThrow(
      /something other than an object/u
    );
  });
});

describe('what can never be declared', () => {
  const bind = (written, extra = {}) =>
    verify(compile(written), {
      columns: columns(extra.columns || {}),
      hidden: extra.hidden || new Set(),
      model: 'Proposal',
      where: 'proposals#index',
    });

  test('a column the model does not have', () => {
    expect(() => bind({ where: { nope: 'string' } })).toThrow(
      /which is not a column of Proposal \(createdAt, externalId, title\)/u
    );
    expect(() => bind({ sort: ['nope'] })).toThrow(
      /sorts by "nope", which is not a column of Proposal/u
    );
  });

  test('a randomised encrypted column, in a where and in an order', () => {
    const secret = { columns: { ssn: { encrypted: true, type: 'string' } } };

    expect(() => bind({ where: { ssn: 'string' } }, secret)).toThrow(
      /encrypts with a randomised scheme/u
    );
    expect(() => bind({ sort: ['ssn'] }, secret)).toThrow(
      /sorts by "ssn", which Proposal encrypts/u
    );
  });

  test('a deterministic one keeps an equality and nothing else', () => {
    const badge = {
      columns: {
        badge: { encrypted: { deterministic: true }, type: 'string' },
      },
    };

    expect(
      bind({ where: { badge: 'string' } }, badge).where.badge
    ).toBeDefined();
    expect(() =>
      bind(
        { where: { badge: { operators: ['starts'], type: 'string' } } },
        badge
      )
    ).toThrow(/keeps an equality and nothing else/u);
    // ... and it still cannot be ordered by: the rows would come back
    // ordered by ciphertext
    expect(() => bind({ sort: ['badge'] }, badge)).toThrow(/encrypts/u);
  });

  test('a declared foreign key, in either spelling', () => {
    expect(() =>
      bind(
        { where: { ownerId: 'string' } },
        { columns: { ownerId: { ref: 'User', type: 'string' } } }
      )
    ).toThrow(/a declared reference to User/u);

    expect(() =>
      bind(
        { where: { eventId: 'integer' } },
        {
          columns: {
            eventId: { references: { model: 'Event' }, type: 'integer' },
          },
        }
      )
    ).toThrow(/a declared reference to Event/u);
  });

  test('a field marked personal: { expose: false }', () => {
    const hidden = new Set(['ssn']);

    expect(() =>
      bind(
        { where: { ssn: 'string' } },
        {
          columns: { ssn: { personal: { expose: false }, type: 'string' } },
          hidden,
        }
      )
    ).toThrow(/marks personal: \{ expose: false \}/u);

    expect(() =>
      bind(
        { sort: ['ssn'] },
        {
          columns: { ssn: { personal: { expose: false }, type: 'string' } },
          hidden,
        }
      )
    ).toThrow(/marks personal: \{ expose: false \}/u);
  });

  test('a json column, and an unbounded order over a text one', () => {
    expect(() =>
      bind(
        { where: { meta: 'string' } },
        { columns: { meta: { type: 'json' } } }
      )
    ).toThrow(/which is a json column/u);

    expect(() =>
      bind({ sort: ['body'] }, { columns: { body: { type: 'text' } } })
    ).toThrow(/which is a text column/u);

    expect(() =>
      bind({ sort: ['meta'] }, { columns: { meta: { type: 'json' } } })
    ).toThrow(/which is a json column/u);

    // A bounded string is fine: it is the unbounded one that is refused
    expect(bind({ sort: ['title'] }).sort).toEqual({ title: 'title' });
  });

  test('a filter over a plain personal field is allowed: it is in the answer', () => {
    const bound = bind(
      { where: { name: 'string' } },
      { columns: { name: { personal: true, type: 'string' } } }
    );

    expect(bound.where.name).toBeDefined();
  });

  test('binding records the tiebreaker, and its absence', () => {
    expect(bind({ sort: ['title'] }).tiebreak).toBe('externalId');

    const opted = verify(compile({ sort: ['title'] }), {
      columns: { title: { type: 'string' } },
      model: 'Proposal',
      where: 'proposals#index',
    });

    expect(opted.tiebreak).toBeNull();
  });
});

describe('reading a request', () => {
  const bound = verify(
    compile({
      default: '-createdAt',
      sort: ['createdAt', 'title'],
      where: {
        createdAt: { type: 'date' },
        title: { operators: ['contains', 'starts'], type: 'string' },
        year: { max: 2100, min: 1000, type: 'integer' },
      },
    }),
    {
      columns: columns({ year: { type: 'integer' } }),
      model: 'Proposal',
      where: 'proposals#index',
    }
  );
  const ask = (query) => read(bound, { query }, DEFAULTS);

  test('a key is walked, never matched', () => {
    expect(parseKey('filter[state]')).toEqual({
      name: 'state',
      operator: null,
    });
    expect(parseKey('filter[state][in]')).toEqual({
      name: 'state',
      operator: 'in',
    });
    expect(parseKey('filter')).toBeNull();
    expect(parseKey('filter[]')).toBeNull();
    expect(parseKey('filter[a][b][c]')).toBeNull();
    expect(parseKey('filter[a]x')).toBeNull();
    expect(parseKey('page')).toBeNull();
    expect(parseKey('filters[a]')).toBeNull();
  });

  test('a declared filter is coerced by its rule', () => {
    const answer = ask({ 'filter[year]': '1999' });

    expect(answer.errors).toEqual({});
    expect(answer.terms).toEqual([
      { column: 'year', name: 'year', operator: 'eq', value: 1999 },
    ]);
  });

  test('nothing undeclared is filterable', () => {
    expect(ask({ 'filter[password]': 'x' }).errors['filter[password]']).toMatch(
      /is not a filter Proposal accepts here \(createdAt, title, year\)/u
    );
  });

  test('an operator the field does not accept is refused', () => {
    expect(ask({ 'filter[year][contains]': '9' }).errors).toEqual({
      'filter[year][contains]': expect.stringMatching(
        /does not take "contains"/u
      ),
    });
    expect(ask({ 'filter[createdAt][starts]': 'x' }).errors).toEqual({
      'filter[createdAt][starts]': expect.stringMatching(/does not take/u),
    });
  });

  test('a value that does not fit the rule is refused', () => {
    expect(ask({ 'filter[year]': 'banana' }).errors['filter[year]']).toMatch(
      /must be a whole number/u
    );
    expect(ask({ 'filter[year]': '99' }).errors['filter[year]']).toMatch(
      /at least 1000/u
    );
  });

  test('a text value may not carry a wildcard', () => {
    expect(
      ask({ 'filter[title][contains]': 'a%b' }).errors[
        'filter[title][contains]'
      ]
    ).toMatch(/may not contain %/u);
    expect(
      ask({ 'filter[title][starts]': 'a_b' }).errors['filter[title][starts]']
    ).toMatch(/may not contain _/u);
    // ... and only where a wildcard would mean something
    expect(ask({ 'filter[title]': 'a%b' }).errors).toEqual({});
  });

  test('a list is repeated, or written out', () => {
    expect(ask({ 'filter[year][in]': '1999,2000' }).terms[0].value).toEqual([
      1999, 2000,
    ]);
    expect(
      ask({ 'filter[year][in]': ['1999', '2000'] }).terms[0].value
    ).toEqual([1999, 2000]);
  });

  test('between takes exactly two', () => {
    expect(
      ask({ 'filter[year][between]': '1900,2000' }).terms[0].value
    ).toEqual([1900, 2000]);
    expect(
      ask({ 'filter[year][between]': '1900' }).errors['filter[year][between]']
    ).toMatch(/takes 2 values/u);
  });

  test('null takes a boolean', () => {
    expect(ask({ 'filter[createdAt][null]': 'true' }).terms[0].value).toBe(
      true
    );
    expect(ask({ 'filter[createdAt][null]': 'no' }).terms[0].value).toBe(false);
  });

  test('an empty value is an absent filter, because a form sends one', () => {
    expect(ask({ 'filter[title]': '', 'filter[year]': '' }).terms).toEqual([]);
    expect(ask({ 'filter[title]': '' }).errors).toEqual({});
    // ... and so is an empty sort
    expect(ask({ sort: '' }).sort).toEqual([
      { column: 'createdAt', descending: true, name: 'createdAt' },
    ]);
  });

  test('a scalar operator sent twice is refused rather than one of the two', () => {
    expect(
      ask({ 'filter[year]': ['1999', '2000'] }).errors['filter[year]']
    ).toMatch(/was sent more than once/u);
  });

  test('the number of terms is bounded', () => {
    const many = read(
      bound,
      { query: { 'filter[year]': '1999' } },
      {
        maxFilters: 0,
      }
    );

    expect(many.errors.filter).toMatch(/at most 0 \(config.api.maxFilters\)/u);
  });

  test('the order is what the request asked for, or what the action declared', () => {
    expect(ask({}).sort).toEqual([
      { column: 'createdAt', descending: true, name: 'createdAt' },
    ]);
    expect(ask({ sort: '-title,createdAt' }).sort).toEqual([
      { column: 'title', descending: true, name: 'title' },
      { column: 'createdAt', descending: false, name: 'createdAt' },
    ]);
  });

  test('an undeclared order, a repeated one and too many of them', () => {
    expect(ask({ sort: 'password' }).errors.sort).toMatch(
      /cannot order by "password" \(createdAt, title\)/u
    );
    expect(ask({ sort: ['a', 'b'] }).errors.sort).toMatch(
      /was sent more than once/u
    );
    expect(
      read(bound, { query: { sort: 'title,createdAt' } }, { maxSort: 1 }).errors
        .sort
    ).toMatch(/at most 1 \(config.api.maxSort\)/u);
  });

  test('every operator is spoken for', () => {
    expect(NAMES).toEqual([
      'between',
      'contains',
      'ends',
      'eq',
      'gt',
      'gte',
      'in',
      'lt',
      'lte',
      'ne',
      'nin',
      'null',
      'starts',
    ]);

    for (const name of NAMES) {
      expect(OPERATORS[name].shape).toBeDefined();
    }
  });
});

describe('the adapter is the one that spells it', () => {
  const mongo = { findOneAndUpdate: () => null, modelName: 'Memo', schema: {} };
  const drizzle = {
    fields: {},
    modelName: 'Memo',
    table: {},
    withDeleted: () => null,
  };
  const Op = {
    and: Symbol('and'),
    eq: Symbol('eq'),
    gt: Symbol('gt'),
    gte: Symbol('gte'),
    iLike: Symbol('iLike'),
    in: Symbol('in'),
    is: Symbol('is'),
    like: Symbol('like'),
    lt: Symbol('lt'),
    lte: Symbol('lte'),
    ne: Symbol('ne'),
    not: Symbol('not'),
    notIn: Symbol('notIn'),
  };
  const sequelize = {
    findByPk: () => null,
    modelName: 'Memo',
    sequelize: { Sequelize: { Op }, getDialect: () => 'postgres' },
  };
  const term = (operator, value, column = 'title') => ({
    column,
    name: column,
    operator,
    value,
  });

  test('Mongoose and Drizzle share the `$` spellings', () => {
    expect(conditionFor(mongo, [term('gte', 3, 'year')])).toEqual({
      year: { $gte: 3 },
    });
    expect(conditionFor(drizzle, [term('nin', ['a'])])).toEqual({
      title: { $nin: ['a'] },
    });
    expect(conditionFor(mongo, [term('between', [1, 2], 'year')])).toEqual({
      year: { $gte: 1, $lte: 2 },
    });
    expect(conditionFor(mongo, [term('null', true, 'year')])).toEqual({
      year: { $eq: null },
    });
    expect(conditionFor(mongo, [term('null', false, 'year')])).toEqual({
      year: { $ne: null },
    });
  });

  test('two terms on one column are one comparison, not the second one', () => {
    expect(
      conditionFor(mongo, [term('gte', 1, 'year'), term('lt', 9, 'year')])
    ).toEqual({ year: { $gte: 1, $lt: 9 } });
  });

  test('a text operator is a LIKE on SQL and an escaped literal on MongoDB', () => {
    expect(conditionFor(drizzle, [term('starts', 'ada')])).toEqual({
      title: { $ilike: 'ada%' },
    });
    expect(conditionFor(drizzle, [term('ends', 'ada')])).toEqual({
      title: { $ilike: '%ada' },
    });
    expect(conditionFor(drizzle, [term('contains', 'ada')])).toEqual({
      title: { $ilike: '%ada%' },
    });
    expect(conditionFor(mongo, [term('contains', 'a.b*c')])).toEqual({
      title: { $options: 'i', $regex: 'a\\.b\\*c' },
    });
    expect(conditionFor(mongo, [term('starts', 'a')])).toEqual({
      title: { $options: 'i', $regex: '^a' },
    });
  });

  test('the escape is a walk, so what comes out is a literal', () => {
    expect(escapeRegex('.*+?^${}()|[]\\')).toBe(
      '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\'
    );
    expect(new RegExp(escapeRegex('a(b|c)')).test('a(b|c)')).toBe(true);
    expect(new RegExp(escapeRegex('a(b|c)')).test('ab')).toBe(false);
  });

  test("Sequelize gets its own connection's symbols", () => {
    const condition = conditionFor(sequelize, [term('gte', 3, 'year')]);

    expect(condition.year[Op.gte]).toBe(3);

    const text = conditionFor(sequelize, [term('starts', 'ada')]);

    expect(text.title[Op.iLike]).toBe('ada%');

    const empty = conditionFor(sequelize, [term('null', true, 'year')]);

    expect(empty.year[Op.eq]).toBeNull();
  });

  test('an order is the adapter s own, with the tiebreaker appended', () => {
    const wanted = [
      { column: 'createdAt', descending: true, name: 'createdAt' },
    ];

    expect(orderFor(mongo, wanted, 'externalId')).toEqual({
      createdAt: 'desc',
      externalId: 'asc',
    });
    expect(orderFor(sequelize, wanted, 'externalId')).toEqual([
      ['createdAt', 'DESC'],
      ['externalId', 'ASC'],
    ]);
    expect(orderFor(drizzle, [], 'externalId')).toEqual({ externalId: 'asc' });
    expect(orderFor(drizzle, [], null)).toEqual({});
    // ... and never twice
    expect(
      orderFor(
        mongo,
        [{ column: 'externalId', descending: true }],
        'externalId'
      )
    ).toEqual({ externalId: 'desc' });
  });

  test('an adapter henri cannot drive says so', () => {
    expect(() => conditionFor({}, [])).toThrow(/not one henri knows how/u);
    expect(() => orderFor(null, [])).toThrow(/not one henri knows how/u);
  });
});

describe('the scope wins', () => {
  const mongo = { findOneAndUpdate: () => null, modelName: 'Memo', schema: {} };
  const Op = { and: Symbol('and') };
  const sequelize = {
    findByPk: () => null,
    modelName: 'Memo',
    sequelize: { Sequelize: { Op } },
  };

  test('the two are intersected, never merged key by key', () => {
    const scope = { state: { $in: ['submitted', 'accepted'] } };
    const asked = { state: { $eq: 'draft' } };

    expect(narrow(mongo, scope, asked)).toEqual({ $and: [scope, asked] });
  });

  test('a filter on the very column a scope constrains keeps both', () => {
    const merged = narrow(
      mongo,
      { year: { $gte: 2000 } },
      { year: { $lt: 1900 } }
    );

    expect(merged.$and).toHaveLength(2);
    expect(merged.$and[0]).toEqual({ year: { $gte: 2000 } });
    expect(merged.$and[1]).toEqual({ year: { $lt: 1900 } });
  });

  test('nothing asked for is the scope, nothing scoped is what was asked', () => {
    expect(narrow(mongo, { a: 1 }, {})).toEqual({ a: 1 });
    expect(narrow(mongo, null, { a: 1 })).toEqual({ a: 1 });
    expect(narrow(mongo, {}, { a: 1 })).toEqual({ a: 1 });
    expect(narrow(mongo, null, {})).toEqual({});
  });

  test('Sequelize gets Op.and, not the string', () => {
    const merged = narrow(sequelize, { a: 1 }, { b: 2 });

    expect(merged[Op.and]).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test('a scope henri cannot put a filter under says so', () => {
    expect(() => narrow(mongo, 'everything', { a: 1 })).toThrow(
      /not a condition a filter can narrow/u
    );
    // ... and only when there is something to put under it
    expect(narrow(mongo, 'everything', {})).toBe('everything');
  });
});

describe('a filtered index, end to end', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let owner;
  let stranger;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    owner = await signUp(app, ownerEmail);
    stranger = await signUp(app, strangerEmail);

    const ownerId = String(owner.user.id || owner.user._id);
    const strangerId = String(stranger.user.id || stranger.user._id);

    await Memo.create([
      { body: 'a', ownerId, title: 'Quarterly report' },
      { body: 'b', ownerId, title: 'Quarterly plan' },
      { body: 'c', ownerId, title: 'Grocery list' },
      { archivedAt: new Date('2020-01-01'), body: 'd', ownerId, title: 'Old' },
      { body: 'e', ownerId: strangerId, title: 'Quarterly secrets' },
    ]);
  }, 60000);

  afterAll(async () => {
    // One at a time: a mass write on a versioned model is refused
    for (const memo of await Memo.find({})) {
      await memo.deleteOne();
    }

    await henri.stop();
    delete global.henri;
    process.env.SKIP_WORKERS = skipWorkers;
  });

  /**
   * The titles a search answered
   *
   * @param {object} res the supertest response
   * @returns {Array<string>} the titles
   */
  const titles = (res) =>
    (res.body._embedded ? res.body._embedded.memos : []).map(
      (memo) => memo.title
    );

  const search = (query = '') =>
    owner.agent.get(`/memos/search${query}`).set('Accept', 'application/json');

  test('an undeclared filter is a 422 before the action runs', async () => {
    const res = await search('?filter[ownerId]=1');

    expect(res.status).toBe(422);
    expect(res.body.data.errors['filter[ownerId]']).toMatch(
      /is not a filter Memo accepts here \(archivedAt, title\)/u
    );
    expect(res.body.code).toBe('HENRI_FILTER_INVALID');
  });

  test('an operator the field did not declare is a 422', async () => {
    const res = await search('?filter[archivedAt][contains]=2020');

    expect(res.status).toBe(422);
    expect(res.body.data.errors['filter[archivedAt][contains]']).toMatch(
      /does not take "contains"/u
    );
  });

  test('a sort over a column nobody listed is a 422', async () => {
    const res = await search('?sort=body');

    expect(res.status).toBe(422);
    expect(res.body.data.errors.sort).toMatch(
      /cannot order by "body" \(archivedAt, createdAt, title\)/u
    );
  });

  test('a declared filter narrows the list', async () => {
    const res = await search('?filter[title][starts]=Quarterly');

    expect(res.status).toBe(200);
    expect(titles(res).sort()).toEqual(['Quarterly plan', 'Quarterly report']);

    // A text operator is an escaped literal on MongoDB, matched without
    // regard to case, and never a pattern the client wrote
    const lowered = await search('?filter[title][contains]=quarterly');

    expect(titles(lowered).sort()).toEqual([
      'Quarterly plan',
      'Quarterly report',
    ]);

    const literal = await search('?filter[title][contains]=.*');

    expect(titles(literal)).toEqual([]);
  });

  test('a filter cannot reach a record the scope excludes', async () => {
    // The stranger's memo matches the filter and is not this user's own
    const mine = await search('?filter[title][contains]=Quarterly');

    expect(titles(mine)).not.toContain('Quarterly secrets');

    // ... and the archive is outside the scope this action asked for, so a
    // filter on the very column the scope names answers nothing rather than
    // reaching past it
    const archived = await search('?filter[archivedAt][gte]=2000-01-01');

    expect(archived.status).toBe(200);
    expect(titles(archived)).toEqual([]);

    // The row is there: it is the scope that keeps it out
    expect(await Memo.countDocuments({ title: 'Old' })).toBe(1);
  });

  test('the order is the one asked for, and the default otherwise', async () => {
    const asked = await search('?sort=title');

    expect(titles(asked)).toEqual([
      'Grocery list',
      'Quarterly plan',
      'Quarterly report',
    ]);

    const backwards = await search('?sort=-title');

    expect(titles(backwards)).toEqual([
      'Quarterly report',
      'Quarterly plan',
      'Grocery list',
    ]);
  });

  test('the paging links carry the filter and the sort', async () => {
    const res = await search(
      '?filter[title][starts]=Quarterly&sort=title&per_page=1'
    );

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.total).toBe(2);

    const next = res.body._links.next.href;

    expect(next).toContain('filter%5Btitle%5D%5Bstarts%5D=Quarterly');
    expect(next).toContain('sort=title');
    expect(next).toContain('page=2');

    const second = await owner.agent
      .get(next)
      .set('Accept', 'application/json');

    expect(titles(second)).toEqual(['Quarterly report']);
  });

  test('a request asking for nothing gets the declared order', async () => {
    const res = await search();

    expect(res.status).toBe(200);
    expect(titles(res)).toHaveLength(3);
  });

  test('a declaration the model refuses fails the boot, not a request', () => {
    const { controllers, router } = henri;
    const key = 'memos#search';
    const kept = controllers.filters(key);

    controllers._filters.set(
      key,
      declaration({ where: { ownerId: 'string' } }, key)
    );

    // The same call the router makes for every route it registers: a
    // throw here is a boot that does not finish
    expect(() => router.narrows(key)).toThrow(/a declared reference to User/u);

    controllers._filters.set(key, declaration({ sort: ['body'] }, key));

    expect(() => router.narrows(key)).toThrow(/which is a text column/u);

    controllers._filters.set(
      key,
      declaration({ where: { nope: 'string' } }, key)
    );

    expect(() => router.narrows(key)).toThrow(/not a column of Memo/u);

    controllers._filters.set(key, kept);
  });

  test('the policy still gates the endpoint', async () => {
    const anonymous = await supertest(app)
      .get('/memos/search')
      .set('Accept', 'application/json');

    expect(anonymous.status).toBe(401);
  });
});
