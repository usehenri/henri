const { Op } = require('sequelize');
const { buildWith, generateKey, target, withKeys } = require('./helpers');
const { normalizeSchema } = require('../schema');

/**
 * Encrypted attributes on the Sequelize adapter.
 *
 * The envelope itself is core's and is tested there; this is the wiring:
 * that the column holds ciphertext, that the attribute hands back the
 * string wherever the instance came from (an include included), that a
 * deterministic field can be looked up and a randomised one cannot, and
 * that a rotation moves every row without moving `updatedAt`.
 *
 * It runs on sqlite offline and on the PostgreSQL or MySQL server of
 * `HENRI_TEST_POSTGRES_URL` / `HENRI_TEST_MYSQL_URL` when one is set.
 */

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
      type: 'string',
      unique: true,
    },
    name: { type: 'string' },
    notes: { encrypted: true, type: 'text' },
  },
};

const noteModel = {
  globalId: 'Note',
  identity: 'note',
  name: 'notes_table',
  schema: {
    body: { type: 'string' },
    personId: { type: 'integer' },
  },
};

/**
 * An adapter with the Person model, on the target database
 *
 * @param {Array<string>} keys The keys, the one that writes first
 * @param {object} [settings={}] Other configuration values
 * @returns {Promise<object>} `{ Note, Person, adapter, henri }`
 */
const store = async (keys, settings = {}) => {
  const henri = await withKeys(keys, settings);
  const { adapter } = buildWith(henri);
  const Person = adapter.addModel(personModel, 'user');
  const Note = adapter.addModel(noteModel, 'user');

  Person.hasMany(Note, { as: 'remarks', foreignKey: 'personId' });
  Note.belongsTo(Person, { as: 'person', foreignKey: 'personId' });

  await adapter.start();

  return { Note, Person, adapter, henri };
};

