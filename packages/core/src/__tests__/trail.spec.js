/* global Memo, User */
const Henri = require('../henri');
// The SQL adapters come from the workspace: core does not depend on them,
// the suite only needs a sqlite-backed store of each to append to a real
// table through a real adapter
const Sql = require('../../../sequelize');
const Drizzle = require('../../../drizzle');

const {
  appendTo,
  canonicalOf,
  digestOf,
  guard,
  hashOf,
  rowOf,
  toEntry,
  trailConfig,
  verifyChain,
} = require('../base/trail');
const { install, storeFor } = require('../base/trail-store');

/** The henri a store adapter needs to be built outside of a boot */
const shim = () => ({
  _user: null,
  config: { get: () => undefined, has: () => false },
  cwd: () => process.cwd(),
  isProduction: false,
  pen: {
    error: () => {},
    fatal: () => new Error('x'),
    info: () => {},
    warn: () => {},
  },
  user: { encrypt: async (value) => `hashed:${value}` },
});

describe('what an entry may hold', () => {
  const context = {
    filters: ['password', 'token'],
    keys: new Set(['email', 'name', 'phone']),
    secret: 'test',
  };

  test('names and counts go in', () => {
    expect(
      guard({ count: 12, dryRun: true, missing: null, rule: 'drafts' }, context)
    ).toEqual({ count: 12, dryRun: true, missing: null, rule: 'drafts' });
    expect(guard(null, context)).toBeNull();
  });

  test('a field the models marked personal never does', () => {
    expect(() => guard({ name: 'Ada Lovelace' }, context)).toThrow(
      /marked personal/u
    );
    expect(() => guard({ phone: '555' }, context)).toThrow(/marked personal/u);
  });

  test('and neither does anything masked in the logs', () => {
    expect(() => guard({ password: 'hunter2' }, context)).toThrow(
      /filterParameters/u
    );
    expect(() => guard({ resetToken: 'abc' }, context)).toThrow(
      /filterParameters/u
    );
  });

  test('a value that is content rather than a label is refused', () => {
    expect(() => guard({ body: 'x'.repeat(201) }, context)).toThrow(
      /content, not a label/u
    );
    expect(() => guard({ who: 'ada@example.com' }, context)).toThrow(
      /email address/u
    );
    expect(() => guard({ record: { id: 1 } }, context)).toThrow(
      /not a name or a count/u
    );
    expect(() => guard('everything', context)).toThrow(/flat object/u);
  });

  test('an entry needs to say what happened', () => {
    expect(() => rowOf({}, context)).toThrow(/needs an action/u);
    expect(() => rowOf({ action: 'x'.repeat(65) }, context)).toThrow(
      /needs an action/u
    );
  });

  test('an entry holds identifiers and field names, and nothing else', () => {
    const row = rowOf(
      {
        action: 'privacy.export',
        actorOf: '42',
        fields: ['email', 'name'],
        ids: ['0192-abc', null, ''],
        model: 'User',
        outcome: 'ok',
        records: 3,
        source: 'cli',
        subject: '0192-def',
      },
      context
    );

    expect(row.action).toBe('privacy.export');
    expect(row.fields).toBe('["email","name"]');
    expect(row.ids).toBe('["0192-abc"]');
    expect(row.records).toBe(3);
    expect(row.source).toBe('cli');
    expect(row.subject).toBe('0192-def');
    // The actor is named by a digest of their key, never by the key
    expect(row.actor_digest).toBe(digestOf('42', 'test'));
    expect(row.actor).toBeNull();
  });

  test('an unknown source or outcome falls back rather than being stored', () => {
    const row = rowOf(
      { action: 'app.thing', outcome: 'maybe', source: 'somewhere' },
      context
    );

    expect(row.outcome).toBe('ok');
    expect(row.source).toBe('app');
  });

  test('the configuration is off until it says otherwise', () => {
    expect(trailConfig(null).enabled).toBe(false);
    expect(trailConfig({ get: () => false, has: () => true }).enabled).toBe(
      false
    );

    const on = trailConfig({
      get: () => ({ reads: 'personal', table: 'audit' }),
      has: () => true,
    });

    expect(on).toEqual({
      enabled: true,
      keep: 31536000000,
      reads: 'personal',
      store: 'default',
      table: 'audit',
    });
    expect(
      trailConfig({
        get: () => ({ keep: false, reads: 'nope' }),
        has: () => true,
      })
    ).toMatchObject({ keep: null, reads: false });
  });
});

