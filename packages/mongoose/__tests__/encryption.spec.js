const { MongoMemoryServer } = require('mongodb-memory-server');
const Encryption = require('@usehenri/core/src/1.encryption');
const { generateKey } = require('@usehenri/core/src/base/encryption');
const Mongoose = require('../index');
const { normalizeModel } = require('../schema');

/**
 * Encrypted attributes on the Mongoose adapter.
 *
 * The envelope itself is core's and is tested there; this is the wiring:
 * that the collection holds ciphertext, that the document, `toObject()`,
 * `toJSON()` and a `lean()` query all hand back the string, that a
 * deterministic path can be looked up and a randomised one cannot, and that
 * a rotation moves every document without moving `updatedAt`.
 */

const KEY = generateKey();
const OTHER = generateKey();

let mongod;

const personModel = {
  globalId: 'Person',
  identity: 'person',
  name: 'people',
  options: { paranoid: true, timestamps: true },
  schema: {
    badge: {
      encrypted: { deterministic: true },
      type: 'string',
      unique: true,
    },
    name: { type: 'string' },
    notes: { encrypted: true, type: 'text' },
  },
};

/**
 * Builds a minimal henri stand-in carrying the real encryption module
 *
 * @param {Array<string>} keys The keys, the one that writes first
 * @param {object} [settings={}] Other configuration values
 * @returns {Promise<object>} The fake henri
 */
const fakeHenri = async (keys, settings = {}) => {
  const values = { encryption: { keys }, ...settings };
  const pen = {};

  ['error', 'fatal', 'info', 'warn'].forEach((level) => {
    pen[level] = () => undefined;
  });

  const henri = {
    _user: null,
    config: {
      get: (key) => values[key],
      has: (key) => typeof values[key] !== 'undefined',
      sourceOf: () => 'the test',
    },
    cwd: () => process.cwd(),
    isTest: true,
    pen,
    user: { encrypt: async (password) => `hashed:${password}` },
  };
  const encryption = new Encryption();

  encryption.henri = henri;
  henri.encryption = encryption;
  await encryption.init();

  return henri;
};

/**
 * An adapter with the Person model, on its own database
 *
 * @param {string} database The database name
 * @param {Array<string>} keys The keys
 * @param {object} [settings={}] Other configuration values
 * @returns {Promise<object>} `{ Person, adapter, henri }`
 */
const store = async (database, keys, settings = {}) => {
  const henri = await fakeHenri(keys, settings);
  const adapter = new Mongoose(
    'default',
    { url: mongod.getUri(database) },
    henri
  );
  const Person = adapter.addModel(personModel, 'user');

  await adapter.start();

  return { Person, adapter, henri };
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
}, 120000);

afterAll(async () => {
  if (mongod) {
    await mongod.stop();
  }
});

describe('the mark, before anything is stored', () => {
  test('an encrypted path is a String whatever the henri type said', () => {
    const { definition, encrypted } = normalizeModel(personModel.schema, {
      model: 'Person',
    });

    expect(encrypted).toEqual({
      badge: { deterministic: true },
      notes: { deterministic: false },
    });
    expect(definition.notes.type).toBe(String);
    expect(definition.badge.type).toBe(String);
    // The mark is henri's, not Mongoose's
    expect(definition.badge.encrypted).toBeUndefined();
  });

  test('trim and lowercase are dropped: they would break the tag', () => {
    const { definition } = normalizeModel(
      {
        code: {
          encrypted: { deterministic: true },
          lowercase: true,
          trim: true,
          type: 'string',
        },
      },
      { model: 'Person' }
    );

    expect(definition.code.trim).toBeUndefined();
    expect(definition.code.lowercase).toBeUndefined();
  });

  test('a type that is not text is refused', () => {
    expect(() =>
      normalizeModel(
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
        normalizeModel(
          { code: { encrypted: true, type: 'string', ...extra } },
          { model: 'Person' }
        )
      ).toThrow(
        expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
      );
    }
  });

  test('henri refuses to boot a model that encrypts without a key', async () => {
    const henri = await fakeHenri([]);
    const adapter = new Mongoose(
      'default',
      { url: mongod.getUri('encryption-nokey') },
      henri
    );

    expect(() => adapter.addModel(personModel, 'user')).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NO_KEY' })
    );
  });
});

