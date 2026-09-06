// What this adapter reports to `henri.queries`, on the target database:
// sqlite in memory offline, and a database of its own on the live PostgreSQL
// or MySQL of `pnpm test:sql:live`.
//
// The seam is core's and its design is argued in `base/queries.js`; what is
// proved here is the mapping this package owns. Two things above all: that a
// model call produces exactly one event, whatever it is built out of, and
// that no value the caller passed is on it.
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

describe(`the query seam on ${target.name}`, () => {
  let adapter;
  let henri;
  let Task;
  let User;

  beforeAll(async () => {
    ({ adapter, henri } = build());
    User = adapter.addModel({ ...userModel }, 'user');
    Task = adapter.addModel({
      ...taskModel,
      associate: (models) =>
        models.Task.belongsTo(models.User, { as: 'owner' }),
      schema: { ...taskModel.schema, ownerId: { type: 'integer' } },
    });

    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  afterEach(async () => {
    await Task.destroy({}, { force: true });
    await User.destroy({}, { force: true });
  });

  test('a model call is one event, whatever it is built out of', async () => {
    const events = await recording(henri, async () => {
      await Task.create({ name: 'one' });
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      adapter: 'drizzle',
      dialect: target.name,
      method: 'create',
      model: 'Task',
      operation: 'insert',
      source: 'application',
      store: 'default',
    });
    expect(events[0].duration).toBeGreaterThanOrEqual(0);
  });

  test('findById is findById, and not the first() it is built out of', async () => {
    const task = await Task.create({ name: 'two' });
    const events = await recording(henri, async () => {
      await Task.findById(task.externalId);
    });

    expect(events).toHaveLength(1);
    expect(events[0].method).toBe('findById');
    expect(events[0].operation).toBe('select');
    expect(events[0].rows).toBe(1);
  });

  test('paginate is two statements and one model call', async () => {
    await Task.create({ name: 'three' });

    const events = await recording(henri, async () => {
      await Task.paginate({ page: 1, perPage: 10 });
    });

    // The page and its count are two statements. They are one decision, and
    // the seam counts decisions -- see the header of base/queries.js
    expect(events).toHaveLength(1);
    expect(events[0].method).toBe('paginate');
    expect(events[0].rows).toBe(1);
  });

  test('the lazy path reports too: where().toArray() is a model call', async () => {
    await Task.create({ name: 'four' });

    const events = await recording(henri, async () => {
      await Task.where({ name: 'four' }).limit(5).toArray();
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      adapter: 'drizzle',
      method: 'toArray',
      model: 'Task',
      operation: 'select',
      store: 'default',
    });
  });

  test('the filter contributes its key names and none of its values', async () => {
    const events = await recording(henri, async () => {
      await Task.find({ category: 'urgent', name: 'nothing-matches-this' });
    });

    expect(events[0].keys).toEqual(['category', 'name']);

    // The point of the whole design: nothing a caller passed is on the event
    const serialized = JSON.stringify(events[0]);

    expect(serialized).not.toContain('nothing-matches-this');
    expect(serialized).not.toContain('urgent');
    expect(events[0]).not.toHaveProperty('sql');
    expect(events[0]).not.toHaveProperty('statement');
    expect(events[0]).not.toHaveProperty('params');
  });

  test('the same call twice is the same shape, and two calls are not', async () => {
    const events = await recording(henri, async () => {
      await Task.find({ name: 'a' });
      await Task.find({ name: 'b' });
      await Task.find({ category: 'low' });
      await Task.count({ name: 'a' });
    });

    expect(events).toHaveLength(4);
    // Different values, same shape: that is what makes an N+1 findable
    expect(events[0].shape).toBe(events[1].shape);
    // A different column is a different question
    expect(events[2].shape).not.toBe(events[0].shape);
    // So is a different operation
    expect(events[3].shape).not.toBe(events[0].shape);
  });

  test('a write per record is reported like a read per record', async () => {
    const task = await Task.create({ name: 'five' });
    const events = await recording(henri, async () => {
      await task.update({ name: 'five and a half' });
    });

    expect(events).toHaveLength(1);
    expect(events[0].operation).toBe('update');
    expect(events[0].model).toBe('Task');
  });

  test('a call that throws is still reported', async () => {
    const events = await recording(henri, async () => {
      await expect(Task.create({})).rejects.toThrow();
    });

    expect(events).toHaveLength(1);
    expect(events[0].method).toBe('create');
    expect(events[0].rows).toBe(0);
  });

  test('outside a request there is a requestId of null, and events still flow', async () => {
    const events = await recording(henri, () => Task.find());

    expect(events[0].requestId).toBeNull();
  });

  test('inside a request the event carries the id everything else joins on', async () => {
    const events = await recording(henri, () =>
      inRequest('a-request-id', () => Task.find())
    );

    expect(events[0].requestId).toBe('a-request-id');
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
    const before = detector.threshold;

    detector.threshold = 5;

    try {
      const findings = await inRequest('n-plus-one', async () => {
        const tasks = await Task.find();

        // The shape this whole tranche is about: one lookup per record,
        // where one lookup for the set would do
        for (const task of tasks) {
          await User.findByKey(task.ownerId);
        }

        return detector.findings(
          context.getStore() && context.getStore().queries
        );
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        count: 6,
        method: 'findByKey',
        model: 'User',
        operation: 'select',
      });
      // The eager load is one call and is never a finding
      expect(findings.some((one) => one.model === 'Task')).toBe(false);
    } finally {
      detector.threshold = before;
    }
  });

  test('include() is one call, which is why the detector counts calls', async () => {
    const owner = await User.create({
      email: 'grace@example.test',
      name: 'Grace',
      password: 'secret-enough',
    });

    for (let index = 0; index < 6; index += 1) {
      await Task.create({ name: `owned ${index}`, ownerId: owner.id });
    }

    const events = await recording(henri, () =>
      Task.find({}, { include: ['owner'] })
    );

    // Six tasks, one owner each, one model call: on this adapter an eager
    // load compiles to a single correlated subquery, so there is no lazy
    // association for a loop to trip over
    expect(events).toHaveLength(1);
    expect(events[0].rows).toBe(6);
  });
});
