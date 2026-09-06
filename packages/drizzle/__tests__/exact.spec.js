const { ValidationError } = require('../validation');
const { build, target } = require('./helpers');

/**
 * The point of `decimal` and `bigint` is that the value comes back the way
 * it went in. Every test here writes a value and reads it back, and asserts
 * it is the *same* value rather than a near one -- on sqlite offline, and
 * on the live PostgreSQL and MySQL of `pnpm test:sql:live`, which is where
 * the bugs of this change would only ever have shown up.
 */

const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  options: { timestamps: false },
  schema: {
    // The one people reach for: money
    amount: { scale: 2, type: 'decimal' },
    name: { type: 'string' },
    // The default settings, 19 total digits and 4 after the point
    rate: { type: 'decimal' },
    // A 64-bit identifier, the other half of the change
    reference: { type: 'bigint' },
  },
  store: 'default',
};

describe(`decimal and bigint (${target.name})`, () => {
  let adapter;
  let Invoice;

  beforeAll(async () => {
    ({ adapter } = build());
    Invoice = adapter.addModel(invoiceModel);
    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  describe('the round trip', () => {
    test('a cent added a hundred times is a dollar, exactly', async () => {
      // The demonstration: the same loop through a double gives
      // 1.0000000000000007, and `that sum === 1.00` is false
      const invoice = await Invoice.create({ amount: '0.00', name: 'cents' });
      let total = 0n;

      for (let index = 0; index < 100; index += 1) {
        total += 1n;
      }

      await invoice.update({ amount: `${total / 100n}.${total % 100n}` });

      const read = await Invoice.findByKey(invoice.id);

      expect(read.amount).toBe('1.00');
      expect(read.amount === '1.00').toBe(true);
    });

    test('0.1 + 0.2 is refused rather than stored as 0.30000000000000004', async () => {
      // A double arriving where an exact column was asked for is the whole
      // silent difference: henri will not round it into the column
      await expect(
        Invoice.create({ name: 'float', rate: 0.1 + 0.2 })
      ).rejects.toThrow(ValidationError);

      const created = await Invoice.create({ name: 'exact', rate: '0.3' });

      expect(created.rate).toBe('0.3000');
      expect((await Invoice.findByKey(created.id)).rate).toBe('0.3000');
    });

    test('the literal a person writes down survives a javascript number', async () => {
      const created = await Invoice.create({ amount: 19.99, name: 'literal' });

      expect(created.amount).toBe('19.99');
      expect((await Invoice.findByKey(created.id)).amount).toBe('19.99');
    });

    test('a bigint past 2^53 comes back whole', async () => {
      const values = [
        '9223372036854775807',
        '-9223372036854775808',
        '9007199254740993',
        '0',
      ];

      for (const reference of values) {
        const created = await Invoice.create({ name: 'big', reference });
        const read = await Invoice.findByKey(created.id);

        expect(created.reference).toBe(reference);
        expect(read.reference).toBe(reference);
      }
    });

    test('a value that would overflow a 32-bit integer column is stored', async () => {
      // What `BIGINT` used to become: `ERROR: integer out of range`
      const created = await Invoice.create({
        name: 'overflow',
        reference: '2147483648',
      });

      expect((await Invoice.findByKey(created.id)).reference).toBe(
        '2147483648'
      );
    });

    test('every value is a string, whatever the dialect handed back', async () => {
      const created = await Invoice.create({
        amount: '1.50',
        name: 'types',
        rate: '0.0001',
        reference: 7,
      });
      const read = await Invoice.findByKey(created.id);

      expect(typeof read.amount).toBe('string');
      expect(typeof read.rate).toBe('string');
      expect(typeof read.reference).toBe('string');
      expect(read.reference).toBe('7');
    });

    test('a null stays null', async () => {
      const created = await Invoice.create({ name: 'empty' });
      const read = await Invoice.findByKey(created.id);

      expect(read.amount).toBeNull();
      expect(read.reference).toBeNull();
    });
  });

  describe('what leaves the server', () => {
    test('toJSON keeps the string, so JSON.stringify never throws', async () => {
      const created = await Invoice.create({
        amount: '12.34',
        name: 'json',
        reference: '9223372036854775807',
      });
      const body = JSON.parse(JSON.stringify(created));

      expect(body.amount).toBe('12.34');
      expect(body.reference).toBe('9223372036854775807');
    });
  });

  describe('the bounds of the column', () => {
    test('more decimal places than the scale is a validation error', async () => {
      await expect(
        Invoice.create({ amount: '19.999', name: 'too precise' })
      ).rejects.toThrow(/at most 2 decimal places/u);
    });

    test('trailing zeros are not decimal places', async () => {
      const created = await Invoice.create({
        amount: '19.9900',
        name: 'padded',
      });

      expect(created.amount).toBe('19.99');
    });

    test('more digits than the precision is a validation error', async () => {
      await expect(
        Invoice.create({ name: 'too big', rate: '12345678901234567' })
      ).rejects.toThrow(/at most 15 digits before the decimal point/u);
    });

    test('a bigint outside the signed 64-bit range is refused', async () => {
      await expect(
        Invoice.create({ name: 'past', reference: '9223372036854775808' })
      ).rejects.toThrow(
        /between -9223372036854775808 and 9223372036854775807/u
      );
    });

    test('a javascript number past the safe range is refused, not rounded', async () => {
      await expect(
        Invoice.create({ name: 'unsafe', reference: 2 ** 60 })
      ).rejects.toThrow(/pass it as a string/u);
    });

    test('a value that is not a number at all is refused', async () => {
      await expect(
        Invoice.create({ amount: 'nineteen', name: 'words' })
      ).rejects.toThrow(/must be a decimal number/u);
    });
  });

  describe('querying', () => {
    let Ledger;

    beforeAll(async () => {
      Ledger = adapter.addModel({
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

      await adapter.start();

      for (const [label, total, count] of [
        ['a', '9.99', '9223372036854775807'],
        ['b', '10.00', '-5'],
        ['c', '100.50', '0'],
        ['d', '-2.50', '9007199254740993'],
      ]) {
        await Ledger.create({ count, label, total });
      }
    });

    test('an equality finds the row however the value was spelled', async () => {
      for (const value of ['10.00', '10', 10, '1e1']) {
        const found = await Ledger.findOne({ total: value });

        expect(found && found.label).toBe('b');
      }
    });

    test('a greater-than is a number, not text', async () => {
      // `'9.99' > '10'` lexicographically, which is the answer a text
      // column gives without the cast of ./dialects.js
      const rows = await Ledger.find(
        { total: { gt: '10' } },
        {
          order: 'label',
        }
      );

      expect(rows.map((row) => row.label)).toEqual(['c']);
    });

    test('a range keeps the negative values below zero', async () => {
      const rows = await Ledger.find({ total: { lt: '0' } });

      expect(rows.map((row) => row.label)).toEqual(['d']);
    });

    test('between reads both ends', async () => {
      const rows = await Ledger.find(
        { total: { between: ['9.99', '10.00'] } },
        { order: 'label' }
      );

      expect(rows.map((row) => row.label)).toEqual(['a', 'b']);
    });

    test('an order is numeric', async () => {
      const rows = await Ledger.find({}, { order: 'total' });

      expect(rows.map((row) => row.label)).toEqual(['d', 'a', 'b', 'c']);
    });

    test('a bigint comparison is exact past 2^53', async () => {
      const rows = await Ledger.find(
        { count: { gt: '9007199254740992' } },
        { order: 'label' }
      );

      expect(rows.map((row) => row.label)).toEqual(['a', 'd']);
    });

    test('a bigint order is numeric, negatives included', async () => {
      const rows = await Ledger.find({}, { order: 'count' });

      expect(rows.map((row) => row.label)).toEqual(['b', 'c', 'd', 'a']);
    });

    test('an `in` takes the values however they were spelled', async () => {
      const rows = await Ledger.find(
        { total: ['9.99', 10] },
        { order: 'label' }
      );

      expect(rows.map((row) => row.label)).toEqual(['a', 'b']);
    });

    test('a condition that is not a number is refused, not matched as text', async () => {
      await expect(Ledger.find({ total: 'ten' })).rejects.toThrow(
        /HENRI_MODEL_INVALID_QUERY|must be a decimal number/u
      );
    });
  });
});
