/* global Memo */
const supertest = require('supertest');

const Henri = require('../henri');
const { describe: describeModels, sdlOf } = require('../base/graphql-schema');

const password = 'difference-engine';
const ownerEmail = 'owner@graphql.usehenri.io';
const strangerEmail = 'stranger@graphql.usehenri.io';

let henri;
let owner;
let stranger;
let mine;

/**
 * Registers and logs a user in
 *
 * @param {object} app the express app
 * @param {string} email the email
 * @returns {Promise<{agent: object, user: object}>} the agent and the user
 */
const signUp = async (app, email) => {
  const agent = supertest.agent(app);
  const registered = await agent
    .post('/register')
    .send({ email, name: email.split('@')[0], password });

  if (registered.status !== 201) {
    throw new Error(`unable to register ${email}: ${registered.status}`);
  }

  const user = await henri.user.findByEmail(email);
  const logged = await agent.post('/login').send({ email, password });

  if (logged.status !== 200) {
    throw new Error(`unable to log ${email} in: ${logged.status}`);
  }

  return { agent, user };
};

/**
 * Runs a query against the schema henri built, as somebody
 *
 * @param {string} query the query
 * @param {*} [user=null] the user asking
 * @param {object} [variables] the variables
 * @returns {Promise<object>} `{ data, errors }`
 */
const ask = (query, user = null, variables = undefined) =>
  henri.graphql.run(query, variables, { req: { user } });

