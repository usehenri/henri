// The declared filters of `@usehenri/core` against a real Sequelize store.
//
// This adapter is the one whose operators are **symbols taken from the
// model's own connection**, which is the reason `base/filters.js` builds a
// condition per adapter instead of one shape for all three. What has to be
// proved here is that the symbols it reaches for are the ones this
// connection holds, and that the `Op.and` it intersects a scope with is the
// one Sequelize reads. It runs on whatever the environment points at --
// sqlite in memory offline, a PostgreSQL or a MySQL server with
// HENRI_TEST_POSTGRES_URL or HENRI_TEST_MYSQL_URL (`pnpm test:sql:live`).
const { build, target } = require('./helpers');

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
  globalId: 'Ticket',
  identity: 'ticket',
  options: { timestamps: true },
  schema: {
    closedAt: { type: 'date' },
    priority: { type: 'integer' },
    state: { enum: ['open', 'closed', 'spam'], type: 'string' },
    subject: { type: 'string' },
  },
  store: 'default',
};

const bound = verify(
  declaration(
    {
      default: '-priority',
      sort: ['priority', 'state', 'subject'],
      where: {
        closedAt: { type: 'date' },
        priority: { type: 'integer' },
        state: { enum: ['open', 'closed', 'spam'], type: 'string' },
        subject: { operators: ['contains', 'starts'], type: 'string' },
      },
    },
    'tickets#index'
  ),
  {
    columns: columnsOf(model, settingsOf({})),
    model: 'Ticket',
    where: 'tickets#index',
  }
);

describe(`declared filters on sequelize/${target.name}`, () => {
  let adapter = null;
  let Ticket = null;

  /**
   * What a query string answers, through the whole path a request takes
   *
   * @param {object} query the query string, as express parses it
   * @param {*} [scope=null] what the policy said the list is
   * @returns {Promise<Array<string>>} the subjects, in the order they came
   */
  const ask = async (query, scope = null) => {
    const asked = read(bound, { query });

    expect(asked.errors).toEqual({});

    const rows = await Ticket.findAll({
      order: orderFor(Ticket, asked.sort, bound.tiebreak),
      where: narrow(Ticket, scope, conditionFor(Ticket, asked.terms)),
    });

    return rows.map((row) => row.subject);
  };

  beforeAll(async () => {
    ({ adapter } = build());
    adapter.addModel(model, 'user');
    await adapter.start();
    Ticket = adapter.getModels().Ticket;

    await Ticket.bulkCreate([
      { closedAt: ago(2), priority: 1, state: 'closed', subject: 'Disk full' },
      { closedAt: null, priority: 3, state: 'open', subject: 'Disk slow' },
      { closedAt: ago(9), priority: 2, state: 'spam', subject: 'Buy now' },
    ]);
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  test("the operators are this connection's own symbols", async () => {
    expect(await ask({ 'filter[state]': 'open' })).toEqual(['Disk slow']);
    expect((await ask({ 'filter[priority][gte]': '2' })).sort()).toEqual([
      'Buy now',
      'Disk slow',
    ]);
    expect(await ask({ 'filter[priority][between]': '1,2' })).toBeDefined();
    expect((await ask({ 'filter[state][in]': 'open,spam' })).sort()).toEqual([
      'Buy now',
      'Disk slow',
    ]);
    expect(await ask({ 'filter[closedAt][null]': 'true' })).toEqual([
      'Disk slow',
    ]);
    expect((await ask({ 'filter[closedAt][null]': 'false' })).sort()).toEqual([
      'Buy now',
      'Disk full',
    ]);
  });

  test('a text operator is a LIKE, with the value as a literal', async () => {
    expect((await ask({ 'filter[subject][starts]': 'Disk' })).sort()).toEqual([
      'Disk full',
      'Disk slow',
    ]);
    expect(await ask({ 'filter[subject][contains]': 'y no' })).toEqual([
      'Buy now',
    ]);
  });

  test('the order is the pairs Sequelize takes, tiebroken', async () => {
    expect(orderFor(Ticket, bound.default, bound.tiebreak)).toEqual([
      ['priority', 'DESC'],
      ['externalId', 'ASC'],
    ]);
    expect(await ask({ sort: 'priority' })).toEqual([
      'Disk full',
      'Buy now',
      'Disk slow',
    ]);
    expect(await ask({})).toEqual(['Disk slow', 'Buy now', 'Disk full']);
  });

  test('the scope and the filter are intersected with Op.and', async () => {
    const scope = { state: 'open' };

    expect(await ask({ 'filter[subject][starts]': 'Disk' }, scope)).toEqual([
      'Disk slow',
    ]);
    // The row exists, matches the filter, and stays outside the list
    expect(await ask({ 'filter[state]': 'spam' }, scope)).toEqual([]);
    expect(await Ticket.count({ where: { state: 'spam' } })).toBe(1);
  });
});
