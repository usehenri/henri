const { build, fakeHenri, taskModel } = require('./helpers');
const Drizzle = require('../index');

/**
 * The calls that used to mean something else.
 *
 * `@usehenri/postgresql` and `@usehenri/mysql` are this adapter now, and
 * the spellings they answered to before belong to another ORM. Most of
 * them fail on their own -- `Model.scope()` does not exist, an unknown
 * column throws -- and those need nothing from us. These are the ones that
 * did not: a call that ran, answered, and did something other than what it
 * said. Every one of them is a coded refusal here, because a wrong query
 * that looks like it worked is worse than one that never ran.
 */

/**
 * The error a call threw, so a test can read its code
 *
 * @param {Function} fn The call
 * @returns {Error} What it threw
 */
const refusal = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }

  throw new Error('the call was not refused');
};

describe('calls that would silently mean something else', () => {
  let adapter;
  let Task;

  beforeAll(async () => {
    ({ adapter } = build());
    Task = adapter.addModel(taskModel, 'user');
    await adapter.start();
    await Task.create({ name: 'one' });
    await Task.create({ done: true, name: 'two' });
  });

  afterAll(async () => {
    await adapter.stop();
  });

  test('Model.update(values, { where }) is refused, not run backwards', async () => {
    // Read as written it means "update every row matching { done: true }
    // with a column called where": the wrong rows, and a count saying it
    // worked. It is refused before anything is sent, so this throws where
    // the call is written rather than rejecting later.
    expect(() =>
      Task.update({ done: true }, { where: { name: 'one' } })
    ).toThrow(/takes the condition first/u);
    expect(refusal(() => Task.update({ done: true }, { where: {} })).code).toBe(
      'HENRI_MODEL_INVALID_QUERY'
    );

    // Nothing was written
    expect((await Task.findOne({ name: 'one' })).done).toBe(false);

    // The order this adapter takes still works
    expect(await Task.update({ name: 'one' }, { done: true })).toBe(1);
    expect((await Task.findOne({ name: 'one' })).done).toBe(true);
    await Task.update({ name: 'one' }, { done: false });
  });

  test('a model with a `where` column can still write it', async () => {
    const { adapter: store } = build();
    const Rule = store.addModel(
      {
        globalId: 'Rule',
        identity: 'rule',
        schema: { where: { type: 'string' } },
      },
      'user'
    );

    await store.start();
    await Rule.create({ where: 'here' });
    expect(await Rule.update({ where: 'here' }, { where: 'there' })).toBe(1);
    await store.stop();
  });

  test('an option this adapter does not read is refused', async () => {
    // A dropped `fields` is a mass assignment the caller thought bounded
    await expect(
      Task.create({ category: 'high', name: 'three' }, { fields: ['name'] })
    ).rejects.toMatchObject({
      code: 'HENRI_MODEL_UNKNOWN_OPTION',
      message: expect.stringContaining('req.permit()'),
    });

    const transaction = refusal(() =>
      Task.find({ name: 'one' }, { transaction: {} })
    );

    expect(transaction.code).toBe('HENRI_MODEL_UNKNOWN_OPTION');
    expect(transaction.message).toContain('store.transaction()');
    expect(
      refusal(() => Task.destroy({ name: 'nothing' }, { cascade: true })).code
    ).toBe('HENRI_MODEL_UNKNOWN_OPTION');
  });

  test('the fluent spelling is checked too, not only the static one', async () => {
    await Task.create({ category: 'high', name: 'fluent' });

    // `Model.update(where, attrs, options)` checks and then builds this
    // relation; `Model.where(...).update(attrs, options)` builds it
    // straight away, and a write that thought it was inside a transaction
    // is the same defect whichever way it was written
    await expect(
      Task.where({ name: 'fluent' }).update(
        { category: 'low' },
        { transaction: {} }
      )
    ).rejects.toMatchObject({
      code: 'HENRI_MODEL_UNKNOWN_OPTION',
      message: expect.stringContaining('store.transaction()'),
    });

    await expect(
      Task.where({ name: 'fluent' }).destroy({ cascade: true })
    ).rejects.toMatchObject({ code: 'HENRI_MODEL_UNKNOWN_OPTION' });

    // Neither call touched the row
    const [task] = await Task.find({ name: 'fluent' });

    expect(task.category).toBe('high');
  });

  test('a condition keyed by a symbol is refused rather than dropped', async () => {
    const Op = { like: Symbol('like') };

    // Object.keys() skips symbols, so this condition would narrow nothing
    // and the query would answer every row
    // The condition is compiled when the query runs, so this one rejects
    await expect(
      Task.findAll({ name: { [Op.like]: '%o%' } })
    ).rejects.toMatchObject({
      code: 'HENRI_MODEL_INVALID_QUERY',
      message: expect.stringContaining('Symbol(like)'),
    });
    await expect(Task.findAll({ name: {} })).rejects.toMatchObject({
      code: 'HENRI_MODEL_INVALID_QUERY',
      message: expect.stringContaining('match every row'),
    });

    // The operators this adapter does read still work
    expect(await Task.count({ name: { like: '%o%' } })).toBe(2);
  });

  test('instance.get({ plain: true }) is refused', async () => {
    const row = await Task.findOne({ name: 'two' });

    expect(() => row.get({ plain: true })).toThrow(
      /reads one attribute by name/u
    );
    expect(row.get('name')).toBe('two');
    expect(row.toObject().name).toBe('two');
  });
});

describe('model options this adapter cannot honour', () => {
  /**
   * Adds a model with the given options to a store that never starts
   *
   * @param {object} options The `options` of the model file
   * @returns {void}
   * @throws {Error} What addModel throws
   */
  const withOptions = (options) => {
    const store = new Drizzle(
      'default',
      { dialect: 'sqlite', url: ':memory:' },
      fakeHenri()
    );

    store.addModel({ ...taskModel, options }, 'user');
  };

  test.each([
    ['indexes', [{ fields: ['name'] }], 'index: true'],
    ['scopes', { done: {} }, 'no equivalent'],
    ['defaultScope', { where: {} }, 'no equivalent'],
    ['hooks', {}, 'top level `hooks` key'],
    ['tableName', 'the_tasks', '`name` key'],
    ['underscored', true, 'named as the field is declared'],
    ['freezeTableName', true, '`name` key'],
  ])('refuses options.%s at boot', (key, value, hint) => {
    const error = refusal(() => withOptions({ [key]: value }));

    expect(error.code).toBe('HENRI_MODEL_UNKNOWN_OPTION');
    expect(error.message).toContain(hint);
    expect(error.message).toContain('Task');
  });

  test('keeps the five it reads', () => {
    expect(() =>
      withOptions({
        externalId: false,
        paranoid: true,
        personal: { subject: 'self' },
        retention: { action: 'delete', after: '90d' },
        timestamps: false,
      })
    ).not.toThrow();
  });
});
