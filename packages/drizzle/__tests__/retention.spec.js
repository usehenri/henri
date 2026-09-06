// Retention and the access trail against a real Drizzle store.
//
// Both live in @usehenri/core and both reach a database the adapter opened:
// the sweep through the model API, the trail through `query()` and a table
// of its own. This file runs them on whatever the environment points at --
// sqlite offline, a PostgreSQL or a MySQL server with
// HENRI_TEST_POSTGRES_URL or HENRI_TEST_MYSQL_URL (`pnpm test:sql:live`).
const { build, target } = require('./helpers');

const {
  planOf,
  retentionConfig,
  rulesOf,
  sweepOf,
} = require('../../core/src/base/retention');
const { fieldsOf } = require('../../core/src/base/privacy');
const { appendTo, toEntry, verifyChain } = require('../../core/src/base/trail');
const { storeFor } = require('../../core/src/base/trail-store');

/** A moment, that many days ago */
const ago = (days) => new Date(Date.now() - days * 86400000);

const models = [
  {
    globalId: 'Booking',
    identity: 'booking',
    options: {
      paranoid: true,
      retention: [
        { after: '30d', from: 'leftAt', name: 'left' },
        {
          action: 'anonymize',
          after: '90d',
          from: 'leftAt',
          name: 'words',
          where: { state: 'kept' },
        },
        { action: 'soft-delete', after: '7d', from: 'seenAt', name: 'stale' },
      ],
      timestamps: true,
    },
    schema: {
      guest: { personal: { erase: 'anonymize' }, type: 'string' },
      leftAt: { type: 'date' },
      seenAt: { type: 'date' },
      state: { type: 'string' },
    },
    store: 'default',
  },
];

