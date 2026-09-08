const { build, target } = require('./helpers');

/**
 * The property this whole feature exists for, written as a test:
 * **tenant A cannot read or write tenant B's rows.**
 *
 * It is deliberately written as one list of paths rather than a happy path
 * plus edge cases, because the paths people forget are the whole point: a
 * `count`, a `paginate`, a mass update, an eager loaded association, an
 * `instance.save()` that never builds a query at all, a soft delete and a
 * restore. Every one of them is asserted twice -- what tenant A sees, and
 * what tenant B's row does *not* do -- so a condition dropped from any one
 * of them fails here and not in production.
 *
 * It runs on sqlite offline and on the live PostgreSQL or MySQL of
 * `pnpm test:sql:live`, which is what `./targets.js` decides.
 */

const invoiceModel = {
  globalId: 'Invoice',
  identity: 'invoice',
  options: { paranoid: true, tenant: true, timestamps: true },
  schema: {
    amount: { default: 0, type: 'integer' },
    reference: { required: true, type: 'string' },
  },
};

const lineModel = {
  globalId: 'Line',
  identity: 'line',
  options: { tenant: true, timestamps: true },
  schema: {
    invoiceId: {
      index: true,
      references: { model: 'Invoice' },
      type: 'integer',
    },
    label: { type: 'string' },
  },
};

const planModel = {
  globalId: 'Plan',
  identity: 'plan',
  options: { timestamps: true },
  schema: { name: { type: 'string' } },
};

// A tenant column the model declares itself, which is what lets a tenant be
// an existing column rather than one henri adds
const ticketModel = {
  globalId: 'Ticket',
  identity: 'ticket',
  options: { tenant: 'accountId', timestamps: true },
  schema: {
    accountId: { index: true, type: 'string' },
    subject: { type: 'string' },
  },
};

