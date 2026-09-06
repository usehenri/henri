/* global Memo */
const supertest = require('supertest');
const Henri = require('../henri');
const {
  PolicyError,
  identityOf,
  needsRecord,
  parseHelper,
  policiesConfig,
} = require('../base/policies');

const password = 'difference-engine';
const ownerEmail = 'owner@usehenri.io';
const strangerEmail = 'stranger@usehenri.io';
const adminEmail = 'boss@usehenri.io';

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
 * Registers and logs a user in, answering an agent and its csrf token
 *
 * @param {object} app the express app
 * @param {string} email the email
 * @param {Array<string>} [roles=null] roles to grant before the login
 * @returns {Promise<{agent: object, csrf: string, user: object}>} the agent
 */
const signUp = async (app, email, roles = null) => {
  const agent = supertest.agent(app);
  const registered = await agent
    .post('/register')
    .send({ email, name: email.split('@')[0], password });

  if (registered.status !== 201) {
    throw new Error(`unable to register ${email}: ${registered.status}`);
  }

  const user = await henri.user.findByEmail(email);

  if (roles) {
    await user.setRoles(roles);
  }

  const logged = await agent.post('/login').send({ email, password });

  if (logged.status !== 200) {
    throw new Error(`unable to log ${email} in: ${logged.status}`);
  }

  return { agent, csrf: cookieOf(registered, 'henri.csrf'), user };
};

describe('policies (the pieces)', () => {
  test('policiesConfig defaults to a 404 and to verifying', () => {
    expect(policiesConfig(null)).toEqual({ status: 404, verify: true });
  });

  test('policiesConfig reads what the application asked for', () => {
    const config = {
      get: () => ({ status: 403, verify: false }),
      has: () => true,
    };

    expect(policiesConfig(config)).toEqual({ status: 403, verify: false });
  });

  test('policiesConfig ignores a status henri does not answer', () => {
    const config = { get: () => ({ status: 418 }), has: () => true };

    expect(policiesConfig(config).status).toBe(404);
  });

  test('policiesConfig refuses a value that is not an object', () => {
    const config = { get: () => 'yes', has: () => true };

    expect(() => policiesConfig(config)).toThrow(/must be an object/u);
  });

  test('needsRecord is what tells a member rule from a collection one', () => {
    expect(needsRecord((user) => Boolean(user))).toBe(false);
    expect(needsRecord((user, record) => Boolean(user && record))).toBe(true);
    // A default is the author saying "ask me either way"
    expect(needsRecord((user, record = null) => Boolean(user || record))).toBe(
      false
    );
    expect(needsRecord(undefined)).toBe(false);
  });

  test('identityOf finds the model of the three ORMs, and gives up on a bag', () => {
    class Mongooseish {}
    Mongooseish.modelName = 'Proposal';

    class Sequelizeish {}
    Sequelizeish.options = { name: { plural: 'reviews', singular: 'review' } };

    class Review {}

    expect(identityOf(new Mongooseish())).toBe('Proposal');
    expect(identityOf(new Sequelizeish())).toBe('review');
    expect(identityOf(new Review())).toBe('Review');
    expect(identityOf({ title: 'a plain object' })).toBeNull();
    expect(identityOf(null)).toBeNull();
    expect(identityOf('nope')).toBeNull();
  });

  test('parseHelper splits a path helper', () => {
    expect(parseHelper('edit_proposals_path')).toEqual({
      action: 'edit',
      controller: 'proposals',
    });
    expect(parseHelper('index_admin/proposals_path')).toEqual({
      action: 'index',
      controller: 'admin/proposals',
    });
    expect(parseHelper('nonsense')).toBeNull();
  });

  test('a PolicyError carries the status and the login page', () => {
    const anonymous = new PolicyError({
      action: 'show',
      redirect: '/login',
      status: 401,
    });

    expect(anonymous.code).toBe('POLICY_DENIED');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.message).toBe('Authentication required');
    expect(anonymous.redirect).toBe('/login');

    expect(new PolicyError({ action: 'update', policy: 'memo' }).message).toBe(
      'Not allowed to update this memo'
    );
  });
});

