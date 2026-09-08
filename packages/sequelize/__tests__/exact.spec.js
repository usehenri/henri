// `decimal` and `bigint` on the Sequelize adapter.
//
// This adapter is reachable through `@usehenri/mssql` and nothing else,
// because Drizzle has no SQL Server dialect. The round trip runs on all
// three live servers -- the PostgreSQL and MySQL of `pnpm test:sql:live`,
// which exercise the base class, and the SQL Server of
// `pnpm test:sql:mssql`, which is the one an application actually reaches
// -- and offline the suite proves what runs everywhere: the refusals.
//
// There are two of those, and both are a driver reading an exact column
// through a double. Sequelize reads a sqlite DECIMAL that way and loses a
// BIGINT past 2^53, and tedious reads every SQL Server DECIMAL that way
// (measured, not assumed: see `what mssql refuses` below). There is no
// seam in this adapter to store the digits as text and cast for a
// comparison the way @usehenri/drizzle does on sqlite, so a model asking
// for a type its dialect would change fails the boot naming the field.
const { DataTypes } = require('sequelize');
const { normalizeSchema } = require('../schema');
const { build, target } = require('./helpers');

const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  options: { timestamps: false },
  schema: {
    amount: { precision: 12, scale: 2, type: 'decimal' },
    name: { type: 'string' },
    rate: { type: 'decimal' },
    reference: { type: 'bigint' },
  },
  store: 'default',
};