// The demo's Memo model says `graphql: { generate: true, mutations: true }`
// and nothing else: everything below is derived from its schema and served
// by the same Apollo server a hand-written definition is served by.
describe('a generated graphql definition', () => {
  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;

    owner = await signUp(henri.server.app, ownerEmail);
    stranger = await signUp(henri.server.app, strangerEmail);
    mine = await Memo.create({
      body: 'the whole point',
      ownerId: String(owner.user._id),
      title: 'Mine',
    });
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    delete process.env.SKIP_WORKERS;
  });

  describe('the definition', () => {
    test('is in the schema the endpoint serves', () => {
      const types = henri.graphql.schema.getTypeMap();

      expect(Object.keys(types)).toEqual(expect.arrayContaining(['Memo']));
      expect(Object.keys(types.Memo.getFields()).sort()).toEqual([
        'archivedAt',
        'body',
        'createdAt',
        'id',
        'ownerId',
        'title',
        'updatedAt',
      ]);
    });

    test('publishes the public identifier and never the primary key', () => {
      const fields = henri.graphql.schema.getTypeMap().Memo.getFields();

      expect(String(fields.id.type)).toBe('ID!');
      expect(fields._id).toBeUndefined();
      expect(fields.externalId).toBeUndefined();
    });

    test('makes a declared foreign key an ID', () => {
      const fields = henri.graphql.schema.getTypeMap().Memo.getFields();

      expect(String(fields.ownerId.type)).toBe('ID');
    });

    test('leaves the hand-written definition of another model alone', () => {
      const query = henri.graphql.schema.getQueryType().getFields();

      expect(Object.keys(query)).toEqual(
        expect.arrayContaining(['artworks', 'memo', 'memos'])
      );
    });
  });

  describe('reading', () => {
    test('answers one record through its externalId', async () => {
      const { data, errors } = await ask(
        `query ($id: ID!) { memo(id: $id) { id title body ownerId } }`,
        owner.user,
        { id: mine.externalId }
      );

      expect(errors).toBeUndefined();
      expect(data.memo).toEqual({
        body: 'the whole point',
        id: mine.externalId,
        ownerId: owner.user.externalId,
        title: 'Mine',
      });
    });

    // The identifier rules, from the other side: the primary key is not an
    // identifier anything outside the server may use
    test('answers null to the primary key', async () => {
      const { data } = await ask(
        `query ($id: ID!) { memo(id: $id) { id } }`,
        owner.user,
        { id: String(mine._id) }
      );

      expect(data.memo).toBeNull();
    });

    // A refusal and a record that is not there are the same answer
    test('answers null to somebody the policy refuses', async () => {
      const refused = await ask(
        `query ($id: ID!) { memo(id: $id) { id } }`,
        stranger.user,
        { id: mine.externalId }
      );
      const unknown = await ask(
        `query ($id: ID!) { memo(id: $id) { id } }`,
        owner.user,
        { id: '0195f0d0-0000-7000-8000-000000000000' }
      );

      expect(refused.data.memo).toBeNull();
      expect(refused.errors).toBeUndefined();
      expect(unknown.data.memo).toEqual(refused.data.memo);
    });

    test('answers a page filtered by the policy scope', async () => {
      const { data, errors } = await ask(
        `{ memos { total records { id title } } }`,
        owner.user
      );

      expect(errors).toBeUndefined();
      expect(data.memos.total).toBeGreaterThan(0);
      expect(data.memos.records).toEqual(
        expect.arrayContaining([{ id: mine.externalId, title: 'Mine' }])
      );

      const other = await ask(
        `{ memos { total records { id } } }`,
        stranger.user
      );

      expect(other.data.memos.total).toBe(0);
    });

    // Policies fail closed, and a visitor nobody signed in is nobody
    test('answers an empty page to an anonymous visitor', async () => {
      const { data } = await ask(`{ memos { total records { id } } }`);

      expect(data.memos).toEqual({ records: [], total: 0 });
    });

    test('narrows the page with the where argument, under the scope', async () => {
      const matching = await ask(
        `{ memos(where: { title: "Mine" }) { total } }`,
        owner.user
      );
      const missing = await ask(
        `{ memos(where: { title: "Somebody else's" }) { total } }`,
        owner.user
      );

      expect(matching.data.memos.total).toBe(1);
      expect(missing.data.memos.total).toBe(0);
    });

    test('serializes a date as ISO 8601, the way the JSON answer does', async () => {
      const { data } = await ask(
        `query ($id: ID!) { memo(id: $id) { createdAt } }`,
        owner.user,
        { id: mine.externalId }
      );

      expect(data.memo.createdAt).toEqual(mine.createdAt.toISOString());
    });
  });

  describe('writing', () => {
    test('creates a record, resolving a reference from its externalId', async () => {
      const { data, errors } = await ask(
        `mutation ($input: MemoInput!) { createMemo(input: $input) { id title ownerId } }`,
        owner.user,
        {
          input: {
            body: 'written',
            ownerId: owner.user.externalId,
            title: 'New',
          },
        }
      );

      expect(errors).toBeUndefined();
      expect(data.createMemo.ownerId).toEqual(owner.user.externalId);

      const written = await Memo.findById(data.createMemo.id);

      expect(String(written.ownerId)).toEqual(String(owner.user._id));
    });

    test('refuses a reference that names no row', async () => {
      const { errors } = await ask(
        `mutation ($input: MemoInput!) { createMemo(input: $input) { id } }`,
        owner.user,
        {
          input: {
            ownerId: '0195f0d0-0000-7000-8000-000000000001',
            title: 'No',
          },
        }
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].extensions.henri).toBe(
        'HENRI_API_GRAPHQL_UNKNOWN_REFERENCE'
      );
      expect(errors[0].extensions.code).toBe('BAD_USER_INPUT');
    });

    test('refuses a create the policy refuses', async () => {
      const { errors } = await ask(
        `mutation ($input: MemoInput!) { createMemo(input: $input) { id } }`,
        null,
        { input: { title: 'Nope' } }
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].extensions.henri).toBe('HENRI_API_GRAPHQL_DENIED');
    });

    test('updates a record its owner owns, and nobody else', async () => {
      const mine2 = await Memo.create({
        ownerId: String(owner.user._id),
        title: 'Before',
      });
      const refused = await ask(
        `mutation ($id: ID!) { updateMemo(id: $id, input: { title: "Theirs" }) { id } }`,
        stranger.user,
        { id: mine2.externalId }
      );

      expect(refused.data.updateMemo).toBeNull();

      const { data } = await ask(
        `mutation ($id: ID!) { updateMemo(id: $id, input: { title: "After" }) { title } }`,
        owner.user,
        { id: mine2.externalId }
      );

      expect(data.updateMemo.title).toBe('After');
      expect((await Memo.findById(mine2.externalId)).title).toBe('After');
    });

    test('deletes a record and answers the one it removed', async () => {
      const doomed = await Memo.create({
        ownerId: String(owner.user._id),
        title: 'Doomed',
      });
      const { data } = await ask(
        `mutation ($id: ID!) { deleteMemo(id: $id) { id title } }`,
        owner.user,
        { id: doomed.externalId }
      );

      expect(data.deleteMemo).toEqual({
        id: doomed.externalId,
        title: 'Doomed',
      });
      expect(await Memo.findById(doomed.externalId)).toBeNull();
    });
  });

  // What the user model would generate, against the same privacy map the
  // boot built. The demo does not serve it; what matters is what it leaves
  // out, and that henri reads it off the model rather than off a list
  describe('what is never generated', () => {
    const generated = () =>
      describeModels(
        henri.model.models.map((model) =>
          model.identity === 'user' ? { ...model, graphql: true } : model
        ),
        henri.config
      ).find((entry) => entry.model === 'User');

    test('leaves the password out, from the privacy map', () => {
      const description = generated();

      expect(description.fields.map((field) => field.name)).not.toContain(
        'password'
      );
      expect(description.refusals).toContainEqual({
        field: 'password',
        reason: 'private',
        what: 'field',
      });
    });

    test('leaves a field marked expose: false out', () => {
      const names = generated().fields.map((field) => field.name);

      // The demo marks `gender` and `nationalId` `personal: { expose: false }`
      expect(names).not.toContain('gender');
      expect(names).not.toContain('nationalId');
      expect(names).toContain('name');
    });

    test('never makes a randomised encrypted field an argument', () => {
      const description = generated();

      // `phone` is `encrypted: true` and `expose: false`, so it is neither;
      // what proves the rule on its own is the refusal of the argument
      expect(description.filters.map((filter) => filter.name)).not.toContain(
        'phone'
      );
    });

    test('never makes a personal field an argument', () => {
      const description = generated();

      expect(description.fields.map((field) => field.name)).toContain('age');
      expect(description.filters.map((filter) => filter.name)).not.toContain(
        'age'
      );
      expect(description.refusals).toContainEqual({
        field: 'age',
        reason: 'personal',
        what: 'filter',
      });
    });

    test('reads the whole definition back with henri graphql', () => {
      const sdl = sdlOf(generated());

      expect(sdl).toContain('type User {');
      expect(sdl).toContain('  id: ID!');
      // `passwordChangedAt` is a column henri writes and publishes; the
      // password itself is the one the privacy map hides
      expect(sdl).not.toContain('  password:');
      expect(sdl).not.toContain('nationalId');
    });
  });
});
