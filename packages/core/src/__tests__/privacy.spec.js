/* global Memo, User */
const fs = require('fs');
const path = require('path');
const Henri = require('../henri');
// The SQL adapters come from the workspace: core does not depend on them,
// the suite only needs a sqlite-backed store of each to run the export and
// the erasure against a real Sequelize and a real Drizzle model
const Sql = require('../../../sequelize');
const Drizzle = require('../../../drizzle');

const {
  fieldsOf,
  linkOf,
  mapOf,
  markOf,
  privacyConfig,
  stripPersonal,
} = require('../base/privacy');
const { sendable } = require('../base/hateoas');
const {
  anonymousValue,
  digestOf,
  erasedValues,
  eraseOf,
  exportOf,
  kindOf,
  planOf,
} = require('../base/erasure');

/** A model file the way core hands one to an adapter */
const model = (globalId, schema, options = {}) => ({
  globalId,
  identity: globalId.toLowerCase(),
  options,
  schema,
});

describe('the mark (no application)', () => {
  test('a field says it is personal, and henri fills in the rest', () => {
    expect(markOf('User', 'name', { personal: true, type: 'string' })).toEqual({
      erase: 'clear',
      export: true,
      expose: true,
      // The shape of the column, so that what an erasure writes fits it
      match: null,
      maxLength: null,
      minLength: null,
      required: false,
      type: 'string',
      unique: false,
    });

    expect(
      markOf('Review', 'comment', {
        maxLength: 2000,
        minLength: 10,
        personal: true,
        type: 'text',
      })
    ).toMatchObject({ maxLength: 2000, minLength: 10 });
  });

  test('a column that cannot hold null is anonymized, not cleared', () => {
    expect(
      markOf('User', 'email', {
        personal: true,
        required: true,
        type: 'string',
        unique: true,
      })
    ).toMatchObject({ erase: 'anonymize' });
    expect(
      markOf('Invoice', 'amount', {
        personal: true,
        required: true,
        type: 'number',
      })
    ).toMatchObject({ erase: 'anonymize' });
  });

  test('the object form says more, and false is not a mark', () => {
    expect(
      markOf('User', 'phone', {
        personal: { erase: 'retain', export: false, expose: false },
        type: 'string',
      })
    ).toMatchObject({ erase: 'retain', export: false, expose: false });
    expect(
      markOf('User', 'age', { personal: false, type: 'integer' })
    ).toBeNull();
    expect(markOf('User', 'age', { type: 'integer' })).toBeNull();
    expect(markOf('User', 'age', 'integer')).toBeNull();
  });

  test('config.privacy.expose is the default of every mark', () => {
    expect(
      markOf(
        'User',
        'name',
        { personal: true, type: 'string' },
        { expose: false }
      )
    ).toMatchObject({ expose: false });
    // A field that says so out loud still leaves the server
    expect(
      markOf(
        'User',
        'name',
        { personal: { expose: true }, type: 'string' },
        { expose: false }
      )
    ).toMatchObject({ expose: true });
  });

  test('a mark henri cannot read fails the boot, naming the field', () => {
    expect(() =>
      markOf('User', 'name', { personal: 'yes', type: 'string' })
    ).toThrow(/User.name: 'personal' must be true, false or an object/u);
    expect(() =>
      markOf('User', 'name', { personal: { erase: 'shred' }, type: 'string' })
    ).toThrow(/must be one of anonymize, clear, retain/u);

    expect(() =>
      markOf('User', 'name', { personal: 42, type: 'string' })
    ).toThrow(expect.objectContaining({ code: 'HENRI_PRIVACY_INVALID_MARK' }));
  });

  test('only the marked fields are collected, and only at the top level', () => {
    expect(
      Object.keys(
        fieldsOf(
          model('User', {
            address: { city: { personal: true, type: 'string' } },
            name: { personal: true, type: 'string' },
            plan: { type: 'string' },
          })
        )
      )
    ).toEqual(['name']);
  });

  test('config.privacy carries its defaults', () => {
    expect(privacyConfig(null)).toEqual({
      expose: true,
      onErase: 'anonymize',
      receipts: 'privacy',
    });

    const config = {
      get: () => ({ expose: false, onErase: 'delete', receipts: false }),
      has: (key) => key === 'privacy',
    };

    expect(privacyConfig(config)).toEqual({
      expose: false,
      onErase: 'delete',
      receipts: false,
    });
  });
});

