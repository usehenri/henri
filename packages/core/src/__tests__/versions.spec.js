/* global Memo, User */
const supertest = require('supertest');

const Henri = require('../henri');

/** A password the user model accepts */
const PASSWORD = 'a-long-enough-password';

/**
 * One cookie of a response
 *
 * @param {object} res supertest response
 * @param {string} name cookie name
 * @returns {?string} the value or null
 */
const cookieOf = (res, name) => {
  const line = (res.headers['set-cookie'] || []).find((cookie) =>
    cookie.startsWith(`${name}=`)
  );

  return line ? line.split(';')[0].slice(name.length + 1) : null;
};

const {
  DERIVED,
  EVENTS,
  NEVER,
  changesOf,
  diffOf,
  kindOf,
  markOf,
  pack,
  reifyFrom,
  same,
  snapshotOf,
  toVersion,
  unpack,
  uuidv7,
  versionsConfig,
} = require('../base/versions');
const { install } = require('../base/version-store');

/** A model file the way core hands one to an adapter */
const model = (options) => ({ globalId: 'Thing', options, schema: {} });

/** The plan a diff is measured with */
const plan = (kinds = {}, encrypt = null) => ({
  encrypt,
  kind: (field) => kinds[field] || 'value',
});

describe('the mark (no application)', () => {
  test('true is every field on every event', () => {
    expect(markOf(model({ versioned: true }))).toEqual({
      events: [...EVENTS],
      except: [],
      only: null,
    });
    expect(markOf(model({}))).toBeNull();
    expect(markOf(model({ versioned: false }))).toBeNull();
  });

  test('the object form narrows it', () => {
    expect(
      markOf(model({ versioned: { events: ['update'], only: ['title'] } }))
    ).toEqual({ events: ['update'], except: [], only: ['title'] });
  });

  test('a mark henri cannot carry out fails the boot', () => {
    const refused = (versioned) => {
      let error = null;

      try {
        markOf(model({ versioned }));
      } catch (thrown) {
        error = thrown;
      }

      expect(error && error.code).toBe('HENRI_VERSION_INVALID_OPTION');

      return error;
    };

    expect(refused('yes').message).toContain('must be true or an object');
    expect(refused({ nope: 1 }).message).toContain('no option named nope');
    expect(refused({ except: ['a'], only: ['b'] }).message).toContain(
      "'only' or 'except', not both"
    );
    expect(refused({ only: [1] }).message).toContain('a list of field names');
    expect(refused({ events: [] }).message).toContain('non-empty list');
    expect(refused({ events: ['moved'] }).message).toContain('non-empty list');
  });
});

describe('what is never stored', () => {
  // The rule of `base/versions.js`, and the test the trail's refusal has:
  // a version table holds values, so what it must not hold is checked here
  // rather than left to the adapters
  const filters = ['password', 'token', 'secret', 'authorization'];

  test('password is never stored, whatever the configuration says', () => {
    expect(NEVER).toEqual(['password']);

    for (const configured of [filters, [], ['nothing']]) {
      expect(kindOf('password', { filters: configured })).toBe('never');
    }

    // Exactly, not as a substring: the date is not a credential
    expect(kindOf('passwordChangedAt', { filters: [] })).toBe('value');
  });

  test('a name filterParameters matches is not stored either', () => {
    expect(kindOf('apiToken', { filters })).toBe('filtered');
    expect(kindOf('sessionSecret', { filters })).toBe('filtered');
    expect(kindOf('title', { filters })).toBe('value');
    // ... and what no configuration lifts is lifted here too
    expect(kindOf('encryptionKeys', { filters: [] })).toBe('filtered');
  });

  test('an encrypted field is stored as its envelope', () => {
    const encrypted = new Set(['ssn']);

    expect(kindOf('ssn', { encrypted })).toBe('envelope');

    const changes = diffOf(
      { ssn: '123' },
      { ssn: '456' },
      plan({ ssn: 'envelope' }, (field, value) => `henri:v1:r:abcd:${value}`)
    );

    expect(changes.ssn).toEqual(['henri:v1:r:abcd:123', 'henri:v1:r:abcd:456']);
    // ... and never the plaintext
    expect(JSON.stringify(changes)).not.toContain('"123"');
  });

  test('a field the model left out is not even named', () => {
    const mark = { events: [...EVENTS], except: ['seenAt'], only: null };

    expect(kindOf('seenAt', { mark })).toBe('skip');
    expect(kindOf('title', { mark })).toBe('value');

    const only = { events: [...EVENTS], except: [], only: ['title'] };

    expect(kindOf('body', { mark: only })).toBe('skip');
    expect(kindOf('title', { mark: only })).toBe('value');
  });

  test('the columns henri derives are not repeated', () => {
    expect([...DERIVED].sort()).toEqual([
      '__v',
      '_id',
      'createdAt',
      'externalId',
      'id',
      'updatedAt',
    ]);

    for (const field of DERIVED) {
      expect(kindOf(field, {})).toBe('skip');
    }

    // A soft delete is a change somebody made
    expect(kindOf('deletedAt', {})).toBe('value');
  });

  test('a change with no values is null, and not a masked string', () => {
    const changes = diffOf(
      { password: 'a', title: 'One', token: 'x' },
      { password: 'b', title: 'Two', token: 'y' },
      plan({ password: 'never', token: 'filtered' })
    );

    expect(changes).toEqual({
      password: null,
      title: ['One', 'Two'],
      token: null,
    });
    // A mask is a value, and a restore would write it into the column
    expect(JSON.stringify(changes)).not.toContain('FILTERED');
  });
});