describe(`retention on ${target.name}`, () => {
  let adapter = null;
  let Booking = null;

  const context = (settings = {}) => ({
    fieldsOf: () => fieldsOf(models[0]),
    modelOf: () => Booking,
    rules: rulesOf(models, { fields: () => fieldsOf(models[0]) }),
    settings: { ...retentionConfig(null), approve: false, ...settings },
  });

  beforeAll(async () => {
    ({ adapter } = build());
    models.forEach((model) => adapter.addModel(model, 'user'));
    await adapter.start();
    Booking = adapter.getModels().Booking;
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  beforeEach(async () => {
    await Booking.withDeleted().where({}).destroy({ force: true });
  });

  test('a delete reaches the soft-deleted rows, and leaves the young ones', async () => {
    const hidden = await Booking.create({ guest: 'Hidden', leftAt: ago(60) });

    await Booking.where({ id: hidden.id }).destroy();
    await Booking.create({ guest: 'Gone', leftAt: ago(60) });
    await Booking.create({ guest: 'Recent', leftAt: ago(1) });
    await Booking.create({ guest: 'Still here' });

    const receipt = await sweepOf(context(), { only: 'Booking:left' });

    expect(receipt.rules[0].written).toBe(2);
    expect(receipt.rules[0].waiting).toBe(1);
    expect(await Booking.withDeleted().where({}).count()).toBe(2);
  });

  test('an anonymize writes over the personal fields of its class', async () => {
    await Booking.create({ guest: 'Ada', leftAt: ago(120), state: 'kept' });
    await Booking.create({ guest: 'Grace', leftAt: ago(120), state: 'other' });

    const receipt = await sweepOf(context(), { only: 'Booking:words' });

    expect(receipt.rules[0].written).toBe(1);

    const rows = await Booking.find({}, { order: 'state' });

    expect(rows.map((row) => row.guest)).toEqual(['[erased]', 'Grace']);
  });

  test('a soft delete stamps the row, and never comes for a stamped one', async () => {
    await Booking.create({ guest: 'Old', seenAt: ago(30) });
    await Booking.create({ guest: 'New', seenAt: ago(1) });

    const first = await sweepOf(context(), { only: 'Booking:stale' });

    expect(first.rules[0].written).toBe(1);
    expect(await Booking.count()).toBe(1);
    expect(await Booking.withDeleted().where({}).count()).toBe(2);

    const plan = await planOf(context(), { only: 'Booking:stale' });

    expect(plan.steps[0].matched).toBe(0);
  });

  test('a batch bounds one run and says what is left', async () => {
    for (let index = 0; index < 5; index += 1) {
      await Booking.create({ guest: `Guest ${index}`, leftAt: ago(60) });
    }

    const receipt = await sweepOf(context({ batch: 2 }), {
      only: 'Booking:left',
    });

    expect(receipt.rules[0].matched).toBe(5);
    expect(receipt.rules[0].written).toBe(2);
    expect(receipt.rules[0].remaining).toBe(3);
  });
});

describe(`the access trail on ${target.name}`, () => {
  let adapter = null;
  let store = null;

  beforeAll(async () => {
    ({ adapter } = build());
    await adapter.start();
    // No key: a database of this file's own, so the chain starts empty --
    // the last test here leaves a tampered row behind on purpose
    store = storeFor(adapter, 'henri_trail');
    await store.install();
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  test('the install is idempotent', async () => {
    await expect(store.install()).resolves.toBeDefined();
  });

  test('a push leaves the tables henri owns alone', () => {
    // Drizzle-kit compares the schema to the database and would offer to
    // drop a table it does not know; the trail's is not drizzle's to drop
    expect([...adapter.reservedTables()].sort()).toEqual([
      'henri_jobs',
      'henri_jobs_schedules',
      'henri_trail',
    ]);
  });

  test('entries go in, come back and verify', async () => {
    const first = await appendTo(
      store,
      {
        action: 'privacy.erase',
        fields: ['email'],
        ids: ['0192-one'],
        meta: { strategy: 'anonymize' },
        model: 'User',
        records: 1,
        source: 'cli',
        subjectDigest: 'digest-one',
      },
      { secret: 'k' }
    );

    await appendTo(
      store,
      { action: 'retention.sweep', model: 'Booking', records: 4 },
      { secret: 'k' }
    );

    expect(first.seq).toBeGreaterThan(0);

    const [row] = await store.list({ action: 'privacy.erase' });

    expect(toEntry(row)).toMatchObject({
      fields: ['email'],
      ids: ['0192-one'],
      meta: { strategy: 'anonymize' },
      model: 'User',
      records: 1,
    });
    expect(await store.count({ digest: 'digest-one' })).toBe(1);
    expect((await verifyChain(store, { secret: 'k' })).ok).toBe(true);
  });

  test('concurrent writers make one chain, not two', async () => {
    const before = await store.count({});

    await Promise.all(
      Array.from({ length: 10 }, (ignored, index) =>
        appendTo(store, { action: `app.${index}` }, { secret: 'k' })
      )
    );

    expect(await store.count({})).toBe(before + 10);

    const verified = await verifyChain(store, { secret: 'k' });

    expect(verified.ok).toBe(true);
    expect(verified.entries).toBe(before + 10);
  });

  test('a prune takes a prefix away, and the checkpoint keeps the chain', async () => {
    const old = await appendTo(
      store,
      { action: 'app.old', at: Date.now() - 86400000 },
      { secret: 'k' }
    );

    await appendTo(store, { action: 'app.new' }, { secret: 'k' });

    const { last, removed } = await store.prune(Date.now() - 3600000);

    expect(removed).toBeGreaterThan(0);
    expect(last.hash).toBe(old.hash);

    await appendTo(
      store,
      {
        action: 'trail.pruned',
        meta: { hash: last.hash, seq: Number(last.seq) },
        records: removed,
        source: 'job',
      },
      { secret: 'k' }
    );

    expect((await verifyChain(store, { secret: 'k' })).ok).toBe(true);
  });

  test('an edited row breaks the chain, and the break is named', async () => {
    const [row] = await store.list({ limit: 1 });

    await adapter.query(
      `UPDATE henri_trail SET records = ${adapter.dialect.placeholder(1)} WHERE id = ${adapter.dialect.placeholder(2)}`,
      [999, row.id]
    );

    const result = await verifyChain(store, { secret: 'k' });

    expect(result.ok).toBe(false);
    expect(result.broken.reason).toBe('hash');
    expect(result.broken.seq).toBe(Number(row.seq));
  });
});