describe('the chain (no database)', () => {
  /** A store that keeps its rows in an array, unique `seq` and all */
  const memory = () => {
    const rows = [];

    return {
      /**
       * Appends a row unless its sequence number is taken
       *
       * @param {object} row the row
       * @returns {Promise<boolean>} whether it went in
       */
      async append(row) {
        if (rows.some((entry) => entry.seq === row.seq)) {
          return false;
        }

        rows.push(row);

        return true;
      },
      /**
       * The last row
       *
       * @returns {Promise<?object>} the row
       */
      async last() {
        return rows[rows.length - 1] || null;
      },
      rows,
      /**
       * The rows after a sequence number
       *
       * @param {number} after the sequence number
       * @param {number} limit how many
       * @returns {Promise<Array>} the rows
       */
      async since(after, limit) {
        return rows.filter((row) => row.seq > after).slice(0, limit);
      },
    };
  };

  test('every entry chains onto the one before it', async () => {
    const store = memory();

    await appendTo(store, { action: 'privacy.export' }, { secret: 'k' });
    await appendTo(store, { action: 'privacy.erase' }, { secret: 'k' });
    const third = await appendTo(
      store,
      { action: 'app.thing' },
      { secret: 'k' }
    );

    expect(store.rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(third.prev).toBe(store.rows[1].hash);
    expect(await verifyChain(store, { secret: 'k' })).toEqual({
      broken: null,
      entries: 3,
      from: 1,
      ok: true,
      to: 3,
    });
  });

  test('an edited row is what the chain is for', async () => {
    const store = memory();

    for (const action of ['app.one', 'app.two', 'app.three']) {
      await appendTo(store, { action }, { secret: 'k' });
    }

    // Somebody changes what an entry says
    store.rows[1].records = 99;

    const result = await verifyChain(store, { secret: 'k' });

    expect(result.ok).toBe(false);
    expect(result.broken).toEqual({ after: 1, reason: 'hash', seq: 2 });
  });

  test('a removed row is too', async () => {
    const store = memory();

    for (const action of ['app.one', 'app.two', 'app.three']) {
      await appendTo(store, { action }, { secret: 'k' });
    }

    store.rows.splice(1, 1);

    const result = await verifyChain(store, { secret: 'k' });

    expect(result.ok).toBe(false);
    expect(result.broken.reason).toBe('chain');
  });

  test('the hash is keyed, so the tail cannot be re-chained without it', async () => {
    const store = memory();

    await appendTo(store, { action: 'app.one' }, { secret: 'k' });

    expect((await verifyChain(store, { secret: 'other' })).ok).toBe(false);
  });

  test('two writers racing for one sequence number make one chain', async () => {
    const store = memory();

    await Promise.all(
      Array.from({ length: 12 }, (ignored, index) =>
        appendTo(store, { action: `app.${index}` }, { secret: 'k' })
      )
    );

    expect(store.rows.map((row) => row.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect((await verifyChain(store, { secret: 'k' })).ok).toBe(true);
  });

  test('the canonical form is what the hash covers, in a fixed order', () => {
    const row = rowOf({ action: 'app.one', records: 2 }, { secret: 'k' });

    row.seq = 1;
    expect(canonicalOf(row)).toContain('"app.one"');
    expect(hashOf(null, row, 'k')).toBe(hashOf(null, row, 'k'));
    expect(hashOf('abc', row, 'k')).not.toBe(hashOf(null, row, 'k'));
  });

  test('a stored row reads back as an entry', () => {
    const row = rowOf(
      { action: 'app.one', fields: ['name'], ids: ['abc'], meta: { count: 2 } },
      { secret: 'k' }
    );

    row.hash = 'h';
    row.seq = 1;

    const entry = toEntry(row);

    expect(entry.fields).toEqual(['name']);
    expect(entry.ids).toEqual(['abc']);
    expect(entry.meta).toEqual({ count: 2 });
    expect(entry.at).toMatch(/^\d{4}-/u);
    expect(toEntry(null)).toBeNull();
  });
});

describe('the table', () => {
  test('every dialect gets a create and its indexes, all idempotent', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql', 'mssql']) {
      const statements = install(dialect, 'henri_trail');

      expect(statements.length).toBeGreaterThan(0);
      expect(statements[0]).toMatch(/CREATE TABLE/u);
      expect(statements.join('\n')).toMatch(/seq/u);
      // Nothing may run twice and fail
      expect(
        statements.every((statement) =>
          /IF NOT EXISTS|IF OBJECT_ID|sys\.indexes|UNIQUE KEY/u.test(statement)
        )
      ).toBe(true);
    }

    // The unique index on seq is what makes two writers one chain
    expect(install('postgres', 'henri_trail').join('\n')).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "henri_trail_seq"/u
    );
  });

  test('a table name that is not an identifier never reaches a statement', () => {
    expect(() => install('sqlite', 'henri trail; drop table users')).toThrow(
      /letters, digits and underscores/u
    );
  });

  test('a dialect henri cannot talk to is refused', () => {
    expect(() => install('oracle', 'henri_trail')).toThrow(
      /cannot be kept in a oracle store/u
    );
  });
});