describe('the shapes', () => {
  test('a value survives the round trip, Date included', () => {
    const when = new Date('2024-03-04T05:06:07.000Z');

    expect(unpack(pack(when))).toEqual(when);
    expect(unpack(pack({ a: [1, 'x', when] }))).toEqual({
      a: [1, 'x', when],
    });
    expect(pack(null)).toBeNull();
    // Not storable rather than stored wrong
    expect(pack(Buffer.from('x'))).toBeUndefined();
    expect(pack(Number.NaN)).toBeUndefined();
    expect(pack(() => 1)).toBeUndefined();

    const circular = { a: 1 };

    circular.self = circular;
    expect(pack(circular)).toEqual({ a: 1 });
  });

  test('same() is what decides a field changed', () => {
    expect(same(null, undefined)).toBe(true);
    expect(same(new Date(1), new Date(1))).toBe(true);
    expect(same(new Date(1), new Date(2))).toBe(false);
    expect(same({ a: [1] }, { a: [1] })).toBe(true);
    expect(same(1, '1')).toBe(false);
  });

  test('a snapshot holds every stored field', () => {
    expect(
      snapshotOf(
        { id: 1, password: 'x', title: 'One' },
        plan({ id: 'skip', password: 'never' })
      )
    ).toEqual({ password: null, title: 'One' });
  });

  test('a row reads back as a version', () => {
    const row = {
      actor: null,
      at: 1700000000000,
      changes: '{"title":["a","b"],"password":null}',
      erased_at: null,
      event: 'update',
      id: 'x',
      meta: null,
      model: 'Memo',
      record: 'r',
      request_id: null,
      snapshot: null,
      source: 'system',
    };

    expect(toVersion(row)).toMatchObject({
      changes: { password: null, title: ['a', 'b'] },
      erasedAt: null,
      event: 'update',
      model: 'Memo',
      record: 'r',
    });
    expect(toVersion(null)).toBeNull();
    expect(changesOf('not json')).toEqual({});
  });

  test('the identifier orders by the moment it was made', () => {
    const ids = Array.from({ length: 50 }, () => uuidv7());

    expect(new Set(ids).size).toBe(50);
    expect([...ids].sort()).toEqual(ids);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/u);
  });

  test('the configuration says where and how long, and turns nothing on', () => {
    expect(versionsConfig(null)).toEqual({
      keep: null,
      onErase: 'follow',
      store: 'default',
      table: 'henri_versions',
    });

    const settings = { keep: '2y', onErase: 'delete', table: 'history' };

    expect(
      versionsConfig({ get: () => settings, has: () => true })
    ).toMatchObject({ onErase: 'delete', table: 'history' });
  });

  test('every dialect has a table, and a name that is not one is refused', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql', 'mssql']) {
      expect(install(dialect, 'henri_versions').join('\n')).toContain(
        'henri_versions'
      );
    }

    expect(() => install('redis', 'henri_versions')).toThrow(/cannot be kept/u);
  });
});

describe('the fold', () => {
  const version = (id, changes, extra = {}) => ({
    changes,
    event: 'update',
    id,
    snapshot: null,
    ...extra,
  });

  test('it runs backwards from the live record', () => {
    const target = version('2', { title: ['One', 'Two'] });
    const folded = reifyFrom({
      base: { body: 'b', title: 'Three' },
      newer: [version('3', { title: ['Two', 'Three'] }), target],
      target,
    });

    expect(folded).toEqual({
      attributes: { body: 'b', title: 'Two' },
      complete: true,
      missing: [],
    });
  });

  test('a destroyed record folds from its snapshot', () => {
    const target = version(
      '2',
      {},
      { event: 'destroy', snapshot: { title: 'Two' } }
    );

    expect(reifyFrom({ base: null, newer: [target], target })).toEqual({
      attributes: { title: 'Two' },
      complete: true,
      missing: [],
    });
  });

  test('with nothing to fold from it says so rather than looking like a record', () => {
    const target = version('2', { title: ['One', 'Two'] });

    expect(reifyFrom({ base: null, newer: [target], target })).toEqual({
      attributes: { title: 'Two' },
      complete: false,
      missing: [],
    });
  });

  test('a field whose values are not kept makes it inexact', () => {
    const target = version('2', { password: null, title: ['One', 'Two'] });

    expect(
      reifyFrom({ base: { title: 'Two' }, newer: [target], target })
    ).toEqual({
      attributes: { title: 'Two' },
      complete: false,
      missing: ['password'],
    });
  });
});