describe('what the collection holds and what the model hands back', () => {
  let context;

  beforeAll(async () => {
    context = await store('encryption-basics', [KEY]);
  }, 60000);

  afterAll(() => context.adapter.stop());

  test('the field is ciphertext and the document is the string', async () => {
    const { Person } = context;
    const created = await Person.create({
      badge: 'B-1',
      name: 'Ada',
      notes: 'allergic to bees',
    });

    expect(created.notes).toBe('allergic to bees');
    expect(created.badge).toBe('B-1');

    // The driver collection: no middleware of this adapter's runs
    const raw = await Person.collection.findOne({ name: 'Ada' });

    expect(raw.notes).toMatch(/^henri:v1:r:[0-9a-f]{8}:/u);
    expect(raw.badge).toMatch(/^henri:v1:d:[0-9a-f]{8}:/u);
    expect(raw.notes).not.toContain('bees');

    const found = await Person.findByKey(created._id);

    expect(found.notes).toBe('allergic to bees');
    expect(found.toObject().notes).toBe('allergic to bees');
    expect(found.toJSON().badge).toBe('B-1');
  });

  test('a lean query hands back the string too', async () => {
    const { Person } = context;
    const lean = await Person.findOne({ badge: 'B-1' }).lean();

    expect(lean.notes).toBe('allergic to bees');
    expect(lean.badge).toBe('B-1');

    const many = await Person.find({ name: 'Ada' }).lean();

    expect(many[0].notes).toBe('allergic to bees');
  });

  test('the same plaintext is different bytes when randomised', async () => {
    const { Person } = context;

    await Person.create({ badge: 'B-same-1', name: 'One', notes: 'same' });
    await Person.insertMany([
      { badge: 'B-same-2', name: 'Two', notes: 'same' },
    ]);

    const rows = await Person.collection
      .find({ name: { $in: ['One', 'Two'] } })
      .toArray();

    expect(rows).toHaveLength(2);
    expect(rows[0].notes).not.toBe(rows[1].notes);
    // `insertMany` runs no document middleware: the hook is on the query
    expect(rows[1].notes).toMatch(/^henri:v1:r:/u);
    expect((await Person.findOne({ badge: 'B-same-2' })).notes).toBe('same');
  });

  test('a deterministic path is looked up, and stays unique', async () => {
    const { Person } = context;

    expect((await Person.findOne({ badge: 'B-1' })).name).toBe('Ada');
    expect(
      await Person.countDocuments({ badge: { $in: ['B-same-1', 'B-same-2'] } })
    ).toBe(2);
    await expect(
      Person.create({ badge: 'B-1', name: 'Impostor' })
    ).rejects.toThrow();
  });

  test('saving a document leaves the plaintext in it', async () => {
    const { Person } = context;
    const person = await Person.findOne({ badge: 'B-1' });

    person.notes = 'no longer allergic';
    await person.save();

    expect(person.notes).toBe('no longer allergic');
    expect((await Person.findOne({ badge: 'B-1' })).notes).toBe(
      'no longer allergic'
    );

    const raw = await Person.collection.findOne({ name: 'Ada' });

    expect(raw.notes).toMatch(/^henri:v1:r:/u);
  });

  test('an update through a query encrypts, and its filter is translated', async () => {
    const { Person } = context;

    await Person.updateOne({ badge: 'B-1' }, { $set: { notes: 'updated' } });

    const raw = await Person.collection.findOne({ name: 'Ada' });

    expect(raw.notes).toMatch(/^henri:v1:r:/u);
    expect((await Person.findOne({ badge: 'B-1' })).notes).toBe('updated');

    const returned = await Person.findOneAndUpdate(
      { badge: 'B-1' },
      { notes: 'again' },
      { new: true }
    );

    expect(returned.notes).toBe('again');
  });

  test('a soft deleted document stays readable', async () => {
    const { Person } = context;
    const person = await Person.create({
      badge: 'B-gone',
      name: 'Withdrawn',
      notes: 'still here',
    });

    await person.deleteOne();

    expect(await Person.findOne({ badge: 'B-gone' })).toBeNull();

    const hidden = await Person.findOne({ badge: 'B-gone' }).setOptions({
      withDeleted: true,
    });

    expect(hidden.notes).toBe('still here');
  });

  // The value a request chooses must never be the thing that decides
  // whether it is encrypted, or a request could choose not to be
  test('a plaintext that looks like an envelope is encrypted like any other', async () => {
    const { Person } = context;
    const wearing = 'henri:v1:r:deadbeef:Tm90QW5FbnZlbG9wZQ';
    const created = await Person.create({
      badge: 'B-sneaky',
      name: 'Sneaky',
      notes: wearing,
    });

    expect(created.notes).toBe(wearing);

    const raw = await Person.collection.findOne({ name: 'Sneaky' });

    expect(raw.notes).not.toBe(wearing);
    expect(raw.notes).toMatch(/^henri:v1:r:[0-9a-f]{8}:/u);
    expect((await Person.findByKey(created._id)).notes).toBe(wearing);

    // ... and through a query update, which runs no document middleware
    await Person.updateOne({ badge: 'B-sneaky' }, { $set: { notes: wearing } });

    const again = await Person.collection.findOne({ name: 'Sneaky' });

    expect(again.notes).not.toBe(wearing);
    expect((await Person.findOne({ badge: 'B-sneaky' })).notes).toBe(wearing);
  });

  test('a filter the caller holds is never rewritten under them', async () => {
    const { Person } = context;
    const filter = { badge: 'B-1' };

    expect(await Person.find(filter)).toHaveLength(1);
    expect(filter).toEqual({ badge: 'B-1' });
    expect(await Person.find(filter)).toHaveLength(1);

    const nested = { $or: [{ badge: 'B-1' }, { badge: 'B-same-1' }] };

    expect(await Person.find(nested)).toHaveLength(2);
    expect(await Person.find(nested)).toHaveLength(2);
    expect(nested.$or[0]).toEqual({ badge: 'B-1' });
  });
});

