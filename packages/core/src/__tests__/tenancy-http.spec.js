// The tenant of a real request, on a booted application.
//
// `tenancy.spec.js` proves the rules and the adapters prove the condition;
// what is left is the wiring, and it is the part a unit test cannot see: that
// the middleware is mounted at all, that it is mounted *after* passport (so
// the signed-in user's own record is what a subdomain is checked against),
// that a mismatch reaches the error handler as the configured status, and
// that a sign-in on somebody else's subdomain opens no session.
//
// The demo application is booted with `config.tenancy` supplied through the
// environment, which is also a small proof of its own: the key is one henri
// owns, so `HENRI_CONFIG_JSON__tenancy` reaches it like any other.
//
// `tenancy.from.user` names `name` here rather than a column of its own,
// because the demo's user model has no tenant column and adding one would
// change every other suite that boots it. It reads oddly and it exercises
// exactly the right thing: a person called `ada` belongs to the tenant
// `ada`.
const supertest = require('supertest');

const Henri = require('../henri');

const password = 'compiler-1952';

describe('the tenant of a request', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  const configured = process.env.HENRI_CONFIG_JSON__tenancy;
  let henri;
  let app;
  let User;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    process.env.HENRI_CONFIG_JSON__tenancy = JSON.stringify({
      from: { subdomain: 'example.com', user: 'name' },
    });

    henri = new Henri();

    // Mounted by the router, which is after the user module and therefore
    // after the tenancy middleware: what it reports is what an action sees
    henri.addMiddleware('tenant-probe', (router) => {
      router.get('/_tenant', (req, res) =>
        res.json({
          source: req.tenantSource,
          tenant: req.tenant,
          user: req.user ? req.user.name : null,
        })
      );
    });

    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    User = global.User;

    await User.create({
      email: 'ada@example.com',
      name: 'ada',
      password,
    });
  });

  afterAll(async () => {
    await henri.stop();
    delete global.henri;

    if (typeof skipWorkers === 'undefined') {
      delete process.env.SKIP_WORKERS;
    } else {
      process.env.SKIP_WORKERS = skipWorkers;
    }

    if (typeof configured === 'undefined') {
      delete process.env.HENRI_CONFIG_JSON__tenancy;
    } else {
      process.env.HENRI_CONFIG_JSON__tenancy = configured;
    }
  });

  /**
   * Signs in and returns an agent holding the session
   *
   * @param {string} host the Host header to sign in under
   * @returns {Promise<object>} `{ agent, status }`
   */
  const signIn = async (host) => {
    const agent = supertest.agent(app);
    const start = await agent.get('/login').set('Host', host);
    const csrf = (start.headers['set-cookie'] || [])
      .map((line) => line.split(';')[0])
      .find((line) => line.startsWith('henri.csrf='));
    const { status } = await agent
      .post('/login')
      .set('Host', host)
      .set('X-CSRF-Token', csrf ? csrf.slice('henri.csrf='.length) : '')
      .send({ email: 'ada@example.com', password });

    return { agent, status };
  };

  test('it is on, and the boot said where it comes from', () => {
    expect(henri.tenancy.enabled).toBe(true);
    expect(henri.tenancy.sources()).toEqual(['explicit', 'user', 'subdomain']);
  });

  test('a subdomain decides it for an anonymous visitor, and says so', async () => {
    const { body } = await supertest(app)
      .get('/_tenant')
      .set('Host', 'acme.example.com')
      .expect(200);

    expect(body).toEqual({ source: 'subdomain', tenant: 'acme', user: null });
  });

  test('the bare domain decides nothing, and is still served', async () => {
    const { body } = await supertest(app)
      .get('/_tenant')
      .set('Host', 'example.com')
      .expect(200);

    expect(body).toEqual({ source: null, tenant: null, user: null });
  });

  test("a signed-in person's own record wins over the subdomain", async () => {
    const { agent, status } = await signIn('ada.example.com');

    expect(status).toBe(200);

    const { body } = await agent
      .get('/_tenant')
      .set('Host', 'ada.example.com')
      .expect(200);

    expect(body).toEqual({ source: 'user', tenant: 'ada', user: 'ada' });
  });

  test('and a request naming another tenant is refused', async () => {
    const { agent } = await signIn('ada.example.com');
    const refused = await agent
      .get('/_tenant')
      .set('Accept', 'application/json')
      .set('Host', 'globex.example.com');

    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe('HENRI_TENANT_MISMATCH');
    // The message says which tenant was expected, so it does not leave a
    // production process -- the rule a policy refusal already follows. This
    // is a test process, so it is spoken here
    expect(refused.body.message).toContain('globex');
  });

  test("signing in on somebody else's subdomain opens no session", async () => {
    const { agent, status } = await signIn('globex.example.com');

    // The credentials were right; the tenant was not, so no session was
    // opened at all rather than one that dies on its next request
    expect(status).toBe(401);

    const { body } = await agent
      .get('/_tenant')
      .set('Host', 'example.com')
      .expect(200);

    expect(body.user).toBeNull();
  });
});
