/* global Memo */
const supertest = require('supertest');
const Henri = require('../henri');
const { build, publish, settings } = require('../base/references');
const { toPublic } = require('../base/hateoas');
const { stripPersonal } = require('../base/privacy');

const password = 'difference-engine';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const external = () => `0199a5c1-1f7e-7a3c-bb0d-${Date.now()}`.slice(0, 36);

/**
 * Reads a cookie value from a response
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

/**
 * A henri stand-in carrying a reference table and one store
 *
 * @param {object} table the `{ classes, models }` table
 * @param {object} store the store double
 * @param {object} [config={}] `config.externalIds`
 * @returns {object} the stand-in
 */
const fake = (table, store, config = {}) => ({
  config: {
    get: () => config.externalIds,
    has: () => typeof config.externalIds !== 'undefined',
  },
  model: { referenceTable: table, stores: { default: store } },
  pen: { warn() {} },
});

describe('base/references', () => {
  describe('settings', () => {
    test('defaults to the safe pair, whatever the application wrote', () => {
      expect(settings(null)).toEqual({ lookup: 'external', references: true });
      expect(settings({})).toEqual({ lookup: 'external', references: true });
      expect(
        settings({ config: { get: () => ({ lookup: 'nonsense' }) } })
      ).toEqual({ lookup: 'external', references: true });
      expect(
        settings({
          config: {
            get: () => {
              throw new Error('no such key');
            },
          },
        })
      ).toEqual({ lookup: 'external', references: true });
    });

    test('takes what the application wrote when it is one of the two', () => {
      expect(
        settings({
          config: { get: () => ({ lookup: 'any', references: false }) },
        })
      ).toEqual({ lookup: 'any', references: false });
    });
  });

  describe('build', () => {
    test('ignores an adapter that cannot describe itself', () => {
      const table = build({
        broken: {
          getModels: () => ({}),
          references: () => {
            throw new Error('nope');
          },
        },
        silent: { getModels: () => ({}) },
      });

      expect(table.models).toEqual({});
      expect(table.classes.size).toBe(0);
    });

    test('maps every registered constructor to its global id', () => {
      class Post {}
      const table = build({
        default: {
          getModels: () => ({ Post }),
          references: () => ({
            Post: {
              externalId: true,
              references: { authorId: { as: 'author', target: 'User' } },
            },
          }),
        },
      });

      expect(table.classes.get(Post)).toBe('Post');
      expect(table.models.Post.store).toBe('default');
      expect(table.models.Post.references.authorId.target).toBe('User');
    });
  });

  describe('publish', () => {
    class Post {}
    class Note {}

    const table = {
      classes: new Map([
        [Post, 'Post'],
        [Note, 'Note'],
      ]),
      models: {
        Note: { externalId: false, references: {}, store: 'default' },
        Post: {
          externalId: true,
          references: {
            authorId: { as: 'author', target: 'User' },
            noteId: { as: null, target: 'Note' },
            reviewerIds: { as: null, target: 'User' },
            tagId: { as: null, target: 'Tag' },
          },
          store: 'default',
        },
        Tag: { externalId: true, references: {}, store: 'default' },
        User: { externalId: true, references: {}, store: 'default' },
      },
    };

    /**
     * A store answering `externalIdsOf`, counting what it was asked
     *
     * @param {object} rows `{ Model: { key: externalId } }`
     * @returns {object} the store double
     */
    const storeOf = (rows) => {
      const asked = [];

      return {
        asked,
        async externalIdsOf(model, keys) {
          asked.push([model, [...keys].sort()]);

          return new Map(
            keys
              .filter((key) => (rows[model] || {})[key])
              .map((key) => [String(key), rows[model][key]])
          );
        },
      };
    };

    test('replaces a declared foreign key with the target public id', async () => {
      const store = storeOf({ User: { 4812: 'u-4812' } });
      const post = Object.assign(new Post(), {
        authorId: 4812,
        externalId: 'p-1',
        id: 7,
        title: 'hello',
      });

      expect(await publish(fake(table, store), post)).toEqual({
        authorId: 'u-4812',
        externalId: 'p-1',
        title: 'hello',
      });
      expect(store.asked).toEqual([['User', ['4812']]]);
    });

    test('a key that resolves to nothing is null, never the number', async () => {
      const store = storeOf({});
      const post = Object.assign(new Post(), {
        authorId: 4812,
        externalId: 'p-1',
        id: 7,
      });
      const answer = await publish(fake(table, store), post);

      expect(answer.authorId).toBeNull();
      expect(JSON.stringify(answer)).not.toContain('4812');
    });

    test('a store that throws leaves null, and does not fail the answer', async () => {
      const store = {
        externalIdsOf: async () => {
          throw new Error('the database went away');
        },
      };
      const post = Object.assign(new Post(), { authorId: 9, externalId: 'p' });

      expect(await publish(fake(table, store), post)).toEqual({
        authorId: null,
        externalId: 'p',
      });
    });

    test('an adapter with no externalIdsOf leaves null too', async () => {
      const post = Object.assign(new Post(), { authorId: 9, externalId: 'p' });

      expect(await publish(fake(table, {}), post)).toEqual({
        authorId: null,
        externalId: 'p',
      });
    });

    test('an eager loaded association costs no query', async () => {
      const store = storeOf({ User: { 4812: 'u-4812' } });
      const post = Object.assign(new Post(), {
        author: { externalId: 'u-4812', id: 4812, name: 'Ada' },
        authorId: 4812,
        externalId: 'p-1',
        id: 7,
      });

      expect(await publish(fake(table, store), post)).toEqual({
        author: { externalId: 'u-4812', name: 'Ada' },
        authorId: 'u-4812',
        externalId: 'p-1',
      });
      expect(store.asked).toEqual([]);
    });

    test('the loaded record is read off the instance, not its serialization', async () => {
      const store = storeOf({ User: { 4812: 'u-4812' } });
      const author = { externalId: 'u-4812', id: 4812, name: 'Ada' };
      // What every adapter does: `toJSON()` has already removed the primary
      // key of the nested record, so the identity check has to read the
      // live instance or it would never match and every page would query
      const post = Object.assign(new Post(), {
        author,
        authorId: 4812,
        externalId: 'p-1',
        id: 7,
        toJSON: () => ({
          author: { externalId: 'u-4812', name: 'Ada' },
          authorId: 4812,
          externalId: 'p-1',
        }),
      });
      const answer = await publish(fake(table, store), post);

      expect(answer.authorId).toBe('u-4812');
      expect(store.asked).toEqual([]);
    });

    test('a __proto__ field is a field, never the prototype of the copy', async () => {
      const store = storeOf({});
      // A JSON column is somewhere an attacker can put this key
      const payload = JSON.parse(
        '{"externalId":"p-1","meta":{"__proto__":{"polluted":true}}}'
      );
      const answer = await publish(fake(table, store), payload);

      expect(Object.getPrototypeOf(answer.meta)).toBe(Object.prototype);
      expect({}.polluted).toBeUndefined();
      expect(Object.prototype.polluted).toBeUndefined();
      expect(
        Object.prototype.hasOwnProperty.call(answer.meta, '__proto__')
      ).toBe(true);
    });

    test('a loaded record that is not the row the key names is not trusted', async () => {
      const store = storeOf({ User: { 4812: 'u-4812' } });
      // A presenter put somebody else under `author`: the identity is
      // checked, so the wrong public id is never published
      const post = Object.assign(new Post(), {
        author: { externalId: 'u-9999', id: 9999 },
        authorId: 4812,
        externalId: 'p-1',
      });
      const answer = await publish(fake(table, store), post);

      expect(answer.authorId).toBe('u-4812');
      expect(store.asked).toEqual([['User', ['4812']]]);
    });

    test('one page of records costs one query per target model', async () => {
      const store = storeOf({
        Tag: { 77: 't-77' },
        User: { 1: 'u-1', 2: 'u-2', 3: 'u-3' },
      });
      const posts = Array.from({ length: 25 }, (unused, index) =>
        Object.assign(new Post(), {
          authorId: (index % 3) + 1,
          externalId: `p-${index}`,
          id: index,
          // A target that opted out: it costs nothing at all
          noteId: 5,
          tagId: 77,
        })
      );
      const answer = await publish(fake(table, store), posts);

      expect(answer).toHaveLength(25);
      expect(answer[0].authorId).toBe('u-1');
      expect(answer[0].tagId).toBe('t-77');
      expect(answer[0].noteId).toBe(5);
      // Two statements for twenty five records and seventy five foreign
      // keys, and the keys are deduplicated inside each of them
      expect(store.asked).toHaveLength(2);
      expect(store.asked.sort()).toEqual([
        ['Tag', ['77']],
        ['User', ['1', '2', '3']],
      ]);
    });

    test('a list of keys is translated entry by entry', async () => {
      const store = storeOf({ User: { 1: 'u-1', 3: 'u-3' } });
      const post = Object.assign(new Post(), {
        externalId: 'p-1',
        reviewerIds: [1, 2, 3],
      });

      expect((await publish(fake(table, store), post)).reviewerIds).toEqual([
        'u-1',
        null,
        'u-3',
      ]);
    });

    test('a target that opted out keeps the number it has', async () => {
      const store = storeOf({});
      const post = Object.assign(new Post(), { externalId: 'p', noteId: 5 });

      // Note declared `externalId: false`: its primary key is its only
      // identifier, so there is nothing else to publish
      expect((await publish(fake(table, store), post)).noteId).toBe(5);
      expect(store.asked).toEqual([]);
    });

    test('a record of a model that opted out keeps its own id', async () => {
      const store = storeOf({});
      const note = Object.assign(new Note(), { body: 'plain', id: 12 });

      expect(await publish(fake(table, store), note)).toEqual({
        body: 'plain',
        id: 12,
      });
    });

    test('a plain object henri cannot place is left alone', async () => {
      const store = storeOf({ User: { 4812: 'u-4812' } });
      // No model behind it: a `.lean()` query, a raw row, a hand-built
      // object. henri does not guess `authorId` from its name
      const answer = await publish(fake(table, store), {
        authorId: 4812,
        externalId: 'p-1',
        id: 7,
      });

      expect(answer.authorId).toBe(4812);
      // The internal id still goes, because that never needed the model
      expect(answer.id).toBeUndefined();
      expect(store.asked).toEqual([]);
    });

    test('externalIds.references false sends the numbers again', async () => {
      const store = storeOf({ User: { 4812: 'u-4812' } });
      const post = Object.assign(new Post(), {
        authorId: 4812,
        externalId: 'p-1',
        id: 7,
      });
      const answer = await publish(
        fake(table, store, { externalIds: { references: false } }),
        post
      );

      expect(answer.authorId).toBe(4812);
      expect(answer.id).toBeUndefined();
    });

    test('a value that is already a public id is left as it is', async () => {
      const store = storeOf({});
      const post = Object.assign(new Post(), {
        authorId: '0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11',
        externalId: 'p-1',
      });

      expect((await publish(fake(table, store), post)).authorId).toBe(
        '0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11'
      );
      expect(store.asked).toEqual([]);
    });

    test('null and undefined stay what they are', async () => {
      const store = storeOf({});
      const post = Object.assign(new Post(), {
        authorId: null,
        externalId: 'p-1',
      });

      expect((await publish(fake(table, store), post)).authorId).toBeNull();
      expect(store.asked).toEqual([]);
    });

    test('a cycle terminates and a record seen twice is copied once', async () => {
      const store = storeOf({ User: { 1: 'u-1' } });
      const post = Object.assign(new Post(), { authorId: 1, externalId: 'p' });

      post.self = post;

      const answer = await publish(fake(table, store), post);

      expect(answer.self).toBe(answer);
      expect(answer.authorId).toBe('u-1');
    });

    test('dates and buffers are not walked', async () => {
      const when = new Date('2026-01-01T00:00:00.000Z');
      const bytes = Buffer.from('x');
      const answer = await publish(fake(table, storeOf({})), {
        blob: bytes,
        when,
      });

      expect(answer.when).toBe(when);
      expect(answer.blob).toBe(bytes);
    });

    test('a foreign key marked expose: false leaves as neither of the two', async () => {
      // The seam between the two exit gates: publishing resolves the key
      // into the public identifier of the row it names, and the privacy
      // strip runs after, so a field that must not leave cannot leave
      // carrying whatever it resolved to
      const store = storeOf({ User: { 4812: 'u-4812' } });
      const henri = fake(table, store);

      henri.privacy = {
        strip: (value, include = []) =>
          stripPersonal(value, new Set(['authorId']), include),
      };

      const post = Object.assign(new Post(), {
        authorId: 4812,
        externalId: 'p-1',
        id: 7,
      });
      const answer = await toPublic(henri, post);

      expect(answer.authorId).toBeUndefined();
      expect(JSON.stringify(answer)).not.toContain('4812');
      expect(JSON.stringify(answer)).not.toContain('u-4812');
      expect(answer.externalId).toBe('p-1');
    });

    test('a field the answer asked for by name survives the strip', async () => {
      const store = storeOf({ User: { 4812: 'u-4812' } });
      const henri = fake(table, store);

      henri.privacy = {
        strip: (value, include = []) =>
          stripPersonal(value, new Set(['authorId']), include),
      };

      const post = Object.assign(new Post(), {
        authorId: 4812,
        externalId: 'p-1',
      });

      expect((await toPublic(henri, post, ['authorId'])).authorId).toBe(
        'u-4812'
      );
    });

    test('publishes nothing when there is no table at all', async () => {
      expect(await publish(null, { externalId: 'p', id: 1 })).toEqual({
        externalId: 'p',
      });
    });
  });
});

