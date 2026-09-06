// What this adapter reports to `henri.queries`, on the target database:
// sqlite in memory offline, and a database of its own on the live PostgreSQL
// or MySQL of `pnpm test:sql:live`.
//
// The seam is core's and its design is argued in `base/queries.js`. This
// package is the reason the design says what it says about the statement, so
// the test that matters most here is the one that proves the statement never
// leaves: Sequelize's query generator puts values inside the SQL, and none of
// them is on an event.
const { context } = require('@usehenri/core/src/base/request-id');
const { build, target, taskModel, userModel } = require('./helpers');

/**
 * Collects the events one piece of work produces
 *
 * @param {object} henri The fake henri of the store
 * @param {function} fn What to run
 * @returns {Promise<Array<object>>} The events, in order
 */
const recording = async (henri, fn) => {
  const seen = [];

  henri.queries.onQuery((event) => seen.push(event));

  try {
    await fn();
  } finally {
    henri.queries.onQuery(null);
  }

  return seen;
};

/** Runs something as if it were a request, so the detector has a bucket */
const inRequest = (id, fn) => context.run({ id }, fn);

describe(`the query seam on ${target.name} (sequelize)`, () => {
  let adapter;
  let henri;
  let Task;
  let User;

  beforeAll(async () => {
    ({ adapter, henri } = build());
    User = adapter.addModel({ ...userModel }, 'user');
    Task = adapter.addModel({
      ...taskModel,
      schema: { ...taskModel.schema, ownerId: { type: 'integer' } },
    });

    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  afterEach(async () => {
    await Task.destroy({ truncate: true });
    await User.destroy({ truncate: true });
  });

  test('a model call is one event carrying the model and the operation', async () => {
    const events = await recording(henri, async () => {
      await Task.create({ name: 'one' });
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      // `adapterName` is the henri adapter, which falls back to the dialect
      // when a store did not name one (`mssql` is what it is in an app)
      adapter: adapter.adapterName,
      method: 'create',
      model: 'Task',
      operation: 'insert',
      source: 'application',
      store: 'default',
    });
  });

  test('findByPk is findByPk, not the findAll it is built out of', async () => {
    const task = await Task.create({ name: 'two' });
    const events = await recording(henri, async () => {
      await Task.findByKey(task.id);
    });

    expect(events).toHaveLength(1);
    expect(events[0].method).toBe('findByKey');
    expect(events[0].operation).toBe('select');
    expect(events[0].rows).toBe(1);
  });

  test('paginate is two statements and one model call', async () => {
    await Task.create({ name: 'three' });

    const events = await recording(henri, async () => {
      await Task.paginate({ page: 1, perPage: 10 });
    });

    expect(events).toHaveLength(1);
    expect(events[0].method).toBe('paginate');
    expect(events[0].rows).toBe(1);
  });

  test('the statement never leaves, and this is the adapter that proves it', async () => {
    // Sequelize compiles this to: SELECT ... WHERE `name` = 'a-secret-value'
    // -- the value inside the statement text, which is exactly why no event
    // on any adapter carries SQL
    const events = await recording(henri, async () => {
      await Task.findAll({
        where: { category: 'urgent', name: 'a-secret-value' },
      });
    });

    expect(events).toHaveLength(1);
    expect(events[0].keys).toEqual(['category', 'name']);

    const serialized = JSON.stringify(events[0]);

    expect(serialized).not.toContain('a-secret-value');
    expect(serialized).not.toContain('urgent');
    // No statement, in any casing, and no fragment of one. (`select` on its
    // own is henri's own word for the operation, so the check is for SQL)
    expect(serialized).not.toMatch(/select\s|from\s|where\s/iu);
    expect(events[0]).not.toHaveProperty('sql');
    expect(events[0]).not.toHaveProperty('statement');
    expect(events[0]).not.toHaveProperty('bind');
  });

  test('the same call twice is the same shape, and two calls are not', async () => {
    const events = await recording(henri, async () => {
      await Task.findAll({ where: { name: 'a' } });
      await Task.findAll({ where: { name: 'b' } });
      await Task.findAll({ where: { category: 'low' } });
      await Task.count({ where: { name: 'a' } });
    });

    expect(events[0].shape).toBe(events[1].shape);
    expect(events[2].shape).not.toBe(events[0].shape);
    expect(events[3].shape).not.toBe(events[0].shape);
  });

  test('a write per record is reported', async () => {
    const task = await Task.create({ name: 'four' });
    const events = await recording(henri, async () => {
      await task.update({ name: 'four and a half' });
    });

    expect(events).toHaveLength(1);
    expect(events[0].operation).toBe('update');
    expect(events[0].model).toBe('Task');
  });

  test('an update says how many rows it changed', async () => {
    await Task.create({ name: 'same' });
    await Task.create({ name: 'same' });

    const events = await recording(henri, async () => {
      await Task.update({ category: 'high' }, { where: { name: 'same' } });
    });

    expect(events).toHaveLength(1);
    expect(events[0].operation).toBe('update');
    expect(events[0].rows).toBe(2);
  });

  test('the request id is the join, and it is null outside a request', async () => {
    const outside = await recording(henri, () => Task.findAll());

    expect(outside[0].requestId).toBeNull();

    const inside = await recording(henri, () =>
      inRequest('a-request-id', () => Task.findAll())
    );

    expect(inside[0].requestId).toBe('a-request-id');
  });

  test('the N+1 a loop makes is what the detector counts', async () => {
    const owner = await User.create({
      email: 'ada@example.test',
      name: 'Ada',
      password: 'secret-enough',
    });

    for (let index = 0; index < 6; index += 1) {
      await Task.create({ name: `task ${index}`, ownerId: owner.id });
    }

    const { detector } = henri.queries;

    const findings = await inRequest('n-plus-one', async () => {
      const tasks = await Task.findAll();

      for (const task of tasks) {
        await User.findByKey(task.ownerId);
      }

      return detector.findings(context.getStore().queries);
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      count: 6,
      method: 'findByKey',
      model: 'User',
      operation: 'select',
    });
  });
});