describe(`decimal and bigint (${target.name})`, () => {
  describe('what sqlite refuses', () => {
    test('a decimal on sqlite fails the boot naming the model and the field', () => {
      expect(() =>
        normalizeSchema(
          { amount: { type: 'decimal' } },
          { dialect: 'sqlite', model: 'Invoice' }
        )
      ).toThrow(
        /Field 'amount' of Invoice is a decimal, which @usehenri\/sequelize cannot carry on sqlite/u
      );
    });

    test('so does a bigint, and it points at the adapter that can', () => {
      let error = null;

      try {
        normalizeSchema(
          { reference: { type: 'bigint' } },
          { dialect: 'sqlite', model: 'Invoice' }
        );
      } catch (thrown) {
        error = thrown;
      }

      expect(error.code).toBe('HENRI_MODEL_TYPE_UNSUPPORTED');
      expect(error.message).toMatch(/@usehenri\/drizzle/u);
    });

    test('every other dialect takes them', () => {
      for (const dialect of ['postgres', 'mysql']) {
        const { attributes } = normalizeSchema(
          {
            amount: { precision: 12, scale: 2, type: 'decimal' },
            reference: { type: 'bigint' },
          },
          { dialect, model: 'Invoice' }
        );

        expect(attributes.amount.type.toSql()).toMatch(/DECIMAL\(12, ?2\)/u);
        expect(String(attributes.reference.type.key)).toBe('BIGINT');
      }
    });
  });

  // The same downgrade one type narrower, and it was found by running these
  // suites against a real SQL Server: tedious reads every DECIMAL as
  // `value / Math.pow(10, scale)`, so DECIMAL(12, 2) -2.50 comes back -2.5
  // and DECIMAL(38, 10) 12345678901234567890.1234567891 comes back
  // 12345678901234567000. A BIGINT is handed back as a string and is exact
  describe('what mssql refuses', () => {
    test('a decimal on mssql fails the boot naming the driver', () => {
      let error = null;

      try {
        normalizeSchema(
          { amount: { precision: 12, scale: 2, type: 'decimal' } },
          { dialect: 'mssql', model: 'Invoice' }
        );
      } catch (thrown) {
        error = thrown;
      }

      expect(error.code).toBe('HENRI_MODEL_TYPE_UNSUPPORTED');
      expect(error.message).toMatch(/tedious driver reads every DECIMAL/u);
    });

    test('a bigint is taken: tedious hands that one back as a string', () => {
      const { attributes } = normalizeSchema(
        { reference: { type: 'bigint' } },
        { dialect: 'mssql', model: 'Invoice' }
      );

      expect(String(attributes.reference.type.key)).toBe('BIGINT');
    });
  });

  describe('the sequelize spellings of the same column', () => {
    test('a DECIMAL(p, s) is read as the henri decimal', () => {
      const { attributes } = normalizeSchema(
        { amount: { type: DataTypes.DECIMAL(10, 2) } },
        { dialect: 'postgres', model: 'Invoice' }
      );

      expect(attributes.amount.type.toSql()).toMatch(/DECIMAL\(10, ?2\)/u);
      expect(typeof attributes.amount.get).toBe('function');
      expect(attributes.amount.validate.henriExact).toBeInstanceOf(Function);
    });

    test('a BIGINT is too', () => {
      const { attributes } = normalizeSchema(
        { count: { type: DataTypes.BIGINT } },
        { dialect: 'postgres', model: 'Invoice' }
      );

      expect(typeof attributes.count.get).toBe('function');
    });

    test('a bare DECIMAL is refused: MySQL makes it whole units', () => {
      expect(() =>
        normalizeSchema(
          { amount: { type: DataTypes.DECIMAL } },
          { dialect: 'postgres', model: 'Invoice' }
        )
      ).toThrow(
        /DECIMAL with no precision, which MySQL makes DECIMAL\(10, 0\)/u
      );
    });

    test('a precision on anything but a decimal is refused', () => {
      expect(() =>
        normalizeSchema(
          { count: { precision: 4, type: 'bigint' } },
          { dialect: 'postgres', model: 'Invoice' }
        )
      ).toThrow(/takes no 'precision'/u);
    });
  });

  // On a live server, the same round trip the other two adapters prove
  const live = target.name === 'sqlite' ? describe.skip : describe;
  // SQL Server carries the bigint half of it and refuses the other, so the
  // model it runs is the model without the decimals
  const noDecimal = target.name === 'mssql';
  const roundTripModel =
    target.name === 'mssql'
      ? {
          ...invoiceModel,
          schema: {
            name: invoiceModel.schema.name,
            reference: invoiceModel.schema.reference,
          },
        }
      : invoiceModel;

  live('the round trip', () => {
    let adapter;
    let Invoice;

    beforeAll(async () => {
      ({ adapter } = build());
      Invoice = adapter.addModel(roundTripModel);
      await adapter.start();
      await adapter.connector.sync({ force: true });
    });

    afterAll(async () => {
      await adapter.stop();
    });

    test.skipIf(noDecimal)(
      'a decimal comes back at its scale, exactly',
      async () => {
        for (const [given, expected] of [
          ['19.99', '19.99'],
          [19.99, '19.99'],
          ['19.9900', '19.99'],
          ['-2.5', '-2.50'],
        ]) {
          const created = await Invoice.create({ amount: given, name: 'x' });
          const read = await Invoice.findByPk(created.id);

          expect(created.amount).toBe(expected);
          expect(read.amount).toBe(expected);
          expect(JSON.parse(JSON.stringify(read)).amount).toBe(expected);
        }
      }
    );

    test.skipIf(noDecimal)(
      'a cent added a hundred times is a dollar, exactly',
      async () => {
        const created = await Invoice.create({ amount: '1.00', name: 'cents' });

        expect((await Invoice.findByPk(created.id)).amount).toBe('1.00');
      }
    );

    test.skipIf(noDecimal)(
      '0.1 + 0.2 is refused rather than stored',
      async () => {
        await expect(
          Invoice.create({ name: 'float', rate: 0.1 + 0.2 })
        ).rejects.toThrow(/at most 4 decimal places/u);
      }
    );

    test('a bigint past 2^53 comes back whole', async () => {
      for (const reference of [
        '9223372036854775807',
        '-9223372036854775808',
        '9007199254740993',
        '2147483648',
      ]) {
        const created = await Invoice.create({ name: 'big', reference });
        const read = await Invoice.findByPk(created.id);

        expect(created.reference).toBe(reference);
        expect(read.reference).toBe(reference);
      }
    });

    test.skipIf(noDecimal)(
      'the bounds of a decimal are refused, not rounded',
      async () => {
        await expect(
          Invoice.create({ amount: '19.999', name: 'precise' })
        ).rejects.toThrow(/at most 2 decimal places/u);
      }
    );

    test('the bounds of a bigint are refused, not rounded', async () => {
      await expect(
        Invoice.create({ name: 'past', reference: '9223372036854775808' })
      ).rejects.toThrow(/between -9223372036854775808/u);
      await expect(
        Invoice.create({ name: 'unsafe', reference: 2 ** 60 })
      ).rejects.toThrow(/pass it as a string/u);
    });
  });
});
