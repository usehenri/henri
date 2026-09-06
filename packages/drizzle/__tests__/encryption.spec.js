const { buildWith, generateKey, target, withKeys } = require('./helpers');
const { normalizeSchema } = require('../schema');

/**
 * Encrypted attributes on the Drizzle adapter.
 *
 * The envelope itself is core's and is tested there; this is the wiring:
 * that the column holds ciphertext, that the model hands back the string,
 * that a deterministic field can be looked up (and a randomised one cannot,
 * loudly), that a soft-deleted row stays readable, and that a rotation
 * moves every row without moving `updatedAt`.
 *
 * It runs on sqlite offline and on the PostgreSQL or MySQL server of
 * `HENRI_TEST_POSTGRES_URL` / `HENRI_TEST_MYSQL_URL` when one is set, like
 * every other suite of this package.
 */

/**
 * The same envelope with one byte of the ciphertext flipped.
 *
 * Not the last character of the base64: the final character of a base64
 * string may carry bits that decode to nothing, so changing it can leave
 * the bytes identical and the tag intact. This changes a byte.
 *
 * @param {string} envelope An envelope
 * @returns {string} The same envelope, with one byte changed
 */
const tampered = (envelope) => {
  const [prefix, version, scheme, id, body] = envelope.split(':');
  const raw = Buffer.from(body, 'base64url');

  raw[raw.length - 1] ^= 0xff;

  return [prefix, version, scheme, id, raw.toString('base64url')].join(':');
};

const KEY = generateKey();
const OTHER = generateKey();

const personModel = {
  globalId: 'Person',
  identity: 'person',
  name: 'people',
  options: { paranoid: true, timestamps: true },
  schema: {
    badge: {
      encrypted: { deterministic: true },
      maxLength: 40,
      type: 'string',
      unique: true,
    },
    name: { type: 'string' },
    notes: { encrypted: true, type: 'text' },
  },
};

/**
 * An adapter with the Person model, on the target database
 *
 * @param {Array<string>} keys The keys, the one that writes first
 * @param {object} [settings={}] Other configuration values
 * @param {string} [key] A stable database key (see the helpers)
 * @returns {Promise<object>} `{ Person, adapter, henri }`
 */
const store = async (keys, settings = {}, key) => {
  const henri = await withKeys(keys, settings);
  const { adapter } = buildWith(henri, {}, key);
  const Person = adapter.addModel(personModel, 'user');

  await adapter.start();

  return { Person, adapter, henri };
};

describe('the mark, before anything is stored', () => {
  test('a randomised field becomes text and a deterministic one a bounded string', () => {
    const fields = normalizeSchema(personModel.schema, { model: 'Person' });

    expect(fields.notes).toMatchObject({
      encrypted: { deterministic: false },
      type: 'text',
    });
    expect(fields.badge).toMatchObject({
      encrypted: { deterministic: true },
      length: 700,
      type: 'string',
    });
    // What the plaintext was declared as is still validated
    expect(fields.badge.maxLength).toBe(40);
  });

  test('a type that is not text is refused', () => {
    expect(() =>
      normalizeSchema(
        { seenAt: { encrypted: true, type: 'date' } },
        { model: 'Person' }
      )
    ).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_UNSUPPORTED_TYPE' })
    );
  });

  test('a randomised field cannot be unique or indexed', () => {
    for (const extra of [{ unique: true }, { index: true }]) {
      expect(() =>
        normalizeSchema(
          { code: { encrypted: true, type: 'string', ...extra } },
          { model: 'Person' }
        )
      ).toThrow(
        expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
      );
    }
  });

  test('a mark henri does not understand is refused, not ignored', () => {
    for (const mark of [
      'yes',
      42,
      { deterministic: 'yes' },
      { rotate: true },
    ]) {
      expect(() =>
        normalizeSchema(
          { code: { encrypted: mark, type: 'string' } },
          { model: 'Person' }
        )
      ).toThrow(
        expect.objectContaining({ code: 'HENRI_ENCRYPTION_INVALID_MARK' })
      );
    }
  });

  test('an encrypted field cannot carry a default the database would write', () => {
    expect(() =>
      normalizeSchema(
        { code: { default: 'none', encrypted: true, type: 'string' } },
        { model: 'Person' }
      )
    ).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_INVALID_MARK' })
    );
  });

  test('henri refuses to boot a model that encrypts without a key', async () => {
    const henri = await withKeys([]);
    const { adapter } = buildWith(henri);

    expect(() => adapter.addModel(personModel, 'user')).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NO_KEY' })
    );
  });

  test('the fields henri owns on the user model cannot be encrypted', () => {
    expect(() =>
      normalizeSchema(
        { email: { encrypted: { deterministic: true }, type: 'string' } },
        { isUser: true, model: 'User' }
      )
    ).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_INVALID_MARK' })
    );
  });
});