describe('the link to the person (no application)', () => {
  test('a reference to the subject model is one', () => {
    expect(
      linkOf(
        model('Proposal', {
          speakerId: {
            references: { model: 'User' },
            required: true,
            type: 'integer',
          },
        }),
        'User'
      )
    ).toEqual({
      declared: false,
      field: 'speakerId',
      matches: 'id',
      required: true,
    });
  });

  test("Mongoose's ref is one too", () => {
    expect(
      linkOf(
        model('Note', { author: { ref: 'User', type: 'ObjectId' } }),
        'User'
      )
    ).toMatchObject({ declared: false, field: 'author' });
  });

  test('a belongsTo association is one, when the schema says nothing', () => {
    const orm = {
      associations: [
        {
          as: 'owner',
          foreignKey: 'ownerId',
          kind: 'belongsTo',
          target: 'User',
        },
      ],
    };

    expect(linkOf(model('Memo', { body: 'text' }), 'User', orm)).toMatchObject({
      declared: false,
      field: 'ownerId',
    });

    // Sequelize spells the same thing differently
    expect(
      linkOf(model('Memo', { body: 'text' }), 'User', {
        associations: {
          owner: {
            associationType: 'BelongsTo',
            foreignKey: 'ownerId',
            target: { name: 'User' },
          },
        },
      })
    ).toMatchObject({ field: 'ownerId' });
  });

  test('the model can say it itself, by key or by value', () => {
    expect(
      linkOf(
        model(
          'Memo',
          { ownerId: { type: 'string' } },
          { personal: { subject: 'ownerId' } }
        ),
        'User'
      )
    ).toEqual({
      declared: true,
      field: 'ownerId',
      matches: 'id',
      required: false,
    });

    expect(
      linkOf(
        model(
          'Signup',
          { email: { personal: true, type: 'string' } },
          { personal: { subject: { field: 'email', matches: 'email' } } }
        ),
        'User'
      )
    ).toMatchObject({ field: 'email', matches: 'email' });

    // And it can say there is none
    expect(
      linkOf(
        model(
          'Metric',
          { userId: { references: { model: 'User' }, type: 'integer' } },
          { personal: { subject: false } }
        ),
        'User'
      )
    ).toBeNull();
  });
});

describe('the map (no application)', () => {
  const models = [
    model('User', {
      gender: { personal: { expose: false }, type: 'string' },
      name: { personal: true, type: 'string' },
    }),
    model('Proposal', {
      speakerId: {
        references: { model: 'User' },
        required: true,
        type: 'integer',
      },
      title: { type: 'string' },
    }),
    model('Artwork', { title: { type: 'string' } }),
  ];

  test('holds the models that are personal, point at a person, or are one', () => {
    const map = mapOf(models, { subject: 'User' });

    expect(map.entries.map((entry) => entry.name)).toEqual([
      'User',
      'Proposal',
    ]);
    // The user model carries the two fields henri added to it
    expect(Object.keys(map.subject.fields).sort()).toEqual([
      'email',
      'gender',
      'name',
      'password',
    ]);
    expect([...map.keys].sort()).toEqual([
      'email',
      'gender',
      'name',
      'password',
    ]);
    expect([...map.private].sort()).toEqual(['gender', 'password']);
  });

  test('an application with no user model still marks its fields', () => {
    const map = mapOf(models, { subject: null });

    expect(map.subject).toBeNull();
    expect(map.entries.map((entry) => entry.name)).toEqual(['User']);
  });
});

describe('what leaves the server (no application)', () => {
  test('strips the private names at every depth, and nothing else', () => {
    const names = new Set(['gender']);
    const payload = {
      user: { gender: 'x', name: 'Ada' },
      users: [{ gender: 'y', name: 'Grace' }],
    };

    expect(stripPersonal(payload, names)).toEqual({
      user: { name: 'Ada' },
      users: [{ name: 'Grace' }],
    });
    // The original is untouched
    expect(payload.user.gender).toBe('x');
  });

  test('an include puts one back, and an empty set copies nothing', () => {
    const names = new Set(['gender']);
    const value = { gender: 'x' };

    expect(stripPersonal(value, names, ['gender'])).toEqual({ gender: 'x' });
    expect(stripPersonal(value, new Set())).toBe(value);
  });

  test('survives a cycle and leaves dates alone', () => {
    const names = new Set(['gender']);
    const at = new Date();
    const record = { at, gender: 'x' };

    record.self = record;

    const copy = stripPersonal(record, names);

    expect(copy.self).toBe(copy);
    expect(copy.at).toBe(at);
    expect(copy.gender).toBeUndefined();
  });
});

