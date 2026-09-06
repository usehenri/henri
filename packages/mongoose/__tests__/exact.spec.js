const { MongoMemoryServer } = require('mongodb-memory-server');
const Mongoose = require('../index');
const { normalizeSchema } = require('../schema');

/**
 * `decimal` and `bigint` on MongoDB. Every test writes a value and reads it
 * back, and asserts it is the *same* value rather than a near one -- the
 * same suite the SQL adapters run, so the two answer alike.
 */

let mongod;

/**
 * Builds a minimal henri stand-in for the adapter
 *
 * @returns {object} fake henri
 */
const fakeHenri = () => {
  const pen = {};

  ['error', 'fatal', 'info', 'warn'].forEach((level) => {
    pen[level] = () => undefined;
  });

  return {
    _user: null,
    config: { get: () => undefined, has: () => false },
    isTest: true,
    pen,
    user: { encrypt: async (password) => `hashed:${password}` },
  };
};

/**
 * Builds an adapter on the shared in-memory server
 *
 * @param {string} database A database name
 * @returns {object} The adapter
 */
const build = (database) =>
  new Mongoose('default', { url: mongod.getUri(database) }, fakeHenri());

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
}, 120000);

afterAll(async () => {
  await mongod?.stop();
}, 60000);

describe('decimal and bigint (mongodb)', () => {
  let adapter;
  let Invoice;

  beforeAll(async () => {
    adapter = build('exact');
    Invoice = adapter.addModel({
      globalId: 'Invoice',
      identity: 'invoice',
      options: { timestamps: false },
      schema: {
        amount: { scale: 2, type: 'decimal' },
        name: { type: 'string' },
        rate: { type: 'decimal' },
        reference: { type: 'bigint' },
      },
      store: 'default',
    });
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  test('maps the two names to the bson types that carry them', () => {
    expect(Invoice.schema.path('amount').instance).toBe('Decimal128');
    expect(Invoice.schema.path('reference').instance).toBe('BigInt');
  });

  test('a decimal round-trips at its scale, however it was written', async () => {
    for (const [given, expected] of [
      ['19.99', '19.99'],
      [19.99, '19.99'],
      ['19.9900', '19.99'],
      ['1e1', '10.00'],
      ['-2.5', '-2.50'],
      ['0', '0.00'],
    ]) {
      const created = await Invoice.create({ amount: given, name: 'x' });
      const read = await Invoice.findById(created.externalId);
      const lean = await Invoice.findById(created.externalId).lean();

      expect(created.amount).toBe(expected);
      expect(read.amount).toBe(expected);
      expect(read.toJSON().amount).toBe(expected);
      expect(lean.amount).toBe(expected);
    }
  });

  test('a cent added a hundred times is a dollar, exactly', async () => {
    const created = await Invoice.create({ amount: '1.00', name: 'cents' });
    const read = await Invoice.findById(created.externalId);

    expect(read.amount).toBe('1.00');
    expect(read.amount === '1.00').toBe(true);
  });

  test('0.1 + 0.2 is refused rather than stored', async () => {
    await expect(
      Invoice.create({ name: 'float', rate: 0.1 + 0.2 })
    ).rejects.toThrow(/at most 4 decimal places/u);
  });

  test('a bigint past 2^53 comes back whole', async () => {
    for (const reference of [
      '9223372036854775807',
      '-9223372036854775808',
      '9007199254740993',
      '2147483648',
    ]) {
      const created = await Invoice.create({ name: 'big', reference });
      const read = await Invoice.findById(created.externalId);

      expect(created.reference).toBe(reference);
      expect(read.reference).toBe(reference);
      expect(JSON.parse(JSON.stringify(read)).reference).toBe(reference);
    }
  });

  test('the bounds of the column are refused, not rounded', async () => {
    await expect(
      Invoice.create({ amount: '19.999', name: 'precise' })
    ).rejects.toThrow(/at most 2 decimal places/u);
    await expect(
      Invoice.create({ name: 'past', reference: '9223372036854775808' })
    ).rejects.toThrow();
    await expect(
      Invoice.create({ name: 'unsafe', reference: 2 ** 60 })
    ).rejects.toThrow();
  });

  test('a comparison and an order are numeric', async () => {
    const other = build('exact-query');
    const Ledger = other.addModel({
      globalId: 'Ledger',
      identity: 'ledger',
      options: { timestamps: false },
      schema: {
        count: { type: 'bigint' },
        label: { type: 'string' },
        total: { scale: 2, type: 'decimal' },
      },
      store: 'default',
    });

    await other.start();

    for (const [label, total, count] of [
      ['a', '9.99', '9223372036854775807'],
      ['b', '10.00', '-5'],
      ['c', '100.50', '0'],
      ['d', '-2.50', '9007199254740993'],
    ]) {
      await Ledger.create({ count, label, total });
    }

    expect((await Ledger.findOne({ total: '10' })).label).toBe('b');
    expect(
      (await Ledger.find({ total: { $gt: '10' } })).map((row) => row.label)
    ).toEqual(['c']);
    expect(
      (await Ledger.find({}).sort('total')).map((row) => row.label)
    ).toEqual(['d', 'a', 'b', 'c']);
    expect(
      (
        await Ledger.find({ count: { $gt: '9007199254740992' } }).sort('label')
      ).map((row) => row.label)
    ).toEqual(['a', 'd']);

    await other.stop();
  });

  test('a precision or a scale on anything but a decimal fails the boot', () => {
    expect(() =>
      normalizeSchema({ count: { scale: 2, type: 'bigint' } })
    ).toThrow(/takes no 'scale'/u);
    expect(() =>
      normalizeSchema({ price: { precision: 99, type: 'decimal' } })
    ).toThrow(/between 1 and 38/u);
  });
});