describe('appending through a store adapter', () => {
  const backends = [];
  let sql = null;
  let drizzle = null;

  beforeAll(async () => {
    sql = new Sql(
      'default',
      {
        adapter: 'sqlite',
        dialect: 'sqlite',
        logging: false,
        storage: ':memory:',
      },
      shim()
    );
    await sql.start();

    drizzle = new Drizzle(
      'default',
      { dialect: 'sqlite', url: ':memory:' },
      shim()
    );
    await drizzle.start();

    backends.push(['sequelize', storeFor(sql, 'henri_trail')]);
    backends.push(['drizzle', storeFor(drizzle, 'henri_trail')]);

    for (const [, store] of backends) {
      await store.install();
    }
  }, 30000);

  afterAll(async () => {
    await sql.stop();
    await drizzle.stop();
  });

  test('the install is idempotent on both adapters', async () => {
    for (const [, store] of backends) {
      await expect(store.install()).resolves.toBeDefined();
    }
  });

  test('entries go in, come back and verify', async () => {
    for (const [name, store] of backends) {
      await appendTo(
        store,
        {
          action: 'privacy.erase',
          fields: ['email'],
          ids: ['0192-one'],
          meta: { adapter: name },
          model: 'User',
          records: 1,
          source: 'cli',
          subjectDigest: `digest-${name}`,
        },
        { secret: 'k' }
      );
      await appendTo(
        store,
        { action: 'retention.sweep', model: 'Memo', records: 4 },
        { secret: 'k' }
      );

      const rows = await store.list({ action: 'privacy.erase' });

      expect(rows).toHaveLength(1);
      expect(toEntry(rows[0])).toMatchObject({
        action: 'privacy.erase',
        fields: ['email'],
        ids: ['0192-one'],
        meta: { adapter: name },
        model: 'User',
        records: 1,
        subjectDigest: `digest-${name}`,
      });

      expect(await store.count({})).toBe(2);
      expect(await store.count({ digest: `digest-${name}` })).toBe(1);
      expect((await verifyChain(store, { secret: 'k' })).ok).toBe(true);
    }
  });

  test('a prune takes the oldest away and leaves a link behind', async () => {
    for (const [, store] of backends) {
      const old = await appendTo(
        store,
        { action: 'app.old', at: Date.now() - 86400000 },
        { secret: 'k' }
      );

      await appendTo(store, { action: 'app.new' }, { secret: 'k' });

      const { last, removed } = await store.prune(Date.now() - 3600000);

      expect(removed).toBeGreaterThan(0);
      expect(last.hash).toBe(old.hash);

      // Without the checkpoint the chain now starts from a `prev` nothing
      // explains; with it, what remains still verifies
      const checkpoint = await appendTo(
        store,
        {
          action: 'trail.pruned',
          meta: { hash: last.hash, seq: Number(last.seq) },
          records: removed,
          source: 'job',
        },
        { secret: 'k' }
      );

      expect(checkpoint.meta.hash).toBe(old.hash);
      expect((await verifyChain(store, { secret: 'k' })).ok).toBe(true);
    }
  });

  test('an edited row is caught through a real adapter', async () => {
    const [, store] = backends[0];
    const [row] = await store.list({ limit: 1 });

    await sql.query(`UPDATE henri_trail SET records = 999 WHERE id = ?`, [
      row.id,
    ]);

    const result = await verifyChain(store, { secret: 'k' });

    expect(result.ok).toBe(false);
    expect(result.broken.reason).toBe('hash');
  });
});