describe('what the database holds and what the model hands back', () => {
  let context;

  beforeAll(async () => {
    context = await store([KEY]);
  }, 60000);

  afterAll(async () => {
    await context.adapter.stop();
    await target.cleanup();
  });

  test('the column is ciphertext and the attribute is the string', async () => {
    const { Person, adapter } = context;
    const created = await Person.create({
      badge: 'B-1',
      name: 'Ada',
      notes: 'allergic to bees',
    });

    expect(created.notes).toBe('allergic to bees');
    expect(created.badge).toBe('B-1');

    const [row] = await adapter.query(
      'select badge, notes from people where name = ?'.replace(
        '?',
        adapter.dialect.name === 'postgres' ? '$1' : '?'
      ),
      ['Ada']
    );

    expect(row.notes).toMatch(/^henri:v1:r:[0-9a-f]{8}:/u);
    expect(row.badge).toMatch(/^henri:v1:d:[0-9a-f]{8}:/u);
    expect(row.notes).not.toContain('bees');
    expect(row.badge).not.toContain('B-1');

    const found = await Person.findByKey(created.id);

    expect(found.notes).toBe('allergic to bees');
    expect(JSON.parse(JSON.stringify(found)).notes).toBe('allergic to bees');
  });

  test('the same plaintext is different bytes when randomised', async () => {
    const { Person, adapter } = context;

    await Person.create({ badge: 'B-same-1', name: 'One', notes: 'same' });
    await Person.create({ badge: 'B-same-2', name: 'Two', notes: 'same' });

    const rows = await adapter.query(
      "select notes from people where notes is not null and name in ('One', 'Two')"
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].notes).not.toBe(rows[1].notes);
  });

  test('the same plaintext is the same bytes when deterministic', async () => {
    const { Person, adapter } = context;

    await Person.create({ badge: 'B-dup', name: 'Three' });

    const [row] = await adapter.query(
      "select badge from people where name = 'Three'"
    );
    const again = await Person.findOne({ badge: 'B-dup' });

    expect(again.name).toBe('Three');
    expect(row.badge).toMatch(/^henri:v1:d:/u);
  });

  test('a deterministic field is still unique in the database', async () => {
    const { Person } = context;

    await expect(
      Person.create({ badge: 'B-1', name: 'Impostor' })
    ).rejects.toThrow();
  });

  test('an update writes ciphertext and reads back the plaintext', async () => {
    const { Person, adapter } = context;
    const person = await Person.findOne({ badge: 'B-1' });

    await person.update({ notes: 'no longer allergic' });

    expect(person.notes).toBe('no longer allergic');

    const [row] = await adapter.query(
      "select notes from people where name = 'Ada'"
    );

    expect(row.notes).toMatch(/^henri:v1:r:/u);
    expect((await Person.findOne({ badge: 'B-1' })).notes).toBe(
      'no longer allergic'
    );
  });

  test('a mass update encrypts too', async () => {
    const { Person, adapter } = context;

    await Person.update({ name: 'Two' }, { notes: 'bulk' });

    const [row] = await adapter.query(
      "select notes from people where name = 'Two'"
    );

    expect(row.notes).toMatch(/^henri:v1:r:/u);
    expect((await Person.findOne({ name: 'Two' })).notes).toBe('bulk');
  });

  test('a soft deleted row stays readable, and readable by badge', async () => {
    const { Person } = context;
    const person = await Person.create({
      badge: 'B-gone',
      name: 'Withdrawn',
      notes: 'still here',
    });

    await person.destroy();

    expect(await Person.findOne({ badge: 'B-gone' })).toBeNull();

    const [hidden] = await Person.onlyDeleted().where({ badge: 'B-gone' });

    expect(hidden.notes).toBe('still here');
  });

  // The value a request chooses must never be the thing that decides
  // whether it is encrypted, or a request could choose not to be
  test('a plaintext that looks like an envelope is encrypted like any other', async () => {
    const { Person, adapter } = context;
    const wearing = 'henri:v1:r:deadbeef:Tm90QW5FbnZlbG9wZQ';
    const created = await Person.create({
      badge: 'B-sneaky',
      name: 'Sneaky',
      notes: wearing,
    });

    expect(created.notes).toBe(wearing);

    const [row] = await adapter.query(
      "select notes from people where name = 'Sneaky'"
    );

    expect(row.notes).not.toBe(wearing);
    expect(row.notes).toMatch(/^henri:v1:r:[0-9a-f]{8}:/u);
    expect((await Person.findByKey(created.id)).notes).toBe(wearing);
  });
});