describe('versions (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
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
   * A memo nothing else in this file touches
   *
   * @param {object} [attrs={}] what it says
   * @returns {Promise<object>} the memo
   */
  const memo = (attrs = {}) =>
    Memo.create({ body: 'the body', title: 'the title', ...attrs });

  test('the module says which models asked', () => {
    expect(henri.versions.enabled).toBe(true);
    expect(henri.versions.watches('Memo')).toBe(true);
    expect(henri.versions.watches('User')).toBe(true);
    expect(henri.versions.watches('Artwork')).toBe(false);
    expect(henri.versions.settings.table).toBe('henri_versions');
  });

  test('a create, an update and a destroy, on MongoDB', async () => {
    const one = await memo({ title: 'First' });

    await one.updateOne({ title: 'Second' });

    const saved = await Memo.findById(one.externalId);

    saved.title = 'Third';
    await saved.save();
    await saved.deleteOne({ force: true });

    const history = await henri.versions.of({
      model: 'Memo',
      record: one.externalId,
    });

    expect(history.map((entry) => entry.event)).toEqual([
      'destroy',
      'update',
      'update',
      'create',
    ]);
    expect(history[3].changes.title).toEqual([null, 'First']);
    expect(history[2].changes.title).toEqual(['First', 'Second']);
    expect(history[1].changes.title).toEqual(['Second', 'Third']);
    expect(history[0].snapshot.title).toBe('Third');
    expect(history[0].changes).toEqual({});
  });

  test('the user model keeps no password in its history', async () => {
    const user = await User.create({
      email: `versions-${Date.now()}@usehenri.io`,
      name: 'Ada',
      password: `sup3r${PASSWORD}`,
      phone: '+15145550100',
    });
    const [version] = await henri.versions.of(user);

    expect(version.changes.password).toBeNull();
    expect(JSON.stringify(version)).not.toContain(PASSWORD);
    // ... and never the hash either
    expect(JSON.stringify(version)).not.toContain('$2');

    // `phone` is encrypted: the envelope is stored, the plaintext is not
    expect(version.changes.phone[1]).toMatch(/^henri:v1:/u);
    expect(JSON.stringify(version)).not.toContain('+15145550100');

    // `name` and `gender` are personal and they ARE stored: that is what
    // makes a history worth keeping, and what the erasure has to reach
    expect(version.changes.name).toEqual([null, 'Ada']);

    // The envelope opens where the row's does
    const reified = await henri.versions.reify(version.id);

    expect(reified.attributes.phone).toBe('+15145550100');
    expect(reified.missing).toEqual(['password']);
    expect(reified.complete).toBe(false);

    await user.deleteOne({ force: true, versions: false });
  });

  test('a request says who and joins by the request id', async () => {
    const email = `actor-${Date.now()}@usehenri.io`;
    const browser = supertest.agent(henri.server.app);
    const registered = await browser
      .post('/register')
      .send({ email, name: 'Ada', password: PASSWORD });

    expect(registered.status).toBe(201);
    await browser.post('/login').send({ email, password: PASSWORD });

    const created = await browser
      .post('/memos')
      .set('X-CSRF-Token', cookieOf(registered, 'henri.csrf'))
      .set('X-Request-Id', 'a-known-request')
      .send({ body: 'written in a request', title: 'From the web' });

    expect(created.status).toBe(201);

    const [version] = await henri.versions.list({
      requestId: 'a-known-request',
    });

    expect(version.model).toBe('Memo');
    expect(version.source).toBe('http');
    expect(version.requestId).toBe('a-known-request');

    const user = await User.findOne({ email });

    // The actor is the person's public identifier, never their key
    expect(version.actor).toBe(user.externalId);
    expect(version.actor).not.toBe(String(user._id));
  });

  test('acting() says who outside a request, and is an async context', async () => {
    const [inside, outside] = await Promise.all([
      henri.versions.acting({ actor: 'someone', source: 'job' }, async () => {
        const record = await memo({ title: 'From a job' });

        return (await henri.versions.of(record))[0];
      }),
      (async () => {
        const record = await memo({ title: 'From nowhere' });

        return (await henri.versions.of(record))[0];
      })(),
    ]);

    expect(inside.actor).toBe('someone');
    expect(inside.source).toBe('job');
    expect(outside.actor).toBeNull();
    expect(outside.source).toBe('system');

    expect(() => henri.versions.acting({ source: 'nowhere' }, () => 1)).toThrow(
      /must be one of console, http, job, seed, system, task/u
    );
  });

  test('a mass write is refused on MongoDB too', async () => {
    await memo({ title: 'Mass' });

    await expect(
      Memo.updateMany({ title: 'Mass' }, { $set: { title: 'Changed' } })
    ).rejects.toMatchObject({ code: 'HENRI_VERSION_MASS_WRITE' });

    await expect(Memo.deleteMany({ title: 'Mass' })).rejects.toMatchObject({
      code: 'HENRI_VERSION_MASS_WRITE',
    });

    // The way through is a decision the caller writes down
    const result = await Memo.updateMany(
      { title: 'Mass' },
      { $set: { title: 'Changed' } },
      { versions: false }
    );

    expect(result.modifiedCount).toBe(1);
    expect(
      await henri.versions.count({ event: 'update', model: 'Memo' })
    ).toBeGreaterThanOrEqual(0);

    await Memo.deleteMany({ title: 'Changed' }, { versions: false });
  });

  test('restore brings a destroyed record back under its own identifier', async () => {
    const record = await memo({ title: 'Gone' });
    const external = record.externalId;

    await record.deleteOne({ force: true });

    const [destroyed] = await henri.versions.of({
      model: 'Memo',
      record: external,
    });
    const { created, record: back } = await henri.versions.restore(
      destroyed.id
    );

    expect(created).toBe(true);
    expect(back.externalId).toBe(external);
    expect(back.title).toBe('Gone');
    expect((await Memo.findById(external)).title).toBe('Gone');

    await back.deleteOne({ force: true, versions: false });
  });

  test('an unknown version says so', async () => {
    await expect(henri.versions.get('nope')).resolves.toBeNull();
    await expect(
      henri.versions.reify('018f0000-0000-7000-8000-00000000ffff')
    ).rejects.toMatchObject({ code: 'HENRI_VERSION_UNKNOWN' });
  });

  test('the sweep prunes what is past versions.keep', async () => {
    await memo({ title: 'Old' });

    const before = await henri.versions.count({});

    expect(before).toBeGreaterThan(0);

    const swept = await henri.versions.prune({
      now: Date.now() + 400 * 86400000,
    });

    expect(swept.removed).toBe(before);
    expect(await henri.versions.count({})).toBe(0);
  });

  test('an erasure reaches the versions', async () => {
    const email = `erased-${Date.now()}@usehenri.io`;
    const user = await User.create({ email, name: 'Ada', password: PASSWORD });
    const owner = String(user._id);
    const kept = await Memo.create({
      body: 'about them',
      ownerId: owner,
      title: 'Kept',
    });

    await kept.updateOne({ body: 'still about them' });

    expect(
      await henri.versions.count({ model: 'Memo', record: kept.externalId })
    ).toBe(2);
    expect(
      await henri.versions.count({ model: 'User', record: user.externalId })
    ).toBe(1);

    const receipt = await henri.privacy.erase(email);

    expect(receipt.versions.strategy).toBe('follow');
    // A memo is `onErase: 'delete'`, so its history went with it
    expect(
      await henri.versions.count({ model: 'Memo', record: kept.externalId })
    ).toBe(0);

    // The person's own row survives, anonymized, and so does its history --
    // with the values the erasure removed taken out of it
    const [version] = await henri.versions.of({
      model: 'User',
      record: user.externalId,
    });

    expect(version.changes.name).toBeNull();
    expect(version.erasedAt).not.toBeNull();
    expect(JSON.stringify(version)).not.toContain('Ada');

    await User.deleteOne({ _id: user._id }, { force: true, versions: false });
  });

  test('the export hands a person the history held about them', async () => {
    const email = `exported-${Date.now()}@usehenri.io`;
    const user = await User.create({ email, name: 'Ada', password: PASSWORD });

    await user.updateOne({ name: 'Ada Lovelace' });

    const document = await henri.privacy.export(email);

    expect(document.versions.User).toHaveLength(2);
    expect(document.versions.User[1].changes.name).toEqual([
      'Ada',
      'Ada Lovelace',
    ]);
    // The document says what it holds and not how the rows are numbered
    expect(document.ids).toBeUndefined();

    await User.deleteOne({ _id: user._id }, { force: true, versions: false });
  });
});