describe('policies (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let request;
  let owner;
  let stranger;
  let admin;
  let mine;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    request = supertest(app);
    owner = await signUp(app, ownerEmail);
    stranger = await signUp(app, strangerEmail);
    admin = await signUp(app, adminEmail, ['admin']);

    const created = await owner.agent
      .post('/memos')
      .set('Accept', 'application/json')
      .set('X-CSRF-Token', owner.csrf)
      .send({ body: 'the whole point', title: 'Mine' });

    if (created.status !== 201) {
      throw new Error(`unable to create a memo: ${created.status}`);
    }

    mine = created.body;
  }, 60000);

  afterAll(async () => {
    await henri.stop();
    delete global.henri;
    process.env.SKIP_WORKERS = skipWorkers;
  });

  describe('the registry', () => {
    test('loads app/policies and finds them by model or controller name', () => {
      expect(henri.policies.names()).toContain('memo');
      expect(henri.policies.size()).toBeGreaterThan(0);
      expect(henri.policies.resolve('Memo')).toBe('memo');
      expect(henri.policies.resolve('memos')).toBe('memo');
      expect(henri.policies.has('memo')).toBe(true);
      expect(henri.policies.has('ghost')).toBe(false);
      // A namespace is never crossed: admin/memos is a different controller
      expect(henri.policies.resolve('admin/memos')).toBeNull();
    });

    test('rule() answers null for what a policy does not declare', () => {
      expect(typeof henri.policies.rule('memo', 'update')).toBe('function');
      expect(henri.policies.rule('memo', 'new')).toBeNull();
      expect(henri.policies.rule('ghost', 'show')).toBeNull();
      // The keys that describe a policy are never actions
      expect(henri.policies.rule('memo', 'scope')).toBeNull();
    });
  });

  describe('failing closed', () => {
    test('a model with no policy refuses, whoever is asking', async () => {
      expect(await henri.can(admin.user, 'show', null, 'ghost')).toBe(false);
      expect(await henri.can(admin.user, 'show', { id: 1 })).toBe(false);
    });

    test('an action the policy does not mention refuses', async () => {
      const memo = await Memo.findOne({ title: 'Mine' });

      expect(await henri.can(owner.user, 'new', null, 'memo')).toBe(false);
      expect(await henri.can(owner.user, 'archive', memo)).toBe(false);
    });

    test('a rule that throws refuses, it never allows', async () => {
      expect(await henri.can(owner.user, 'boom', null, 'memo')).toBe(false);
      expect(await henri.can(admin.user, 'boom', null, 'memo')).toBe(false);
    });

    test('a rule that needs a record is never asked without one', async () => {
      expect(await henri.can(owner.user, 'show', null, 'memo')).toBe(false);
      expect(await henri.can(owner.user, 'update', undefined, 'memo')).toBe(
        false
      );
    });

    test('only the boolean true allows: truthy is not a yes', async () => {
      henri.policies._policies.set('truthy', {
        show: () => 'yes, obviously',
        wrapped: () => Promise.resolve(1),
      });

      expect(await henri.can({ id: 1 }, 'show', null, 'truthy')).toBe(false);
      expect(await henri.can({ id: 1 }, 'wrapped', null, 'truthy')).toBe(false);

      henri.policies._policies.delete('truthy');
    });

    test('authorize() throws a refusal a browser and an api both understand', async () => {
      const memo = await Memo.findOne({ title: 'Mine' });

      await expect(
        henri.policies.authorize(stranger.user, 'update', memo)
      ).rejects.toMatchObject({ code: 'POLICY_DENIED', statusCode: 404 });

      // Anonymous: log in and try again, which leaks nothing
      await expect(
        henri.policies.authorize(null, 'update', memo)
      ).rejects.toMatchObject({ redirect: '/login', statusCode: 401 });

      // And the record comes back when the answer is yes
      await expect(
        henri.policies.authorize(owner.user, 'update', memo)
      ).resolves.toBe(memo);
    });
  });

  describe('the route gate', () => {
    test('a route naming a policy that does not exist is refused', async () => {
      const res = await request.get('/ghost').set('Accept', 'application/json');

      expect(res.status).toBe(401);

      const signedIn = await admin.agent
        .get('/ghost')
        .set('Accept', 'application/json');

      expect(signedIn.status).toBe(404);
    });

    test('a collection action is decided at the gate, before the action runs', async () => {
      const anonymous = await request
        .get('/memos')
        .set('Accept', 'application/json');

      expect(anonymous.status).toBe(401);

      const signedIn = await stranger.agent
        .get('/memos')
        .set('Accept', 'application/json');

      expect(signedIn.status).toBe(200);
    });

    test('a browser refused while anonymous is sent to the login page', async () => {
      const res = await request.get('/memos').set('Accept', 'text/html');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    test('the gate composes with the role guard rather than replacing it', () => {
      const route = henri.router.routes['get /memos'];

      expect(route.policy).toBe(true);
      // No role on this resource: the policy is the only guard, and the
      // route with a role still has both
      expect(route.roles).toBeUndefined();
      expect(henri.router.routes['get /admin'].roles).toEqual(['admin']);
    });
  });

  describe('a record somebody else owns', () => {
    test('a signed-in stranger gets nothing, not a 403', async () => {
      const res = await stranger.agent
        .get(`/memos/${mine.externalId}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(404);
      expect(res.body.title).toBeUndefined();
    });

    test('the owner reads it', async () => {
      const res = await owner.agent
        .get(`/memos/${mine.externalId}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Mine');
    });

    test('a stranger cannot write it, and the record does not move', async () => {
      const res = await stranger.agent
        .patch(`/memos/${mine.externalId}`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', stranger.csrf)
        .send({ title: 'Hijacked' });

      expect(res.status).toBe(404);
      expect((await Memo.findOne({ title: 'Mine' })).title).toBe('Mine');
    });

    test('a stranger cannot delete it either', async () => {
      const res = await stranger.agent
        .delete(`/memos/${mine.externalId}`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', stranger.csrf);

      expect(res.status).toBe(404);
      expect(await Memo.findOne({ title: 'Mine' })).not.toBeNull();
    });

    test('the admin may delete it: the policy says so, the roles do not', async () => {
      const memo = await Memo.create({ ownerId: 'nobody', title: 'Doomed' });
      const stranded = await stranger.agent
        .delete(`/memos/${memo.externalId}`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', stranger.csrf);

      expect(stranded.status).toBe(404);

      const res = await admin.agent
        .delete(`/memos/${memo.externalId}`)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', admin.csrf);

      expect(res.status).toBe(204);
      expect(await Memo.findById(memo.id)).toBeNull();
    });
  });

  describe('what leaves the server', () => {
    test('_links never carry an action the policy would refuse', async () => {
      const res = await owner.agent
        .get(`/memos/${mine.externalId}`)
        .set('Accept', 'application/json');

      expect(Object.keys(res.body._links).sort()).toEqual([
        'collection',
        'destroy',
        'self',
        'update',
      ]);
      // `new` is not in the policy at all, so no client is ever told about it
      expect(res.body._links.new).toBeUndefined();
    });

    test('a collection filters the links of every record it embeds', async () => {
      const foreign = await Memo.create({
        ownerId: String(stranger.user.id || stranger.user._id),
        title: 'Not yours',
      });
      // The controller scopes the list, so a full read needs the model
      const res = await admin.agent
        .get('/memos')
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body._links.create).toBeDefined();

      const strangers = await stranger.agent
        .get('/memos')
        .set('Accept', 'application/json');

      const titles = strangers.body._embedded.memos.map((one) => one.title);

      expect(titles).toContain('Not yours');
      expect(titles).not.toContain('Mine');

      for (const item of strangers.body._embedded.memos) {
        expect(item._links.update).toBeDefined();
        expect(item._links.destroy).toBeDefined();
      }

      await foreign.deleteOne();
    });

    test('paths lose what a record-less rule refuses, and keep the rest', async () => {
      const anonymous = await request
        .get('/notes')
        .set('Accept', 'application/json');

      expect(anonymous.body.paths.index_memos_path).toBeUndefined();
      expect(anonymous.body.paths.create_memos_path).toBeUndefined();
      // Undecidable without the record: answered on the record's own _links
      expect(anonymous.body.paths.show_memos_path).toBeDefined();
      // A controller with no policy is not touched at all
      expect(anonymous.body.paths.index_notes_path).toBeDefined();

      const signedIn = await owner.agent
        .get('/notes')
        .set('Accept', 'application/json');

      expect(signedIn.body.paths.index_memos_path).toBeDefined();
      expect(signedIn.body.paths.create_memos_path).toBeDefined();
    });
  });

  describe('scoping a list', () => {
    test('the scope decides what a list is, and henri does not read it', async () => {
      const id = String(owner.user.id || owner.user._id);

      expect(await henri.policies.scope(owner.user, 'memo')).toEqual({
        ownerId: id,
      });

      const res = await owner.agent
        .get('/memos')
        .set('Accept', 'application/json');

      expect(res.body._embedded.memos.map((one) => one.title)).toEqual([
        'Mine',
      ]);
    });

    test('a policy with no scope says so instead of meaning everything', async () => {
      henri.policies._policies.set('scopeless', { index: () => true });

      await expect(henri.policies.scope(null, 'scopeless')).rejects.toThrow(
        /declares no scope/u
      );
      await expect(henri.policies.scope(null, 'ghost')).rejects.toThrow(
        /no policy for "ghost"/u
      );

      henri.policies._policies.delete('scopeless');
    });
  });

  describe('a route that declared a policy and never asked it', () => {
    test('res.resource() answers the question the gate could not', async () => {
      // `show` asks nothing itself; the refusal comes from res.resource()
      const res = await stranger.agent
        .get(`/memos/${mine.externalId}`)
        .set('Accept', 'application/json');

      expect(res.status).toBe(404);
    });

    test('an action that answers without asking is reported once', async () => {
      const res = await stranger.agent
        .get(`/memos/${mine.externalId}/peek`)
        .set('Accept', 'application/json');

      // It answered: nothing enforced it, which is exactly the problem
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Mine');

      await new Promise((resolve) => setImmediate(resolve));

      expect(henri.policies._warned.has('verify:get /memos/:id/peek')).toBe(
        true
      );
    });
  });

  describe('req.can and henri.can are the same question', () => {
    test('henri.can infers the policy from the record', async () => {
      const memo = await Memo.findOne({ title: 'Mine' });

      expect(await henri.can(owner.user, 'update', memo)).toBe(true);
      expect(await henri.can(stranger.user, 'update', memo)).toBe(false);
      expect(await henri.can(null, 'update', memo)).toBe(false);
    });

    test('a before rule short-circuits the whole policy', async () => {
      henri.policies._policies.set('gated', {
        before: (user) => (user && user.superpower ? true : undefined),
        show: () => false,
      });

      expect(await henri.can({ superpower: true }, 'show', null, 'gated')).toBe(
        true
      );
      expect(await henri.can({}, 'show', null, 'gated')).toBe(false);

      henri.policies._policies.delete('gated');
    });

    test('a before rule that throws refuses too', async () => {
      henri.policies._policies.set('cursed', {
        before: () => {
          throw new Error('nope');
        },
        show: () => true,
      });

      expect(await henri.can({}, 'show', null, 'cursed')).toBe(false);

      henri.policies._policies.delete('cursed');
    });
  });
});