describe('what cannot be asked of a column that is ciphertext', () => {
  let context;

  beforeAll(async () => {
    context = await store([KEY]);
    await context.Person.create({ badge: 'Q-1', name: 'Query', notes: 'x' });
  }, 60000);

  afterAll(async () => {
    await context.adapter.stop();
    await target.cleanup();
  });

  test('a randomised field cannot be looked up by value', async () => {
    await expect(context.Person.findOne({ notes: 'x' })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('an encrypted field cannot be ordered by', async () => {
    await expect(context.Person.order('badge')).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
    await expect(context.Person.order('-badge')).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
    await expect(context.Person.order({ badge: 'desc' })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('a pattern or a range on a deterministic field is refused', async () => {
    for (const where of [
      { badge: { like: 'Q-%' } },
      { badge: { gt: 'A' } },
      { badge: { between: ['A', 'Z'] } },
    ]) {
      await expect(context.Person.find(where)).rejects.toThrow(
        expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
      );
    }
  });

  test('a refusal is a refusal, never an empty result', async () => {
    // The failure that would be invisible: a where that compiles, runs and
    // matches nothing because it compared a string to an envelope
    await expect(context.Person.find({ notes: 'x' })).rejects.toThrow();
    expect(await context.Person.find({ badge: 'Q-1' })).toHaveLength(1);
  });
});

describe('a rotation', () => {
  let context;

  beforeAll(async () => {
    context = await store([KEY]);

    for (const index of [1, 2, 3]) {
      await context.Person.create({
        badge: `R-${index}`,
        name: `Row ${index}`,
        notes: `secret ${index}`,
      });
    }

    // One of them is soft deleted: a rotation that skipped it would leave
    // a row nobody can read once the old key goes
    const gone = await context.Person.findOne({ badge: 'R-3' });

    await gone.destroy();
  }, 60000);

  afterAll(async () => {
    await context.adapter.stop();
    await target.cleanup();
  });

  test('a new key in front keeps every old row readable and findable', async () => {
    const { henri } = context;

    henri.config.get = (key) =>
      key === 'encryption' ? { keys: [OTHER, KEY] } : undefined;
    await henri.encryption.init();

    expect(henri.encryption.keys).toHaveLength(2);

    const found = await context.Person.findOne({ badge: 'R-1' });

    expect(found.notes).toBe('secret 1');

    // A row written now lands under the new key, and both are found
    await context.Person.create({
      badge: 'R-4',
      name: 'Row 4',
      notes: 'secret 4',
    });

    const both = await context.Person.find({ badge: ['R-1', 'R-4'] });

    expect(both.map((row) => row.notes).sort()).toEqual([
      'secret 1',
      'secret 4',
    ]);
  });

  test('the status counts by key id without opening anything', async () => {
    const { Person, henri } = context;

    henri.model = { stores: { default: context.adapter } };

    const report = await henri.encryption.status();
    const notes = report.fields.find((entry) => entry.field === 'notes');

    expect(report.primary).toBe(henri.encryption.keys[0]);
    // Three rows under the old key (the soft deleted one included) and one
    // under the new
    expect(notes.rows).toBe(4);
    expect(notes.current).toBe(1);
    expect(notes.stale).toBe(3);
    expect(report.ok).toBe(false);
    expect(Person.modelName).toBe('Person');
  });

  test('a dry run reports what it would do and writes nothing', async () => {
    const { henri } = context;
    const report = await henri.encryption.rotate({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.rotated).toBe(6);
    expect((await henri.encryption.status()).stale).toBe(6);
  });

  test('the rotation rewrites every row, soft deleted ones included', async () => {
    const { adapter, henri } = context;
    const before = await adapter.query(
      'select id, updated_at from people order by id'
    );
    const report = await henri.encryption.rotate();

    expect(report.failures).toEqual([]);
    expect(report.rotated).toBe(6);

    const after = await henri.encryption.status();

    expect(after.ok).toBe(true);
    expect(after.stale).toBe(0);
    expect(after.plaintext).toBe(0);

    // A rotation is not a change to the record
    const now = await adapter.query(
      'select id, updated_at from people order by id'
    );

    expect(now.map((row) => String(row.updated_at))).toEqual(
      before.map((row) => String(row.updated_at))
    );
  });

  test('the old key may now be dropped, and everything still reads', async () => {
    const { Person, henri } = context;

    henri.config.get = (key) =>
      key === 'encryption' ? { keys: [OTHER] } : undefined;
    await henri.encryption.init();

    const rows = await Person.withDeleted().where({});

    expect(rows.map((row) => row.notes).sort()).toEqual([
      'secret 1',
      'secret 2',
      'secret 3',
      'secret 4',
    ]);
    expect((await Person.findOne({ badge: 'R-2' })).name).toBe('Row 2');
  });
});

describe('a key that is not here', () => {
  let context;

  beforeAll(async () => {
    context = await store([KEY]);
    await context.Person.create({ badge: 'L-1', name: 'Lost', notes: 'gone' });

    context.henri.config.get = (key) =>
      key === 'encryption' ? { keys: [OTHER] } : undefined;
    await context.henri.encryption.init();
  }, 60000);

  afterAll(async () => {
    await context.adapter.stop();
    await target.cleanup();
  });

  test('reading says which key wrote it, and does not answer null', async () => {
    await expect(context.Person.withDeleted().where({})).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_KEY_UNKNOWN' })
    );
  });

  test('tolerate() reads null and says what it could not read', async () => {
    const { failures, value } = await context.henri.encryption.tolerate(() =>
      context.Person.withDeleted().where({})
    );

    expect(value[0].notes).toBeNull();
    expect(failures.map((entry) => entry.code)).toContain(
      'HENRI_ENCRYPTION_KEY_UNKNOWN'
    );
    expect(failures.map((entry) => entry.context).sort()).toEqual([
      'Person.badge',
      'Person.notes',
    ]);
  });

  test('a rotation counts the row and never overwrites it', async () => {
    const { adapter, henri } = context;

    henri.model = { stores: { default: adapter } };

    const before = await adapter.query('select notes from people');
    const report = await henri.encryption.rotate();

    expect(report.rotated).toBe(0);
    expect(report.failures.map((entry) => entry.code)).toContain(
      'HENRI_ENCRYPTION_KEY_UNKNOWN'
    );

    const after = await adapter.query('select notes from people');

    expect(after[0].notes).toBe(before[0].notes);
  });
});

describe('a value that was changed underneath', () => {
  let context;

  beforeAll(async () => {
    context = await store([KEY]);
    await context.Person.create({ badge: 'T-1', name: 'Tam', notes: 'true' });
  }, 60000);

  afterAll(async () => {
    await context.adapter.stop();
    await target.cleanup();
  });

  test('a changed byte does not verify, and says so differently', async () => {
    const { Person, adapter } = context;
    const [row] = await adapter.query('select id, notes from people');
    const changed = tampered(row.notes);

    await adapter.query(
      adapter.dialect.name === 'postgres'
        ? 'update people set notes = $1 where id = $2'
        : 'update people set notes = ? where id = ?',
      [changed, row.id]
    );

    await expect(Person.withDeleted().where({})).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_UNREADABLE' })
    );
  });

  test('a ciphertext moved from another field does not open either', async () => {
    const { Person, adapter } = context;
    const [row] = await adapter.query('select id, badge from people');

    // The badge is a valid envelope written by the same key, in the same
    // row: only the field it names differs, and the tag covers that
    await adapter.query(
      adapter.dialect.name === 'postgres'
        ? 'update people set notes = $1 where id = $2'
        : 'update people set notes = ? where id = ?',
      [row.badge, row.id]
    );

    await expect(Person.withDeleted().where({})).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_UNREADABLE' })
    );
  });
});

describe('a column that is still in the clear', () => {
  let context;

  beforeAll(async () => {
    context = await store([KEY]);

    const { adapter } = context;

    await context.Person.create({ badge: 'P-1', name: 'Old', notes: 'x' });
    // What an application that turns `encrypted` on over a full table has
    await adapter.query(
      adapter.dialect.name === 'postgres'
        ? "update people set notes = $1 where name = 'Old'"
        : "update people set notes = ? where name = 'Old'",
      ['written before the mark']
    );
  }, 60000);

  afterAll(async () => {
    await context.adapter.stop();
    await target.cleanup();
  });

  test('reading it is a failure of its own, not a silent pass', async () => {
    await expect(context.Person.withDeleted().where({})).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_PLAINTEXT' })
    );
  });

  test('readPlaintext lets the migration happen, and the rotation ends it', async () => {
    const { Person, adapter, henri } = context;

    henri.config.get = (key) =>
      key === 'encryption' ? { keys: [KEY], readPlaintext: true } : undefined;
    await henri.encryption.init();
    henri.model = { stores: { default: adapter } };

    expect((await Person.findOne({ badge: 'P-1' })).notes).toBe(
      'written before the mark'
    );
    expect((await henri.encryption.status()).plaintext).toBe(1);

    const report = await henri.encryption.rotate();

    expect(report.rotated).toBe(1);
    expect((await henri.encryption.status()).plaintext).toBe(0);

    // And once it is done, the permissive read is no longer needed
    henri.config.get = (key) =>
      key === 'encryption' ? { keys: [KEY] } : undefined;
    await henri.encryption.init();

    expect((await Person.findOne({ badge: 'P-1' })).notes).toBe(
      'written before the mark'
    );
  });
});