describe('the module, in the demo application', () => {
  let henri = null;
  const skipWorkers = process.env.SKIP_WORKERS;

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

  test('the trail is on, and it is a table henri owns', () => {
    expect(henri.trail.enabled).toBe(true);
    expect(henri.trail.settings.table).toBe('henri_trail');
    // Off by default: recording every read is a second database
    expect(henri.trail.settings.reads).toBe(false);
  });

  test('an export and an erasure are recorded, refusals included', async () => {
    const user = await User.create({
      email: 'trail@demo.test',
      name: 'Trailed',
      password: 'longenoughpassword',
    });

    await Memo.create({
      body: 'something',
      ownerId: String(user._id),
      title: 'One',
    });

    await henri.privacy.export('trail@demo.test');

    const [exported] = await henri.trail.list({ action: 'privacy.export' });

    expect(exported.model).toBe('User');
    expect(exported.records).toBe(2);
    expect(exported.outcome).toBe('ok');

    // The person is named by a digest, so the address is not in the table
    expect(exported.subjectDigest).toEqual(expect.any(String));
    expect(JSON.stringify(exported)).not.toMatch(/trail@demo\.test/u);

    // ... and the digest is what answers "prove it happened"
    const about = await henri.trail.about('trail@demo.test');

    expect(about.map((entry) => entry.action)).toContain('privacy.export');

    await henri.privacy.erase('trail@demo.test');

    const [erased] = await henri.trail.list({ action: 'privacy.erase' });

    expect(erased.outcome).toBe('ok');
    expect(erased.meta.dryRun).toBe(false);
    // The erasure took the address away; the digest still finds it
    expect(
      (await henri.trail.about('trail@demo.test')).map((entry) => entry.action)
    ).toEqual(['privacy.erase', 'privacy.export']);

    // A refusal is written down too
    await expect(henri.privacy.erase('nobody@demo.test')).rejects.toThrow();

    expect((await henri.trail.list({ outcome: 'refused' })).length).toBe(0);
  });

  test('the chain of a real application holds', async () => {
    const result = await henri.trail.verify();

    expect(result.ok).toBe(true);
    expect(result.entries).toBeGreaterThan(0);
  });

  test('the trail refuses to become a second copy of what it protects', async () => {
    await expect(
      henri.trail.record({ action: 'app.thing', meta: { name: 'Ada' } })
    ).rejects.toThrow(/marked personal/u);
  });

  test('a prune takes a prefix away and leaves a link behind (mongodb)', async () => {
    // The demo boots the disk adapter, so this is the MongoDB backend of
    // the trail rather than the SQL one the suite above exercises
    expect(henri.trail.store.kind).toBe('mongo');

    const old = await henri.trail.record({
      action: 'app.old',
      at: Date.now() - 2 * 86400000,
      records: 1,
    });

    await henri.trail.record({ action: 'app.new', records: 1 });

    const settings = henri.trail.settings;

    henri.trail.settings = { ...settings, keep: 86400000 };

    try {
      const pruned = await henri.trail.prune();

      expect(pruned.removed).toBeGreaterThan(0);
      expect(pruned.checkpoint.action).toBe('trail.pruned');
      expect(pruned.checkpoint.meta.hash).toBe(old.hash);
      // The chain still verifies: what went was a prefix, and the
      // checkpoint carries the link it ended on
      expect((await henri.trail.verify()).ok).toBe(true);
    } finally {
      henri.trail.settings = settings;
    }
  });

  test('a prune with nothing to take away does nothing', async () => {
    const before = await henri.trail.count({});

    expect(await henri.trail.prune({ now: 0 })).toMatchObject({
      checkpoint: null,
      removed: 0,
    });
    expect(await henri.trail.count({})).toBe(before);
  });

  test('reading it back on an application without one says so', () => {
    const off = Object.create(Object.getPrototypeOf(henri.trail));

    Object.assign(off, henri.trail, { enabled: false, store: null });

    expect(() => off.ready()).toThrow(/keeps no access trail/u);
  });
});
