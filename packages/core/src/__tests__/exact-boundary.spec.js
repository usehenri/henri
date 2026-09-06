/* global Invoice */
const Henri = require('../henri');
const { columnsOf } = require('../base/openapi');
const { describe: describeModels, sdlOf } = require('../base/graphql-schema');
const { anonymousValue } = require('../base/erasure');

/**
 * What an application gets from a `decimal` and a `bigint`, everywhere the
 * value leaves the model: the instance, `toJSON()`, what henri publishes,
 * the version diff, the OpenAPI description and the GraphQL definition. The
 * round trip runs against MongoDB, through the demo application core's own
 * tests boot, so the same claim is proved on all three adapters.
 *
 * The claim is one sentence: **an exact value is a decimal string, and it
 * is the same string here as on the SQL adapters.**
 */

/** A configuration with a user model and nothing else to say */
const config = { user: { model: 'user' } };

const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  options: { timestamps: true },
  schema: {
    amount: { precision: 12, scale: 2, type: 'decimal' },
    rate: { type: 'decimal' },
    reference: { type: 'bigint', unique: true },
    title: { required: true, type: 'string' },
  },
};

describe('decimal and bigint at the boundary', () => {
  describe('the description of an exact column', () => {
    test('openapi keeps the settings the model declared', () => {
      const columns = columnsOf(invoiceModel, {
        externalIds: true,
        references: true,
        user: config.user,
      });

      expect(columns.amount).toMatchObject({ scale: 2, type: 'decimal' });
      expect(columns.reference).toMatchObject({ type: 'bigint' });
    });

    test('graphql says String, because a Float would undo the column', () => {
      const [described] = describeModels(
        [{ ...invoiceModel, graphql: true }],
        config
      );
      const fields = Object.fromEntries(
        described.fields.map((field) => [field.name, field.type])
      );

      expect(fields.amount).toBe('String');
      expect(fields.rate).toBe('String');
      expect(fields.reference).toBe('String');
      expect(sdlOf(described)).toContain('amount: String');
    });
  });

  describe('erasure', () => {
    test('anonymizes an exact field to zero, written out', () => {
      // A string, not 0: the adapter is what pads it to the scale of its
      // column, and every other value of the field is a string too
      expect(anonymousValue('amount', { type: 'decimal' }, 'token')).toBe('0');
      expect(anonymousValue('reference', { type: 'bigint' }, 'token')).toBe(
        '0'
      );
    });
  });

  describe('through the demo application (mongodb)', () => {
    const skipWorkers = process.env.SKIP_WORKERS;
    let counter = 0;
    let henri;

    beforeAll(async () => {
      process.env.SKIP_WORKERS = '1';
      henri = new Henri();
      await henri.init();
      global.henri = henri;
    }, 60000);

    afterAll(async () => {
      await henri.stop();
      delete global.henri;
      if (typeof skipWorkers === 'undefined') {
        delete process.env.SKIP_WORKERS;
      } else {
        process.env.SKIP_WORKERS = skipWorkers;
      }
    }, 60000);

    /**
     * A reference nothing else in this file uses, past 2^53
     *
     * @returns {string} the digits
     */
    const reference = () => {
      counter += 1;

      return String(9007199254740993n + BigInt(counter));
    };

    test('a cent added a hundred times is a dollar, exactly', async () => {
      let total = 0n;

      for (let index = 0; index < 100; index += 1) {
        total += 1n;
      }

      const invoice = await Invoice.create({
        amount: `${total / 100n}.${total % 100n}`,
        reference: reference(),
        title: 'cents',
      });
      const read = await Invoice.findById(invoice.externalId);

      expect(read.amount).toBe('1.00');
      expect(read.amount === '1.00').toBe(true);
    });

    test('0.1 + 0.2 never reaches the column', async () => {
      await expect(
        Invoice.create({
          rate: 0.1 + 0.2,
          reference: reference(),
          title: 'float',
        })
      ).rejects.toThrow(/at most 4 decimal places/u);
    });

    test('a bigint past 2^53 survives the round trip', async () => {
      const value = '9223372036854775807';
      const invoice = await Invoice.create({ reference: value, title: 'big' });

      expect(invoice.reference).toBe(value);
      expect((await Invoice.findById(invoice.externalId)).reference).toBe(
        value
      );
    });

    test('what henri publishes is the string, at every depth', async () => {
      const invoice = await Invoice.create({
        amount: '19.99',
        rate: '0.0125',
        reference: reference(),
        title: 'published',
      });
      const [published] = await henri.model.publish([invoice]);

      expect(published.amount).toBe('19.99');
      expect(published.rate).toBe('0.0125');
      expect(typeof published.reference).toBe('string');
      // The one that would throw if any of them were a BigInt
      expect(JSON.parse(JSON.stringify(published)).amount).toBe('19.99');
    });

    test('a version diff holds the strings, so a restore writes them back', async () => {
      const invoice = await Invoice.create({
        amount: '10.00',
        reference: reference(),
        title: 'versioned',
      });

      await invoice.updateOne({ amount: '12.50' });

      const history = await henri.versions.of({
        model: 'Invoice',
        record: invoice.externalId,
      });

      // Both ends of the change, as the strings they are everywhere else:
      // a version that held a double would restore a different number
      expect(history[0].changes.amount).toEqual(['10.00', '12.50']);
      expect(history[1].changes.amount).toEqual([null, '10.00']);

      const reified = await henri.versions.reify(history[0].id);

      expect(reified.attributes.amount).toBe('12.50');
      expect(reified.complete).toBe(true);
    });
  });
});