describe('the values an erasure writes (no application)', () => {
  test('a value that has to keep its shape keeps it', () => {
    const mark = (extra) => ({ erase: 'anonymize', type: 'string', ...extra });

    expect(anonymousValue('email', mark({ unique: true }), 'abc')).toBe(
      'erased-abc@erased.invalid'
    );
    expect(anonymousValue('slug', mark({ unique: true }), 'abc')).toBe(
      'erased-abc'
    );
    expect(anonymousValue('name', mark(), 'abc')).toBe('[erased]');
    expect(anonymousValue('age', mark({ type: 'integer' }), 'abc')).toBe(0);
    expect(anonymousValue('optIn', mark({ type: 'boolean' }), 'abc')).toBe(
      false
    );
    expect(anonymousValue('bornOn', mark({ type: 'date' }), 'abc')).toBeNull();
    expect(anonymousValue('password', mark(), 'abc')).toHaveLength(64);
  });

  test('a clear on a column that cannot hold null is a refusal', () => {
    const entry = {
      fields: {
        email: { erase: 'clear', required: true, type: 'string' },
        note: { erase: 'retain', type: 'text' },
      },
      name: 'User',
    };
    const { problems, values } = erasedValues(entry, 'abc');

    expect(values).toEqual({});
    expect(problems).toMatchObject([{ problem: 'field-not-nullable' }]);
  });

  test('the digest names the person without holding them', () => {
    const one = digestOf({ email: 'ada@example.com', id: 1 }, 'User', 'secret');

    expect(one).toHaveLength(64);
    expect(one).not.toContain('ada');
    expect(
      digestOf({ email: 'ada@example.com', id: 1 }, 'User', 'secret')
    ).toBe(one);
    expect(
      digestOf({ email: 'ada@example.com', id: 1 }, 'User', 'other')
    ).not.toBe(one);
  });
});