describe('what cannot be asked of a path that is ciphertext', () => {
  let context;

  beforeAll(async () => {
    context = await store('encryption-queries', [KEY]);
    await context.Person.create({ badge: 'Q-1', name: 'Query', notes: 'x' });
  }, 60000);

  afterAll(() => context.adapter.stop());

  test('a randomised path cannot be looked up by value', async () => {
    await expect(context.Person.findOne({ notes: 'x' })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
    await expect(context.Person.countDocuments({ notes: 'x' })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('an encrypted path cannot be sorted by', async () => {
    await expect(context.Person.find({}).sort({ badge: 1 })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
    await expect(context.Person.find({}).sort('-badge')).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('an operator that is not an equality is refused', async () => {
    await expect(
      context.Person.find({ badge: { $regex: '^Q-' } })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
    await expect(context.Person.find({ badge: { $gt: 'A' } })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('bulkWrite is refused rather than writing the clear', async () => {
    await expect(
      context.Person.bulkWrite([
        { insertOne: { document: { badge: 'Q-9', notes: 'sneaky' } } },
      ])
    ).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
    expect(await context.Person.collection.countDocuments({})).toBe(1);
  });

  test('an $or branch is translated, not skipped', async () => {
    const found = await context.Person.find({
      $or: [{ badge: 'Q-1' }, { badge: 'Q-2' }],
    });

    expect(found.map((row) => row.name)).toEqual(['Query']);
  });
});

describe('a rotation', () => {
  let context;

  beforeAll(async () => {
    context = await store('encryption-rotation', [KEY]);

    for (const index of [1, 2, 3]) {
      await context.Person.create({
        badge: `R-${index}`,
        name: `Row ${index}`,
        notes: `secret ${index}`,
      });
    }

    const gone = await context.Person.findOne({ badge: 'R-3' });

    await gone.deleteOne();
    context.henri.model = { stores: { default: context.adapter } };
  }, 60000);

  afterAll(() => context.adapter.stop());

  /**
   * Points the fake henri's configuration at a set of keys and reloads
   *
   * @param {Array<string>} keys The keys
   * @returns {Promise<void>} Resolves when loaded
   */
  const rekey = async (keys) => {
    context.henri.config.get = (key) =>
      key === 'encryption' ? { keys } : undefined;
    await context.henri.encryption.init();
  };

  test('a new key in front keeps every old document readable', async () => {
    await rekey([OTHER, KEY]);

    expect((await context.Person.findOne({ badge: 'R-1' })).notes).toBe(
      'secret 1'
    );

    await context.Person.create({
      badge: 'R-4',
      name: 'Row 4',
      notes: 'secret 4',
    });

    const both = await context.Person.find({ badge: { $in: ['R-1', 'R-4'] } });

    expect(both.map((row) => row.notes).sort()).toEqual([
      'secret 1',
      'secret 4',
    ]);
  });

  test('the status counts by key id, soft deleted documents included', async () => {
    const report = await context.henri.encryption.status();
    const notes = report.fields.find((entry) => entry.field === 'notes');

    expect(notes.rows).toBe(4);
    expect(notes.current).toBe(1);
    expect(notes.stale).toBe(3);
    expect(report.ok).toBe(false);
  });

  test('the rotation rewrites everything without touching updatedAt', async () => {
    const before = await context.Person.collection
      .find({})
      .sort({ _id: 1 })
      .toArray();
    const report = await context.henri.encryption.rotate();

    expect(report.failures).toEqual([]);
    expect(report.rotated).toBe(6);
    expect((await context.henri.encryption.status()).ok).toBe(true);

    const now = await context.Person.collection
      .find({})
      .sort({ _id: 1 })
      .toArray();

    expect(now.map((row) => String(row.updatedAt))).toEqual(
      before.map((row) => String(row.updatedAt))
    );
    // And the ciphertext did change
    expect(now[0].notes).not.toBe(before[0].notes);
  });

  test('the old key may now be dropped, and everything still reads', async () => {
    await rekey([OTHER]);

    const rows = await context.Person.find({}).setOptions({
      withDeleted: true,
    });

    expect(rows.map((row) => row.notes).sort()).toEqual([
      'secret 1',
      'secret 2',
      'secret 3',
      'secret 4',
    ]);
  });
});

describe('a key that is not here', () => {
  let context;

  beforeAll(async () => {
    context = await store('encryption-lost', [KEY]);
    await context.Person.create({ badge: 'L-1', name: 'Lost', notes: 'gone' });

    context.henri.model = { stores: { default: context.adapter } };
    context.henri.config.get = (key) =>
      key === 'encryption' ? { keys: [OTHER] } : undefined;
    await context.henri.encryption.init();
  }, 60000);

  afterAll(() => context.adapter.stop());

  test('reading says which key wrote it, and never answers null', async () => {
    await expect(context.Person.findOne({ name: 'Lost' })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_KEY_UNKNOWN' })
    );
  });

  test('tolerate() reads null and says what it could not read', async () => {
    const { failures, value } = await context.henri.encryption.tolerate(() =>
      context.Person.findOne({ name: 'Lost' })
    );

    expect(value.notes).toBeNull();
    expect(failures.map((entry) => entry.code)).toContain(
      'HENRI_ENCRYPTION_KEY_UNKNOWN'
    );
  });

  test('a rotation counts the document and never overwrites it', async () => {
    const before = await context.Person.collection.findOne({});
    const report = await context.henri.encryption.rotate();

    expect(report.rotated).toBe(0);
    expect(report.failures.map((entry) => entry.code)).toContain(
      'HENRI_ENCRYPTION_KEY_UNKNOWN'
    );
    expect((await context.Person.collection.findOne({})).notes).toBe(
      before.notes
    );
  });
});

describe('a column that is still in the clear', () => {
  let context;

  beforeAll(async () => {
    context = await store('encryption-backfill', [KEY]);
    await context.Person.create({ badge: 'P-1', name: 'Old', notes: 'x' });
    await context.Person.collection.updateOne(
      { name: 'Old' },
      { $set: { notes: 'written before the mark' } }
    );
    context.henri.model = { stores: { default: context.adapter } };
  }, 60000);

  afterAll(() => context.adapter.stop());

  test('reading it is a failure of its own, not a silent pass', async () => {
    await expect(context.Person.findOne({ name: 'Old' })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_PLAINTEXT' })
    );
  });

  test('readPlaintext lets the backfill happen, and the rotation ends it', async () => {
    const { Person, henri } = context;

    henri.config.get = (key) =>
      key === 'encryption' ? { keys: [KEY], readPlaintext: true } : undefined;
    await henri.encryption.init();

    expect((await Person.findOne({ name: 'Old' })).notes).toBe(
      'written before the mark'
    );
    expect((await henri.encryption.status()).plaintext).toBe(1);
    expect((await henri.encryption.rotate()).rotated).toBe(1);
    expect((await henri.encryption.status()).plaintext).toBe(0);

    henri.config.get = (key) =>
      key === 'encryption' ? { keys: [KEY] } : undefined;
    await henri.encryption.init();

    expect((await Person.findOne({ name: 'Old' })).notes).toBe(
      'written before the mark'
    );
  });
});