describe('references over http (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let request;
  let agent;
  let csrf;
  let user;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;

    const app = henri.server.app;

    request = supertest(app);
    agent = supertest.agent(app);

    const email = `owner-${Date.now()}@usehenri.io`;
    const registered = await agent
      .post('/register')
      .send({ email, name: 'Owner', password });

    csrf = cookieOf(registered, 'henri.csrf');
    await agent.post('/login').send({ email, password });
    user = await henri.user.findByEmail(email);
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;

    if (skipWorkers) {
      process.env.SKIP_WORKERS = skipWorkers;
    } else {
      delete process.env.SKIP_WORKERS;
    }
  });

  test('the demo maps Memo.ownerId to the owner public id', async () => {
    const created = await agent
      .post('/memos')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'the reference', title: 'Owned' });

    expect(created.status).toBe(201);
    expect(created.body.ownerId).toBe(user.externalId);
    expect(created.body.ownerId).toMatch(UUID);
  });

  test('no sequential or document id of any row is in the answer', async () => {
    await agent
      .post('/memos')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'b', title: 'Second' });

    const listed = await agent.get('/memos');
    const body = JSON.stringify(listed.body);
    const owner = String(user._id || user.id);

    expect(listed.status).toBe(200);
    expect(body).not.toContain(owner);

    for (const value of JSON.stringify(listed.body).match(/"[^"]*"/gu) || []) {
      expect(value.slice(1, -1)).not.toMatch(OBJECT_ID);
    }
  });

  test('a memo cannot be reached by the document id of its row', async () => {
    const memo = await Memo.create({
      ownerId: String(user._id || user.id),
      title: 'By key',
    });

    expect(
      (await agent.get(`/memos/${memo._id}`).set('Accept', 'application/json'))
        .status
    ).toBe(404);
    expect(
      (
        await agent
          .get(`/memos/${memo.externalId}`)
          .set('Accept', 'application/json')
      ).status
    ).toBe(200);
  });

  test('an unknown public id and a document id answer the same way', async () => {
    const memo = await Memo.create({
      ownerId: String(user._id || user.id),
      title: 'Same 404',
    });
    const byKey = await agent
      .get(`/memos/${memo._id}`)
      .set('Accept', 'application/json');
    const unknown = await agent
      .get('/memos/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11')
      .set('Accept', 'application/json');

    expect(byKey.status).toBe(unknown.status);
    expect(byKey.body.error).toBe(unknown.body.error);
    expect(request).toBeDefined();
    expect(external()).toMatch(/^0199a5c1/u);
  });
});