describe('the mark, before anything is stored', () => {
  test('a randomised field becomes TEXT and a deterministic one a bounded STRING', () => {
    const { attributes, encrypted } = normalizeSchema(personModel.schema, {
      dialect: 'sqlite',
      model: 'Person',
    });

    expect(encrypted).toEqual({
      badge: { deterministic: true },
      notes: { deterministic: false },
    });
    expect(attributes.notes.type.key).toBe('TEXT');
    expect(attributes.badge.type.key).toBe('STRING');
    expect(attributes.badge.type.options.length).toBe(700);
    // The attribute never carries the mark itself
    expect(attributes.badge.encrypted).toBeUndefined();
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

  test('the fields henri owns on the user model cannot be encrypted', () => {
    for (const field of ['email', 'password', 'roles']) {
      expect(() =>
        normalizeSchema(
          { [field]: { encrypted: { deterministic: true }, type: 'string' } },
          { isUser: true, model: 'User' }
        )
      ).toThrow(
        expect.objectContaining({ code: 'HENRI_ENCRYPTION_INVALID_MARK' })
      );
    }

    // The same field on any other model is fine
    expect(() =>
      normalizeSchema(
        { email: { encrypted: { deterministic: true }, type: 'string' } },
        { isUser: false, model: 'Invite' }
      )
    ).not.toThrow();
  });

  test('henri refuses to boot a model that encrypts without a key', async () => {
    const henri = await withKeys([]);
    const { adapter } = buildWith(henri);

    expect(() => adapter.addModel(personModel, 'user')).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NO_KEY' })
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
    const { Person } = context;
    const created = await Person.create({
      badge: 'B-1',
      name: 'Ada',
      notes: 'allergic to bees',
    });

    expect(created.notes).toBe('allergic to bees');
    expect(created.badge).toBe('B-1');

    // `raw: true` bypasses the getters: what the column holds
    const [row] = await Person.findAll({
      raw: true,
      where: { name: 'Ada' },
    });

    expect(row.notes).toMatch(/^henri:v1:r:[0-9a-f]{8}:/u);
    expect(row.badge).toMatch(/^henri:v1:d:[0-9a-f]{8}:/u);
    expect(row.notes).not.toContain('bees');

    const found = await Person.findByKey(created.id);

    expect(found.notes).toBe('allergic to bees');
    expect(found.toJSON().notes).toBe('allergic to bees');
    expect(found.get({ plain: true }).badge).toBe('B-1');
  });

  test('a value assigned and not yet saved reads back as it was assigned', async () => {
    const { Person } = context;
    const person = await Person.findOne({ where: { badge: 'B-1' } });

    person.notes = 'not saved yet';

    expect(person.notes).toBe('not saved yet');

    await person.save();

    expect(person.notes).toBe('not saved yet');
    expect((await Person.findByKey(person.id)).notes).toBe('not saved yet');
  });

  test('the same plaintext is different bytes when randomised', async () => {
    const { Person } = context;

    await Person.bulkCreate([
      { badge: 'B-same-1', name: 'One', notes: 'same' },
      { badge: 'B-same-2', name: 'Two', notes: 'same' },
    ]);

    const rows = await Person.findAll({
      raw: true,
      where: { name: { [Op.in]: ['One', 'Two'] } },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].notes).not.toBe(rows[1].notes);
    expect((await Person.findOne({ where: { badge: 'B-same-1' } })).notes).toBe(
      'same'
    );
  });

  test('a deterministic field is looked up, and stays unique', async () => {
    const { Person } = context;

    expect((await Person.findOne({ where: { badge: 'B-1' } })).name).toBe(
      'Ada'
    );
    expect(
      await Person.count({ where: { badge: ['B-same-1', 'B-same-2'] } })
    ).toBe(2);
    await expect(
      Person.create({ badge: 'B-1', name: 'Impostor' })
    ).rejects.toThrow();
  });

  test('an eager loaded model decrypts too', async () => {
    const { Note, Person } = context;
    const person = await Person.findOne({ where: { badge: 'B-1' } });

    await Note.create({ body: 'a note', personId: person.id });

    // The hole an afterFind hook would leave: the included instance is
    // built by the parent query and its own hooks never fire
    const [note] = await Note.findAll({
      include: [{ as: 'person', model: Person }],
    });

    expect(note.person.notes).toBe('not saved yet');
    expect(note.person.badge).toBe('B-1');

    const [owner] = await Person.findAll({
      include: [{ as: 'remarks', model: Note }],
      where: { badge: 'B-1' },
    });

    expect(owner.notes).toBe('not saved yet');
    expect(owner.get('notes')).toBe('not saved yet');
  });

  test('a where on an included encrypted column is translated too', async () => {
    const { Note, Person } = context;
    const [note] = await Note.findAll({
      include: [{ as: 'person', model: Person, where: { badge: 'B-1' } }],
    });

    expect(note).toBeTruthy();
    expect(note.person.badge).toBe('B-1');
  });

  test('a mass update encrypts, and its where is translated', async () => {
    const { Person } = context;

    await Person.update({ notes: 'bulk' }, { where: { badge: 'B-same-1' } });

    const [row] = await Person.findAll({
      raw: true,
      where: { name: 'One' },
    });

    expect(row.notes).toMatch(/^henri:v1:r:/u);
    expect((await Person.findOne({ where: { name: 'One' } })).notes).toBe(
      'bulk'
    );
  });

  test('a soft deleted row stays readable', async () => {
    const { Person } = context;
    const person = await Person.create({
      badge: 'B-gone',
      name: 'Withdrawn',
      notes: 'still here',
    });

    await person.destroy();

    expect(await Person.findOne({ where: { badge: 'B-gone' } })).toBeNull();

    const hidden = await Person.findOne({
      paranoid: false,
      where: { badge: 'B-gone' },
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

    const [row] = await Person.findAll({
      raw: true,
      where: { name: 'Sneaky' },
    });

    expect(row.notes).not.toBe(wearing);
    expect(row.notes).toMatch(/^henri:v1:r:[0-9a-f]{8}:/u);
    expect((await Person.findByKey(created.id)).notes).toBe(wearing);

    // ... through a mass update too, which is the path a controller that
    // hands req.permit() straight to Model.update() takes
    await Person.update({ notes: wearing }, { where: { name: 'Sneaky' } });

    const [again] = await Person.findAll({
      raw: true,
      where: { name: 'Sneaky' },
    });

    expect(again.notes).not.toBe(wearing);
    expect((await Person.findByKey(created.id)).notes).toBe(wearing);
  });

  test('a bulk create with individualHooks encrypts once, not twice', async () => {
    const { Person } = context;

    await Person.bulkCreate(
      [{ badge: 'B-bulk', name: 'Bulk', notes: 'once' }],
      { individualHooks: true }
    );

    expect((await Person.findOne({ where: { badge: 'B-bulk' } })).notes).toBe(
      'once'
    );
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
    await expect(
      context.Person.findOne({ where: { notes: 'x' } })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('a randomised field cannot be counted or destroyed by value', async () => {
    await expect(
      context.Person.count({ where: { notes: 'x' } })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
    await expect(
      context.Person.destroy({ where: { notes: 'x' } })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('an encrypted field cannot be ordered by', async () => {
    await expect(context.Person.findAll({ order: ['badge'] })).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
    await expect(
      context.Person.findAll({ order: [['badge', 'DESC']] })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('an operator that is not an equality is refused', async () => {
    await expect(
      context.Person.findAll({ where: { badge: { [Op.like]: 'Q-%' } } })
    ).rejects.toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_NOT_QUERYABLE' })
    );
  });

  test('a negation still works on a deterministic field', async () => {
    const { Person } = context;

    await Person.create({ badge: 'Q-2', name: 'Other' });

    const rows = await Person.findAll({
      where: { badge: { [Op.ne]: 'Q-1' } },
    });

    expect(rows.map((row) => row.name)).toEqual(['Other']);
  });

  test('a refusal is a refusal, never an empty result', async () => {
    await expect(
      context.Person.findAll({ where: { notes: 'x' } })
    ).rejects.toThrow();
    expect(
      await context.Person.findAll({ where: { badge: 'Q-1' } })
    ).toHaveLength(1);
  });

  test('the where the caller holds is never rewritten under them', async () => {
    const { Person } = context;
    // The same object twice: translating it in place would leave the
    // caller holding envelopes, and the second call would encrypt those
    // again and answer nothing
    const where = { badge: 'Q-1' };

    expect(await Person.findAll({ where })).toHaveLength(1);
    expect(where).toEqual({ badge: 'Q-1' });
    expect(await Person.findAll({ where })).toHaveLength(1);

    const nested = { [Op.or]: [{ badge: 'Q-1' }, { badge: 'Q-2' }] };

    expect(await Person.findAll({ where: nested })).toHaveLength(2);
    expect(await Person.findAll({ where: nested })).toHaveLength(2);
    expect(nested[Op.or][0]).toEqual({ badge: 'Q-1' });
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

    const gone = await context.Person.findOne({ where: { badge: 'R-3' } });

    await gone.destroy();

    context.henri.model = { stores: { default: context.adapter } };
  }, 60000);

  afterAll(async () => {
    await context.adapter.stop();
    await target.cleanup();
  });

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

  test('a new key in front keeps every old row readable and findable', async () => {
    await rekey([OTHER, KEY]);

    expect(
      (await context.Person.findOne({ where: { badge: 'R-1' } })).notes
    ).toBe('secret 1');

    await context.Person.create({
      badge: 'R-4',
      name: 'Row 4',
      notes: 'secret 4',
    });

    const both = await context.Person.findAll({
      where: { badge: ['R-1', 'R-4'] },
    });

    expect(both.map((row) => row.notes).sort()).toEqual([
      'secret 1',
      'secret 4',
    ]);
  });

  test('the status counts by key id, soft deleted rows included', async () => {
    const report = await context.henri.encryption.status();
    const notes = report.fields.find((entry) => entry.field === 'notes');

    expect(notes.rows).toBe(4);
    expect(notes.current).toBe(1);
    expect(notes.stale).toBe(3);
    expect(report.ok).toBe(false);
  });

  test('the rotation rewrites every row without touching updatedAt', async () => {
    const before = await context.Person.findAll({
      attributes: ['id', 'updatedAt'],
      order: [['id', 'ASC']],
      paranoid: false,
      raw: true,
    });
    const report = await context.henri.encryption.rotate();

    expect(report.failures).toEqual([]);
    expect(report.rotated).toBe(6);

    const after = await context.henri.encryption.status();

    expect(after.ok).toBe(true);

    const now = await context.Person.findAll({
      attributes: ['id', 'updatedAt'],
      order: [['id', 'ASC']],
      paranoid: false,
      raw: true,
    });

    expect(now.map((row) => String(row.updatedAt))).toEqual(
      before.map((row) => String(row.updatedAt))
    );
  });

  test('the old key may now be dropped, and everything still reads', async () => {
    await rekey([OTHER]);

    const rows = await context.Person.findAll({ paranoid: false });

    expect(rows.map((row) => row.notes).sort()).toEqual([
      'secret 1',
      'secret 2',
      'secret 3',
      'secret 4',
    ]);
    expect(
      (await context.Person.findOne({ where: { badge: 'R-2' } })).name
    ).toBe('Row 2');
  });
});

describe('a key that is not here', () => {
  let context;

  beforeAll(async () => {
    context = await store([KEY]);
    await context.Person.create({ badge: 'L-1', name: 'Lost', notes: 'gone' });

    context.henri.model = { stores: { default: context.adapter } };
    context.henri.config.get = (key) =>
      key === 'encryption' ? { keys: [OTHER] } : undefined;
    await context.henri.encryption.init();
  }, 60000);

  afterAll(async () => {
    await context.adapter.stop();
    await target.cleanup();
  });

  test('reading says which key wrote it, and never answers null', async () => {
    const person = await context.Person.findOne({ where: { name: 'Lost' } });

    expect(() => person.notes).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_KEY_UNKNOWN' })
    );
    expect(() => person.toJSON()).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_KEY_UNKNOWN' })
    );
  });

  test('tolerate() reads null and says what it could not read', async () => {
    const { failures, value } = await context.henri.encryption.tolerate(
      async () => {
        const person = await context.Person.findOne({
          where: { name: 'Lost' },
        });

        return person.toJSON();
      }
    );

    expect(value.notes).toBeNull();
    expect(failures.map((entry) => entry.code)).toContain(
      'HENRI_ENCRYPTION_KEY_UNKNOWN'
    );
  });

  test('a rotation counts the row and never overwrites it', async () => {
    const before = await context.Person.findAll({ raw: true });
    const report = await context.henri.encryption.rotate();

    expect(report.rotated).toBe(0);
    expect(report.failures.map((entry) => entry.code)).toContain(
      'HENRI_ENCRYPTION_KEY_UNKNOWN'
    );

    const after = await context.Person.findAll({ raw: true });

    expect(after[0].notes).toBe(before[0].notes);
  });
});

describe('a column that is still in the clear', () => {
  let context;

  beforeAll(async () => {
    context = await store([KEY]);
    await context.Person.create({ badge: 'P-1', name: 'Old', notes: 'x' });

    // What an application that turns `encrypted` on over a full table has
    await context.adapter.query(
      "UPDATE people SET notes = 'written before the mark' WHERE name = 'Old'"
    );

    context.henri.model = { stores: { default: context.adapter } };
  }, 60000);

  afterAll(async () => {
    await context.adapter.stop();
    await target.cleanup();
  });

  test('reading it is a failure of its own, not a silent pass', async () => {
    const person = await context.Person.findOne({ where: { name: 'Old' } });

    expect(() => person.notes).toThrow(
      expect.objectContaining({ code: 'HENRI_ENCRYPTION_PLAINTEXT' })
    );
  });

  test('readPlaintext lets the backfill happen, and the rotation ends it', async () => {
    const { Person, henri } = context;

    henri.config.get = (key) =>
      key === 'encryption' ? { keys: [KEY], readPlaintext: true } : undefined;
    await henri.encryption.init();

    expect((await Person.findOne({ where: { name: 'Old' } })).notes).toBe(
      'written before the mark'
    );
    expect((await henri.encryption.status()).plaintext).toBe(1);

    expect((await henri.encryption.rotate()).rotated).toBe(1);
    expect((await henri.encryption.status()).plaintext).toBe(0);

    henri.config.get = (key) =>
      key === 'encryption' ? { keys: [KEY] } : undefined;
    await henri.encryption.init();

    expect((await Person.findOne({ where: { name: 'Old' } })).notes).toBe(
      'written before the mark'
    );
  });
});
