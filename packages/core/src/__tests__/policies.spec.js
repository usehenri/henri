/* global Memo */
const supertest = require('supertest');
const Henri = require('../henri');
const {
  ANONYMOUS,
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
  test('policiesConfig defaults to a 404, to challenging and to verifying', () => {
    expect(policiesConfig(null)).toEqual({
      anonymous: 'challenge',
      status: 404,
      verify: true,
    });
  });

  test('policiesConfig reads what the application asked for', () => {
    const config = {
      get: () => ({ anonymous: 'uniform', status: 403, verify: false }),
      has: () => true,
    };

    expect(policiesConfig(config)).toEqual({
      anonymous: 'uniform',
      status: 403,
      verify: false,
    });
  });

  test('policiesConfig ignores a status henri does not answer', () => {
    const config = { get: () => ({ status: 418 }), has: () => true };

    expect(policiesConfig(config).status).toBe(404);
  });

  test('policiesConfig ignores an anonymous answer henri does not have', () => {
    const config = { get: () => ({ anonymous: 'hide' }), has: () => true };

    // Not a third behaviour, and not a boot failure here either: the schema
    // refuses the value before this ever runs (base/config-schema.js)
    expect(policiesConfig(config).anonymous).toBe('challenge');
    expect(ANONYMOUS).toEqual(['challenge', 'uniform']);
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

  /** A uuid v7 shaped id no record has */
  const gone = '01a00000-0000-7000-8000-000000000000';

  /**
   * Runs a body with the instance believing it is in production, which is
   * the switch `base/http.js` reads. The suite runs under `NODE_ENV=test`,
   * and what is being asserted is what a deployment answers.
   *
   * Both indistinguishability blocks below use it -- the signed-in half and
   * the anonymous one -- because both are about what leaves a deployment.
   *
   * @param {function} fn what to run
   * @returns {Promise<*>} whatever it answered
   */
  const asProduction = async (fn) => {
    Object.assign(henri, { isDev: false, isProduction: true, isTest: false });

    try {
      return await fn();
    } finally {
      Object.assign(henri, {
        isDev: false,
        isProduction: false,
        isTest: true,
      });
    }
  };

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

  // The property, not an example: the refusal and the absence have to be
  // one answer, so these assert the two are *equal* rather than checking
  // each against a sentence. Either side gaining a word fails them.
  describe('a refusal and a record that is not there are one answer', () => {
    /**
     * The two answers a stranger gets: the memo somebody else owns, and a
     * memo that does not exist
     *
     * @param {object} send `(agent) => supertest request`, given the id
     * @param {string} accept the Accept header
     * @returns {Promise<Array<object>>} the refused answer, then the absent one
     */
    const pair = (send, accept) =>
      Promise.all(
        [mine.externalId, gone].map((id) =>
          send(id).set('Accept', accept).set('X-CSRF-Token', stranger.csrf)
        )
      );

    test('the JSON bodies are identical, on the path res.resource() guards', async () => {
      const [refused, absent] = await asProduction(() =>
        pair((id) => stranger.agent.get(`/memos/${id}`), 'application/json')
      );

      expect(refused.status).toBe(absent.status);
      expect(refused.body).toEqual(absent.body);
      expect(refused.text).toBe(absent.text);
      expect(refused.body.message).toBe('Not Found');
    });

    test('and on the path req.authorize() throws from', async () => {
      const [refused, absent] = await asProduction(() =>
        pair(
          (id) => stranger.agent.patch(`/memos/${id}`).send({ title: 'x' }),
          'application/json'
        )
      );

      expect(refused.status).toBe(absent.status);
      expect(refused.body).toEqual(absent.body);
      // The stack of a thrown refusal is a development detail, and a
      // record that is not there never had one to answer with
      expect(refused.body.data).toBeUndefined();
    });

    test('the pages a browser gets are identical too', async () => {
      const [refused, absent] = await asProduction(() =>
        pair((id) => stranger.agent.get(`/memos/${id}`), 'text/html')
      );

      expect(refused.text).toBe(absent.text);
      expect(refused.headers['content-type']).toBe(
        absent.headers['content-type']
      );
      // `res.boom` answers JSON whatever the client asked for and
      // `res.notFound` negotiates, which is what makes these two the same
      // shape and not only the same words
      expect(refused.headers.vary).toBe(absent.headers.vary);
      expect(refused.text).toContain('404 Not Found');
    });

    test('a HAL client gets the envelope, not the text branch', async () => {
      // The showcase asks with `Accept: application/hal+json`, which is how
      // a client of this API spells JSON. `res.format()` matches its keys
      // literally, so before the HAL branch existed the negotiated 404 fell
      // through to text/plain -- which `res.boom.notFound()` never did, and
      // which every controller answering `res.notFound()` would have
      // inherited the moment it stopped using boom
      const [refused, absent] = await asProduction(() =>
        pair((id) => stranger.agent.get(`/memos/${id}`), 'application/hal+json')
      );

      for (const answer of [refused, absent]) {
        expect(answer.status).toBe(404);
        expect(answer.headers['content-type']).toContain(
          'application/hal+json'
        );
        expect(JSON.parse(answer.text)).toEqual({
          error: 'Not Found',
          message: 'Not Found',
          statusCode: 404,
        });
      }

      expect(refused.text).toBe(absent.text);
    });

    test('a developer is still told which of the two it was', async () => {
      const [refused, absent] = await pair(
        (id) => stranger.agent.get(`/memos/${id}`),
        'application/json'
      );

      // Outside production, and only there: this is the half of the trade
      // that keeps the framework usable, and it has to keep working
      expect(refused.body.message).toBe('Not allowed to show this memo');
      expect(absent.body.message).toBe(`Memo ${gone} not found`);
    });

    test('an application that asked for 403 keeps its message everywhere', () => {
      // `config.policies.status: 403` is an application saying it would
      // rather tell them; the message is the useful half of that answer
      const refusal = new PolicyError({
        action: 'show',
        policy: 'memo',
        status: 403,
      });

      expect(refusal.expose).toBe(true);
      expect(refusal.message).toBe('Not allowed to show this memo');

      expect(
        new PolicyError({ action: 'show', policy: 'memo', status: 404 }).expose
      ).toBe(false);
    });
  });

  // The other half of the same property, for the visitor who is not signed
  // in. `config.policies.anonymous` is the switch, and both of its values
  // are asserted: with `uniform` the two answers are *equal*, and with
  // `challenge` -- the default -- the documented difference is still there,
  // so nothing closes by accident and nothing regresses in silence.
  describe('the anonymous half, and the key that closes it', () => {
    /**
     * Runs a body with `config.policies.anonymous` set to a value.
     *
     * The settings object is what `refusal()` reads per request, so this
     * moves the same knob `policiesConfig()` fills at boot without booting
     * a second application (the demo boots once per file, see beforeAll).
     *
     * @param {string} value `challenge` or `uniform`
     * @param {function} fn what to run
     * @returns {Promise<*>} whatever it answered
     */
    const asAnonymousMode = async (value, fn) => {
      const before = henri.policies.settings.anonymous;

      henri.policies.settings.anonymous = value;

      try {
        return await fn();
      } finally {
        henri.policies.settings.anonymous = before;
      }
    };

    /**
     * The two answers a visitor who is not signed in gets: the memo
     * somebody owns, and a memo that does not exist. No agent, so no
     * session cookie -- which is also what waives the CSRF check for the
     * mutating half (see base/csrf.js)
     *
     * @param {function} send `(id) => supertest request`
     * @param {string} accept the Accept header
     * @returns {Promise<Array<object>>} the refused answer, then the absent one
     */
    const strangers = (send, accept) =>
      Promise.all(
        [mine.externalId, gone].map((id) =>
          send(id).set('Accept', accept).redirects(0)
        )
      );

    describe('with "uniform"', () => {
      test('the JSON bodies are identical, on the path res.resource() guards', async () => {
        const [refused, absent] = await asAnonymousMode('uniform', () =>
          asProduction(() =>
            strangers((id) => request.get(`/memos/${id}`), 'application/json')
          )
        );

        expect(refused.status).toBe(absent.status);
        expect(refused.status).toBe(404);
        expect(refused.body).toEqual(absent.body);
        expect(refused.text).toBe(absent.text);
        expect(refused.headers['content-type']).toBe(
          absent.headers['content-type']
        );
        expect(refused.headers.vary).toBe(absent.headers.vary);
        expect(refused.body.message).toBe('Not Found');
      });

      test('and on the path req.authorize() throws from', async () => {
        const [refused, absent] = await asAnonymousMode('uniform', () =>
          asProduction(() =>
            strangers(
              (id) => request.patch(`/memos/${id}`).send({ title: 'x' }),
              'application/json'
            )
          )
        );

        expect(refused.status).toBe(absent.status);
        expect(refused.status).toBe(404);
        expect(refused.body).toEqual(absent.body);
        expect(refused.headers.vary).toBe(absent.headers.vary);
        // A thrown refusal carries a stack and a code; neither leaves, and
        // a record that never existed had neither to answer with
        expect(refused.body.data).toBeUndefined();
        expect(refused.body.code).toBeUndefined();
      });

      test('the pages a browser gets are identical, Location included', async () => {
        const [refused, absent] = await asAnonymousMode('uniform', () =>
          asProduction(() =>
            strangers((id) => request.get(`/memos/${id}`), 'text/html')
          )
        );

        expect(refused.status).toBe(absent.status);
        expect(refused.text).toBe(absent.text);
        expect(refused.headers['content-type']).toBe(
          absent.headers['content-type']
        );
        expect(refused.headers.vary).toBe(absent.headers.vary);
        // The one that would have leaked through a header rather than a
        // body: a 404 page that still said where to log in
        expect(refused.headers.location).toBeUndefined();
        expect(absent.headers.location).toBeUndefined();
        expect(refused.text).toContain('404 Not Found');
      });

      test('a HAL client gets the same envelope for both', async () => {
        const [refused, absent] = await asAnonymousMode('uniform', () =>
          asProduction(() =>
            strangers(
              (id) => request.get(`/memos/${id}`),
              'application/hal+json'
            )
          )
        );

        for (const answer of [refused, absent]) {
          expect(answer.status).toBe(404);
          expect(answer.headers['content-type']).toContain(
            'application/hal+json'
          );
        }

        expect(refused.text).toBe(absent.text);
      });

      test('the gate answers it too: one rule, no exception', async () => {
        // `index` is decided before any lookup and so gives nothing away,
        // and it is *still* uniform: a key whose meaning depended on
        // whether the rule took a record would be a rule with a hole in
        // it, and this is the affordance the guide says the key costs
        const [gate, roles] = await asAnonymousMode('uniform', () =>
          asProduction(() =>
            Promise.all(
              ['/memos', '/admin'].map((path) =>
                request.get(path).set('Accept', 'text/html').redirects(0)
              )
            )
          )
        );

        expect(gate.status).toBe(404);
        expect(gate.headers.location).toBeUndefined();

        // A `roles` on the route is untouched: it refuses before the
        // lookup for a reason that has nothing to do with any record, so
        // it keeps the login page whatever this key says
        expect(roles.status).toBe(302);
        expect(roles.headers.location).toBe('/login');
      });

      test('a signed-in stranger is answered exactly as before', async () => {
        // The half #418 closed does not move: the key is only ever read
        // when there is no user
        const [refused, absent] = await asAnonymousMode('uniform', () =>
          asProduction(() =>
            Promise.all(
              [mine.externalId, gone].map((id) =>
                stranger.agent
                  .get(`/memos/${id}`)
                  .set('Accept', 'application/json')
              )
            )
          )
        );

        expect(refused.status).toBe(404);
        expect(refused.body).toEqual(absent.body);
      });

      test('the account flows still answer one thing at one price', async () => {
        // `base/accounts.js` writes its answer before it looks anything up,
        // deliberately, and this key has nothing to do with it. Asserted
        // here because a change to what a refusal says is exactly the kind
        // of change that would quietly reach the flows
        const [known, unknown] = await asAnonymousMode('uniform', () =>
          asProduction(() =>
            Promise.all(
              [ownerEmail, 'nobody-at-all@usehenri.io'].map((email) =>
                request
                  .post('/password/forgot')
                  .set('Accept', 'application/json')
                  .send({ email })
              )
            )
          )
        );

        expect(known.status).toBe(202);
        expect(known.status).toBe(unknown.status);
        expect(known.body).toEqual(unknown.body);
      });
    });

    describe('with "challenge", the default', () => {
      test('the JSON answers still differ, which is what the key is for', async () => {
        const [refused, absent] = await asAnonymousMode('challenge', () =>
          asProduction(() =>
            strangers((id) => request.get(`/memos/${id}`), 'application/json')
          )
        );

        expect(refused.status).toBe(401);
        expect(absent.status).toBe(404);
        expect(refused.body).not.toEqual(absent.body);
      });

      test('a browser is asked to sign in for the one that exists', async () => {
        const [refused, absent] = await asAnonymousMode('challenge', () =>
          asProduction(() =>
            strangers((id) => request.get(`/memos/${id}`), 'text/html')
          )
        );

        expect(refused.status).toBe(302);
        expect(refused.headers.location).toBe('/login');
        expect(absent.status).toBe(404);
      });

      test('and it is the default: nothing changes for an application that says nothing', () => {
        expect(henri.policies.settings.anonymous).toBe('challenge');
      });
    });

    test('the refusal itself is what carries the decision', () => {
      // Below the HTTP layer, so the property is readable in one place:
      // under `uniform` an anonymous refusal *is* the signed-in one
      const anonymous = () => henri.policies.refusal(null, 'show', null, {});

      expect(anonymous()).toMatchObject({ redirect: '/login', status: 401 });

      henri.policies.settings.anonymous = 'uniform';

      try {
        expect(anonymous()).toMatchObject({ redirect: null, status: 404 });
        expect(anonymous().expose).toBe(false);
        // A caller naming a status still wins, whoever is asking
        expect(
          henri.policies.refusal(null, 'show', null, { status: 403 }).status
        ).toBe(403);
      } finally {
        henri.policies.settings.anonymous = 'challenge';
      }
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
      await expect(
        henri.policies.scope(null, 'scopeless')
      ).rejects.toMatchObject({ code: 'HENRI_POLICY_SCOPE_REQUIRED' });
      await expect(henri.policies.scope(null, 'ghost')).rejects.toThrow(
        /scope\(name\) names the string "ghost"/u
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