describe('privacy (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;

  /**
   * A user with two memos
   *
   * @param {string} email The address
   * @returns {Promise<object>} The user
   */
  const person = async (email) => {
    const user = await User.create({
      age: 36,
      email,
      gender: 'f',
      name: 'Ada Lovelace',
      password: 'difference-engine-1842',
    });
    const owner = String(user._id);

    await Memo.create({
      body: 'the notes of a person',
      ownerId: owner,
      title: 'One',
    });
    await Memo.create({
      body: 'and their second one',
      ownerId: owner,
      title: 'Two',
    });

    return user;
  };

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

  test('the map is what the models said', () => {
    const described = henri.privacy.describe();

    expect(described.subject).toBe('User');
    expect(described.models.map((entry) => entry.model).sort()).toEqual([
      'Memo',
      'User',
    ]);
    expect([...henri.privacy.keys].sort()).toEqual([
      'age',
      'body',
      'email',
      'gender',
      'name',
      'password',
    ]);
    expect([...henri.privacy.private].sort()).toEqual(['gender', 'password']);
    expect(
      described.models.find((entry) => entry.model === 'Memo')
    ).toMatchObject({
      link: { declared: true, field: 'ownerId' },
      onErase: 'delete',
    });
  });

  test('pen masks a personal field by name, and only that name', () => {
    expect(
      henri.pen.redact({ filename: 'notes.txt', name: 'Ada', plan: 'free' })
    ).toEqual({ filename: 'notes.txt', name: '[FILTERED]', plan: 'free' });
  });

  test('a field that never leaves the server never leaves the server', async () => {
    const user = await person('leaves@usehenri.io');

    expect(henri.user.publicUser(user)).toEqual({
      email: 'leaves@usehenri.io',
      externalId: user.externalId,
      name: 'Ada Lovelace',
      roles: ['member'],
    });
    expect(henri.privacy.strip({ gender: 'f', name: 'Ada' })).toEqual({
      name: 'Ada',
    });
    // ... unless the answer asked for it by name
    expect(henri.privacy.strip({ gender: 'f' }, ['gender'])).toEqual({
      gender: 'f',
    });

    await User.deleteMany({ email: 'leaves@usehenri.io' });
    await Memo.deleteMany({ ownerId: String(user._id) });
  });

  test('the export holds everything about one person, and no password', async () => {
    const user = await person('export@usehenri.io');
    const document = await henri.privacy.export('export@usehenri.io');

    expect(document.subject).toEqual({
      email: 'export@usehenri.io',
      externalId: user.externalId,
      model: 'User',
    });
    expect(document.counts).toEqual({ Memo: 2, User: 1 });
    expect(document.records.User[0]).toMatchObject({
      age: 36,
      email: 'export@usehenri.io',
      gender: 'f',
      name: 'Ada Lovelace',
    });
    expect(document.records.User[0].password).toBeUndefined();
    expect(document.records.User[0].id).toBeUndefined();
    expect(document.records.Memo.map((memo) => memo.title).sort()).toEqual([
      'One',
      'Two',
    ]);
    // A model that holds nothing about anybody is not in the document
    expect(document.records.Artwork).toBeUndefined();

    await henri.privacy.erase(user, { dryRun: false });
  });

  test('a dry run says what would happen and writes nothing', async () => {
    await person('dry@usehenri.io');

    const receipt = await henri.privacy.erase('dry@usehenri.io', {
      dryRun: true,
    });

    expect(receipt.dryRun).toBe(true);
    expect(receipt.file).toBeNull();
    expect(receipt.records).toMatchObject([
      { action: 'delete', count: 2, model: 'Memo' },
      { action: 'anonymize', count: 1, model: 'User' },
    ]);
    expect(await henri.user.findByEmail('dry@usehenri.io')).toBeTruthy();
    expect(await Memo.countDocuments({})).toBeGreaterThan(0);

    await henri.privacy.erase('dry@usehenri.io');
  });

  test('an erasure anonymizes the person and takes their memos', async () => {
    const user = await person('erase@usehenri.io');
    const owner = String(user._id);
    const receipt = await henri.privacy.erase('erase@usehenri.io');

    expect(receipt.records).toMatchObject([
      { action: 'delete', count: 2, model: 'Memo', written: 2 },
      { action: 'anonymize', count: 1, model: 'User', written: 1 },
    ]);
    expect(receipt.subject.digest).toHaveLength(64);
    expect(receipt.subject.externalId).toBe(user.externalId);

    // The memos are gone, the person is a row that is nobody
    expect(await Memo.find({ ownerId: owner })).toHaveLength(0);

    const erased = await User.findById(user._id).select('+password');

    expect(erased).toBeTruthy();
    expect(erased.email).toMatch(/^erased-[0-9a-f]+@erased\.invalid$/u);
    expect(erased.name).toBeNull();
    expect(erased.age).toBeNull();
    expect(erased.gender).toBeNull();
    expect(erased.passwordChangedAt).toBeInstanceOf(Date);
    // The password is a hash of 32 bytes nobody holds
    expect(erased.password).not.toBe('difference-engine-1842');
    await expect(
      henri.user.compare('difference-engine-1842', erased)
    ).rejects.toThrow(/Invalid credentials/u);

    // And nothing answers to the address any more
    expect(await henri.user.findByEmail('erase@usehenri.io')).toBeNull();
  });

  test('the receipt is written where the configuration says', async () => {
    await person('receipt@usehenri.io');

    const receipt = await henri.privacy.erase('receipt@usehenri.io');
    const file = path.resolve(henri.cwd(), receipt.file);

    expect(receipt.file).toContain('.tmp/privacy');
    expect(fs.existsSync(file)).toBe(true);

    const written = JSON.parse(fs.readFileSync(file, 'utf8'));

    expect(written.id).toBe(receipt.id);
    expect(written.subject.digest).toBe(receipt.subject.digest);
    // The proof holds no address: that is the thing that was erased
    expect(JSON.stringify(written)).not.toContain('receipt@usehenri.io');
  });

  test('a person nobody knows is a coded failure', async () => {
    await expect(henri.privacy.export('nobody@usehenri.io')).rejects.toThrow(
      /no User matches/u
    );

    await expect(
      henri.privacy.erase('nobody@usehenri.io')
    ).rejects.toMatchObject({ code: 'HENRI_PRIVACY_UNKNOWN_SUBJECT' });
  });

  test('the person can be named by external id too', async () => {
    const user = await person('external@usehenri.io');
    const found = await henri.privacy.subject(user.externalId);

    expect(String(found._id)).toBe(String(user._id));

    await henri.privacy.erase(user.externalId);
  });

  test('a private field never reaches a page or a HAL answer', async () => {
    await person('page@usehenri.io');

    // Every answer henri builds goes through the same strip: the view
    // options of res.render() (5.router.js) and the plain object of
    // res.resource() (base/hateoas.js)
    const record = await User.findOne({ email: 'page@usehenri.io' });
    const sent = sendable(henri, record);

    expect(sent.name).toBe('Ada Lovelace');
    expect(sent.gender).toBeUndefined();
    expect(sendable(henri, record, ['gender']).gender).toBe('f');

    await henri.privacy.erase('page@usehenri.io');
  });
});