describe('multi-tenancy: tenant A never reaches tenant B', () => {
  let adapter;
  let henri;
  let Invoice;
  let Line;
  let Plan;
  let Ticket;

  /**
   * Runs something as a tenant
   *
   * @param {string} tenant The tenant
   * @param {function} work What to run
   * @returns {Promise<*>} Whatever the work answered
   */
  const as = (tenant, work) => henri.tenancy.run(tenant, work);

  beforeAll(async () => {
    ({ adapter, henri } = build({ tenancy: { from: { user: 'tenantId' } } }));

    Invoice = adapter.addModel(invoiceModel, 'user');
    Line = adapter.addModel(lineModel, 'user');
    Plan = adapter.addModel(planModel, 'user');
    Ticket = adapter.addModel(ticketModel, 'user');

    Invoice.hasMany('Line', { as: 'lines', foreignKey: 'invoiceId' });
    Line.belongsTo('Invoice', { as: 'invoice', foreignKey: 'invoiceId' });

    await adapter.start();
  });

  afterAll(async () => {
    await adapter.stop();
  });

  beforeEach(async () => {
    await henri.tenancy.unscoped(async () => {
      await Line.destroy();
      await Invoice.withDeleted().destroy({ force: true });
      await Ticket.destroy();
      await Plan.destroy();
    });
  });

  describe('the column', () => {
    test('a marked model gets the column, a shared one does not', () => {
      expect(Object.keys(Invoice.fields)).toContain('tenantId');
      expect(Object.keys(Plan.fields)).not.toContain('tenantId');
      expect(Invoice.tenant).toEqual({
        column: 'tenantId',
        declared: false,
        length: 190,
      });
      expect(Plan.tenant).toBeNull();
    });

    test('a model naming its own column keeps it and gets no second one', () => {
      expect(Ticket.tenant.column).toBe('accountId');
      expect(Ticket.tenant.declared).toBe(true);
      expect(Object.keys(Ticket.fields)).not.toContain('tenantId');
    });

    test('a create is stamped rather than supplied', async () => {
      const invoice = await as('acme', () =>
        Invoice.create({ amount: 10, reference: 'a-1' })
      );

      expect(invoice.tenantId).toBe('acme');
    });
  });

  describe('reading', () => {
    beforeEach(async () => {
      await as('acme', () => Invoice.create({ amount: 10, reference: 'a-1' }));
      await as('acme', () => Invoice.create({ amount: 20, reference: 'a-2' }));
      await as('globex', () =>
        Invoice.create({ amount: 30, reference: 'b-1' })
      );
    });

    test('find, findOne and pluck answer only this tenant', async () => {
      const mine = await as('acme', () => Invoice.find());

      expect(mine.map((row) => row.reference).sort()).toEqual(['a-1', 'a-2']);
      expect(
        await as('acme', () => Invoice.findOne({ reference: 'b-1' }))
      ).toBe(null);
      expect(await as('globex', () => Invoice.pluck('reference'))).toEqual([
        'b-1',
      ]);
    });

    test('count and exists answer only this tenant', async () => {
      expect(await as('acme', () => Invoice.count())).toBe(2);
      expect(await as('globex', () => Invoice.count())).toBe(1);
      expect(
        await as('globex', () => Invoice.exists({ reference: 'a-1' }))
      ).toBe(false);
    });

    test('paginate counts and lists the same tenant', async () => {
      const page = await as('acme', () => Invoice.paginate({ perPage: 10 }));

      expect(page.total).toBe(2);
      expect(page.records).toHaveLength(2);
      expect(page.records.every((row) => row.tenantId === 'acme')).toBe(true);
    });

    test('a where can narrow the tenant and never reach past it', async () => {
      const asked = await as('acme', () =>
        Invoice.find({ tenantId: 'globex' })
      );

      expect(asked).toEqual([]);
    });

    test('findById answers null for another tenant, not the row', async () => {
      const theirs = await as('globex', () =>
        Invoice.findOne({ reference: 'b-1' })
      );

      expect(await as('acme', () => Invoice.findById(theirs.externalId))).toBe(
        null
      );
      expect(
        await as('globex', () => Invoice.findById(theirs.externalId))
      ).not.toBeNull();
    });

    test('findByKey -- the primary key lookup -- is scoped too', async () => {
      const theirs = await as('globex', () =>
        Invoice.findOne({ reference: 'b-1' })
      );

      expect(await as('acme', () => Invoice.findByKey(theirs.id))).toBe(null);
    });

    // Eager loading is `LEFT JOIN LATERAL` on the MySQL dialect of
    // drizzle-orm, and MariaDB has no LATERAL (target.eagerLoads says
    // why); `mariadb.spec.js` asserts the syntax error
    test.skipIf(!target.eagerLoads)(
      'an eager loaded association carries the tenant',
      async () => {
        const mine = await as('acme', () =>
          Invoice.findOne({ reference: 'a-1' })
        );

        await as('acme', () =>
          Line.create({ invoiceId: mine.id, label: 'ours' })
        );

        // The same invoice id, written by somebody else: an include that did
        // not carry the tenant would hand it over with the parent
        await as('globex', () =>
          Line.create({ invoiceId: mine.id, label: 'theirs' })
        );

        const loaded = await as('acme', () =>
          Invoice.include('lines').where({ reference: 'a-1' }).first()
        );

        expect(loaded.lines.map((line) => line.label)).toEqual(['ours']);
      }
    );
  });

  describe('writing', () => {
    test('a mass update reaches only this tenant', async () => {
      await as('acme', () => Invoice.create({ amount: 1, reference: 'a-1' }));
      await as('globex', () => Invoice.create({ amount: 1, reference: 'b-1' }));

      const changed = await as('acme', () =>
        Invoice.update({}, { amount: 99 })
      );

      expect(changed).toBe(1);
      expect(
        (await as('globex', () => Invoice.findOne({ reference: 'b-1' }))).amount
      ).toBe(1);
    });

    test('a mass destroy reaches only this tenant', async () => {
      await as('acme', () => Invoice.create({ amount: 1, reference: 'a-1' }));
      await as('globex', () => Invoice.create({ amount: 1, reference: 'b-1' }));

      await as('acme', () => Invoice.destroy());

      expect(await as('globex', () => Invoice.count())).toBe(1);
      expect(await as('acme', () => Invoice.count())).toBe(0);
    });

    test('an instance loaded as one tenant is not saved as another', async () => {
      const theirs = await as('globex', () =>
        Invoice.create({ amount: 5, reference: 'b-1' })
      );

      theirs.amount = 500;

      // `instance.save()` never builds a query -- it updates by primary key
      // -- which is exactly why the condition is added down in
      // `updateById()`. The row is invisible to this tenant, so the update
      // matches nothing and says the same thing a deleted row says: an id
      // somebody else owns and an id that never existed are one answer
      await expect(as('acme', () => theirs.save())).rejects.toThrow(
        /no longer exists/u
      );

      const read = await as('globex', () =>
        Invoice.findOne({ reference: 'b-1' })
      );

      expect(read.amount).toBe(5);
    });

    test('a soft delete and a restore are scoped', async () => {
      const theirs = await as('globex', () =>
        Invoice.create({ amount: 5, reference: 'b-1' })
      );

      await as('acme', () => theirs.destroy());

      expect(await as('globex', () => Invoice.count())).toBe(1);

      await as('globex', () => theirs.destroy());

      expect(await as('globex', () => Invoice.count())).toBe(0);
      expect(await as('globex', () => Invoice.withDeleted().count())).toBe(1);
    });

    test('a write naming another tenant is refused, not obeyed', async () => {
      await expect(
        as('acme', () =>
          Invoice.create({ reference: 'a-1', tenantId: 'globex' })
        )
      ).rejects.toMatchObject({ code: 'HENRI_TENANT_CROSS_WRITE' });

      const invoice = await as('acme', () =>
        Invoice.create({ reference: 'a-2' })
      );

      await expect(
        as('acme', () => invoice.update({ tenantId: 'globex' }))
      ).rejects.toMatchObject({ code: 'HENRI_TENANT_CROSS_WRITE' });
    });

    test('a write naming this tenant is fine', async () => {
      const invoice = await as('acme', () =>
        Invoice.create({ reference: 'a-1', tenantId: 'acme' })
      );

      expect(invoice.tenantId).toBe('acme');
    });
  });

  describe('with no tenant in scope -- a job, a seed, the console', () => {
    test('a read is refused rather than answering every tenant', async () => {
      await as('acme', () => Invoice.create({ reference: 'a-1' }));

      await expect(Invoice.find()).rejects.toMatchObject({
        code: 'HENRI_TENANT_REQUIRED',
      });
      await expect(Invoice.count()).rejects.toMatchObject({
        code: 'HENRI_TENANT_REQUIRED',
      });
      await expect(Invoice.paginate({})).rejects.toMatchObject({
        code: 'HENRI_TENANT_REQUIRED',
      });
    });

    test('a write is refused too', async () => {
      await expect(
        Invoice.create({ reference: 'orphan' })
      ).rejects.toMatchObject({ code: 'HENRI_TENANT_REQUIRED' });
      await expect(Invoice.destroy()).rejects.toMatchObject({
        code: 'HENRI_TENANT_REQUIRED',
      });
    });

    test('the refusal names the model and what to do', async () => {
      const failure = await Invoice.find().catch((error) => error);

      expect(failure.message).toContain('Invoice');
      expect(failure.message).toContain('henri.tenancy.run');
      expect(failure.message).toContain('henri.tenancy.unscoped');
    });

    test('a shared model is untouched by any of it', async () => {
      await Plan.create({ name: 'free' });

      expect(await Plan.count()).toBe(1);
      expect(await as('acme', () => Plan.count())).toBe(1);
    });

    test('unscoped() is the one way past, and it is a context', async () => {
      await as('acme', () => Invoice.create({ reference: 'a-1' }));
      await as('globex', () => Invoice.create({ reference: 'b-1' }));

      expect(await henri.tenancy.unscoped(() => Invoice.count())).toBe(2);

      // And it ends where it ends
      await expect(Invoice.count()).rejects.toMatchObject({
        code: 'HENRI_TENANT_REQUIRED',
      });
    });

    test('a job that carries its tenant reads exactly that tenant', async () => {
      await as('acme', () => Invoice.create({ amount: 7, reference: 'a-1' }));
      await as('globex', () => Invoice.create({ amount: 9, reference: 'b-1' }));

      // What a job's `perform(args)` does with the tenant its arguments
      // carried: one line, and the refusal above is what makes forgetting
      // it a failure rather than a leak
      const performed = await henri.tenancy.run('acme', async () => {
        const rows = await Invoice.find();

        return rows.map((row) => row.reference);
      });

      expect(performed).toEqual(['a-1']);
    });
  });

  describe('what is deliberately not covered', () => {
    test('adapter.query() is raw SQL and carries no tenant', async () => {
      await as('acme', () => Invoice.create({ reference: 'a-1' }));
      await as('globex', () => Invoice.create({ reference: 'b-1' }));

      // Written down rather than glossed over. henri cannot parse a
      // statement to add a condition to it, so a raw query reaches every
      // tenant and the guide says so. `henri.tenancy.current()` is what the
      // application interpolates, and `henri audit` reports a query() in a
      // multi-tenant application
      const rows = await adapter.query(
        `SELECT COUNT(*) AS total FROM ${Invoice.tableName}`
      );
      const total = Number(
        (Array.isArray(rows) ? rows[0] : rows.rows[0]).total
      );

      expect(total).toBe(2);
      expect(henri.tenancy.current()).toBeNull();
    });
  });

  describe('a model naming its own column', () => {
    test('is scoped by that column', async () => {
      await as('acme', () => Ticket.create({ subject: 'ours' }));
      await as('globex', () => Ticket.create({ subject: 'theirs' }));

      const mine = await as('acme', () => Ticket.find());

      expect(mine.map((row) => row.subject)).toEqual(['ours']);
      expect(mine[0].accountId).toBe('acme');
    });
  });
});