describe('the erasure against a sequelize store (sqlite)', () => {
  let sql;
  let map;
  let modelOf;
  const models = [
    model(
      'User',
      {
        email: { personal: true, required: true, type: 'string', unique: true },
        name: { personal: true, type: 'string' },
      },
      { timestamps: true }
    ),
    {
      /**
       * A note belongs to whoever wrote it (the Sequelize way: an
       * association, not a column option)
       *
       * @param {object} orm The models by global id
       * @returns {void}
       */
      associate: (orm) => {
        orm.Note.belongsTo(orm.User, { as: 'user', foreignKey: 'userId' });
      },
      ...model(
        'Note',
        {
          body: { personal: true, type: 'text' },
          userId: { type: 'integer' },
        },
        { paranoid: true, timestamps: true }
      ),
    },
  ];

  beforeAll(async () => {
    sql = new Sql(
      'default',
      {
        adapter: 'sqlite',
        dialect: 'sqlite',
        logging: false,
        storage: ':memory:',
      },
      {
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
      }
    );

    models.forEach((entry) => sql.addModel(entry, 'nobody'));
    await sql.start();

    const orm = sql.getModels();

    modelOf = (name) => orm[name];
    map = mapOf(models, { orm: modelOf, subject: 'User' });
  }, 30000);

  afterAll(async () => {
    await sql.stop();
  });

  test('the shim knows a sequelize model when it sees one', () => {
    expect(kindOf(modelOf('User'))).toBe('sequelize');
  });

  test('reaches the soft deleted rows, which a restore would bring back', async () => {
    const orm = modelOf('User');
    const user = await orm.create({ email: 'ada@sql.test', name: 'Ada' });
    const Note = modelOf('Note');

    await Note.create({ body: 'kept', userId: user.id });
    const withdrawn = await Note.create({ body: 'withdrawn', userId: user.id });

    // A soft delete hides the row; the words are still in the database
    await withdrawn.destroy();
    expect(await Note.count({ where: { userId: user.id } })).toBe(1);

    const context = { map, modelOf, secret: 'sequelize-secret' };
    const document = await exportOf(context, user.get({ plain: true }));

    expect(document.counts).toEqual({ Note: 2, User: 1 });

    const receipt = await eraseOf(context, user.get({ plain: true }));

    expect(receipt.records).toMatchObject([
      { action: 'anonymize', count: 2, model: 'Note', written: 2 },
      { action: 'anonymize', count: 1, model: 'User', written: 1 },
    ]);

    const notes = await Note.findAll({ paranoid: false });

    expect(notes.map((note) => note.body)).toEqual([null, null]);

    const erased = await orm.findByPk(user.id);

    expect(erased.email).toMatch(/@erased\.invalid$/u);
    expect(erased.name).toBeNull();
  });

  test('a strategy is a default: a model that decided keeps its answer', async () => {
    const decided = mapOf(
      [
        models[0],
        {
          ...models[1],
          options: { ...models[1].options, personal: { onErase: 'retain' } },
        },
      ],
      { orm: modelOf, subject: 'User' }
    );
    const orm = modelOf('User');
    const user = await orm.create({ email: 'grace@sql.test', name: 'Grace' });

    await modelOf('Note').create({ body: 'kept', userId: user.id });

    const plan = await planOf(
      { map: decided, modelOf },
      user.get({ plain: true }),
      { strategy: 'delete' }
    );

    // The notes said retain, so they are retained; the person had no say
    // and follows the strategy of the run
    expect(plan.steps.map((step) => [step.model, step.action])).toEqual([
      ['Note', 'retain'],
      ['User', 'delete'],
    ]);
    // ... and a person nothing may point at cannot be deleted under them
    expect(plan.problems).toMatchObject([{ problem: 'reference-kept' }]);

    await expect(
      eraseOf({ map: decided, modelOf }, user.get({ plain: true }), {
        strategy: 'delete',
      })
    ).rejects.toThrow(/the erasure was refused/u);
  });

  test('the person is anonymized or deleted, never orphaned', async () => {
    const orm = modelOf('User');
    const user = await orm.create({ email: 'hopper@sql.test' });

    await expect(
      eraseOf({ map, modelOf }, user.get({ plain: true }), {
        strategy: 'orphan',
      })
    ).rejects.toThrow(/a subject is anonymized or deleted/u);
  });
});

describe('the erasure against a drizzle store (sqlite)', () => {
  let store;
  let map;
  let modelOf;
  const models = [
    model(
      'User',
      {
        email: { personal: true, required: true, type: 'string', unique: true },
        name: { personal: true, type: 'string' },
      },
      { timestamps: true }
    ),
    model(
      'Proposal',
      {
        speakerId: {
          references: { model: 'User', onDelete: 'cascade' },
          required: true,
          type: 'integer',
        },
        title: { required: true, type: 'string' },
      },
      { paranoid: true, timestamps: true }
    ),
  ];

  beforeAll(async () => {
    store = new Drizzle(
      'default',
      { dialect: 'sqlite', url: ':memory:' },
      {
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
      }
    );

    models.forEach((entry) => store.addModel(entry, 'nobody'));
    await store.start();

    const orm = store.getModels();

    modelOf = (name) => orm[name];
    map = mapOf(models, { orm: modelOf, subject: 'User' });
  }, 30000);

  afterAll(async () => {
    await store.stop();
  });

  test('the shim knows a drizzle model when it sees one', () => {
    expect(kindOf(modelOf('User'))).toBe('drizzle');
  });

  test('keeps the records that belong to more than the person', async () => {
    const User_ = modelOf('User');
    const Proposal_ = modelOf('Proposal');
    const user = await User_.create({ email: 'ada@drizzle.test', name: 'Ada' });

    await Proposal_.create({ speakerId: user.id, title: 'A talk' });
    const withdrawn = await Proposal_.create({
      speakerId: user.id,
      title: 'Withdrawn',
    });

    await withdrawn.destroy();

    const context = { map, modelOf, secret: 'drizzle-secret' };
    const receipt = await eraseOf(context, user.toObject());

    expect(receipt.records).toMatchObject([
      { action: 'anonymize', count: 2, fields: [], model: 'Proposal' },
      { action: 'anonymize', count: 1, model: 'User', written: 1 },
    ]);

    // The programme is the conference's own record: it survives, and the
    // withdrawn row was reached too
    expect(await Proposal_.withDeleted().count()).toBe(2);

    const erased = await User_.findByPk(user.id);

    expect(erased.email).toMatch(/@erased\.invalid$/u);
    expect(erased.name).toBeNull();
  });

  test('a model may say its records go with the person', async () => {
    const User_ = modelOf('User');
    const Proposal_ = modelOf('Proposal');
    const user = await User_.create({ email: 'grace@drizzle.test' });

    await Proposal_.create({ speakerId: user.id, title: 'Compilers' });

    const deleting = mapOf(models, {
      orm: modelOf,
      settings: { onErase: 'delete' },
      subject: 'User',
    });
    const receipt = await eraseOf(
      { map: deleting, modelOf, secret: 'x' },
      user.toObject()
    );

    expect(receipt.records).toMatchObject([
      { action: 'delete', count: 1, model: 'Proposal', written: 1 },
      { action: 'delete', count: 1, model: 'User', written: 1 },
    ]);
    expect(
      await Proposal_.withDeleted().where({ speakerId: user.id }).count()
    ).toBe(0);
    expect(await User_.findByPk(user.id)).toBeNull();
  });
});
