const supertest = require('supertest');
const Henri = require('../henri');
const SessionStoreProxy = require('../base/session-store');

const email = 'ada@usehenri.io';
const password = 'analytical-engine';
const TOKEN = /^[a-f0-9]{48}$/;

/**
 * Reads a cookie value from a response
 *
 * @param {object} res supertest response
 * @param {string} name cookie name
 * @returns {?string} the value or null when the cookie was not set
 */
const cookieOf = (res, name) => {
  const line = cookieLine(res, name);

  return line ? line.split(';')[0].slice(name.length + 1) : null;
};

/**
 * Reads a whole Set-Cookie line from a response
 *
 * @param {object} res supertest response
 * @param {string} name cookie name
 * @returns {string} the line or an empty string
 */
const cookieLine = (res, name) =>
  (res.headers['set-cookie'] || []).find((cookie) =>
    cookie.startsWith(`${name}=`)
  ) || '';

describe('auth (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let agent;
  let csrf;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    // Demo controllers use the henri global, like any app would
    global.henri = henri;
    app = henri.server.app;
    agent = supertest.agent(app);
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

  describe('csrf cookie', () => {
    test('is set on the first request, readable by scripts, without a session', async () => {
      const res = await agent.get('/artwork');

      csrf = cookieOf(res, 'henri.csrf');

      expect(res.status).toBe(200);
      expect(csrf).toMatch(TOKEN);
      expect(cookieLine(res, 'henri.csrf')).not.toMatch(/HttpOnly/i);
      expect(cookieLine(res, 'henri.csrf')).toMatch(/SameSite=Lax/i);
      // Anonymous visitors get no session (saveUninitialized: false)
      expect(cookieOf(res, 'henri.sid')).toBeNull();
    });

    test('is kept once set', async () => {
      const res = await agent.get('/artwork');

      expect(cookieOf(res, 'henri.csrf')).toBeNull();
    });
  });

  describe('register', () => {
    test('creates the user from permitted fields only and answers the public user', async () => {
      const res = await agent.post('/register').send({
        createdAt: '1815-12-10',
        email: ' Ada@UseHenri.io ',
        name: 'Ada',
        password,
        roles: ['admin'],
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ok');
      expect(res.body.user).toEqual({
        email,
        id: expect.any(String),
        name: 'Ada',
        roles: ['member'],
      });

      const stored = await henri.user.findByEmail(email);

      expect(Array.from(stored.roles)).toEqual(['member']);
      expect(stored.password).toBeDefined();
      expect(stored.password).not.toBe(password);
    });

    test('rejects a duplicate email', async () => {
      const res = await agent.post('/register').send({ email, password });

      expect(res.status).toBe(409);
    });

    test('rejects missing credentials', async () => {
      const res = await agent.post('/register').send({ email });

      expect(res.status).toBe(400);
    });
  });

  describe('login', () => {
    test('rejects a wrong password with 401', async () => {
      const res = await agent
        .post('/login')
        .send({ email, password: 'not-the-password' });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ statusCode: 401 });
      expect(cookieOf(res, 'henri.sid')).toBeNull();
    });

    test('rejects an unknown email with 401', async () => {
      const res = await agent
        .post('/login')
        .send({ email: 'nobody@usehenri.io', password });

      expect(res.status).toBe(401);
    });

    test('rejects missing credentials with 400', async () => {
      const res = await agent.post('/login').send({});

      expect(res.status).toBe(400);
    });

    test('redirects browsers to the login page on failure', async () => {
      const res = await agent
        .post('/login')
        .set('Accept', 'text/html')
        .type('form')
        .send({ email, password: 'not-the-password' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login?error=invalid');
    });

    test('answers the public user and sets a hardened session cookie', async () => {
      const res = await agent
        .post('/login')
        .send({ email: 'ADA@usehenri.io ', password });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        user: { email, id: expect.any(String), name: 'Ada', roles: ['member'] },
      });

      const line = cookieLine(res, 'henri.sid');

      expect(line).toMatch(/HttpOnly/i);
      expect(line).toMatch(/SameSite=Lax/i);
      expect(line).toMatch(/Expires=/);
      expect(line).not.toMatch(/Secure/);
    });

    test('redirects browsers after a form login', async () => {
      const browser = supertest.agent(app);
      const res = await browser
        .post('/login')
        .set('Accept', 'text/html')
        .type('form')
        .send({ email, password });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(cookieOf(res, 'henri.sid')).toBeTruthy();
    });
  });

  describe('roles', () => {
    test('denies anonymous requests: 401 for json, redirect for html', async () => {
      const anonymous = supertest(app);
      const json = await anonymous.get('/profile');
      const html = await anonymous.get('/profile').set('Accept', 'text/html');

      expect(json.status).toBe(401);
      expect(html.status).toBe(302);
      expect(html.headers.location).toBe('/login');
    });

    test('lets a member through with only the public user in the view options', async () => {
      const res = await agent.get('/profile').set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({
        email,
        id: expect.any(String),
        name: 'Ada',
        roles: ['member'],
      });
      expect(res.body.csrf).toBe(csrf);
      expect(res.body.paths).toHaveProperty('profile_user_path');
      expect(res.body.paths).not.toHaveProperty('admin_user_path');
    });

    test('renders html for browsers', async () => {
      const res = await agent.get('/profile').set('Accept', 'text/html');

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<form/);
    });

    test('denies a missing role: 403 for json, redirect for html', async () => {
      const json = await agent.get('/admin');
      const html = await agent.get('/admin').set('Accept', 'text/html');

      expect(json.status).toBe(403);
      expect(json.body.data).toEqual({ roles: ['admin'] });
      expect(html.status).toBe(302);
      expect(html.headers.location).toBe('/login');
    });
  });

  describe('csrf', () => {
    test('rejects unsafe requests carrying a session but no token', async () => {
      const res = await agent.post('/artwork').send({ title: 'none', year: 1 });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Invalid CSRF token');
    });

    test('rejects a wrong token', async () => {
      const res = await agent
        .post('/artwork')
        .set('X-CSRF-Token', csrf.replace(/./g, '0'))
        .send({ title: 'wrong', year: 1 });

      expect(res.status).toBe(403);
    });

    test('accepts the token in the X-CSRF-Token header', async () => {
      const res = await agent
        .post('/artwork')
        .set('X-CSRF-Token', csrf)
        .send({ title: 'Notes', year: 1843 });

      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Notes');
      expect(res.body._links.self.href).toBe(`/artwork/${res.body.id}`);
      expect(res.headers.location).toBe(`/artwork/${res.body.id}`);
    });

    test('accepts the token in the _csrf body field', async () => {
      const res = await agent
        .post('/artwork')
        .type('form')
        .send({ _csrf: csrf, title: 'Sketch', year: 1842 });

      expect(res.status).toBe(201);
    });

    test('exempts bearer token requests', async () => {
      const res = await agent
        .post('/artwork')
        .set('Authorization', 'Bearer not-a-real-token')
        .send({ title: 'jwt', year: 1 });

      expect(res.status).toBe(201);
    });

    test('does not apply without a session cookie', async () => {
      const res = await supertest(app)
        .post('/artwork')
        .send({ title: 'anonymous', year: 1 });

      expect(res.status).toBe(201);
    });

    test('is exposed to the views', async () => {
      const res = await agent.get('/artwork').set('Accept', 'application/json');

      expect(res.body.csrf).toBe(csrf);
    });
  });

  describe('permit', () => {
    test('henri.params(req).permit picks the listed fields only', () => {
      const req = {
        body: { name: 'Ada', roles: ['admin'] },
        params: { id: '42' },
        query: { name: 'from-query', page: '2' },
      };

      expect(
        henri.params(req).permit('name', 'id', 'roles', 'missing')
      ).toEqual({
        id: '42',
        name: 'Ada',
        roles: ['admin'],
      });
      expect(henri.params(req).permit(['page'])).toEqual({ page: '2' });
    });
  });

  describe('logout', () => {
    test('GET /logout is deprecated and changes nothing', async () => {
      const res = await agent.get('/logout');

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('POST');
      expect((await agent.get('/profile')).status).toBe(200);
    });

    test('POST /logout destroys the session', async () => {
      const res = await agent.post('/logout').set('X-CSRF-Token', csrf);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect((await agent.get('/profile')).status).toBe(401);
    });

    test('POST /logout redirects browsers', async () => {
      const res = await agent.post('/logout').set('Accept', 'text/html');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
    });
  });

  describe('session store', () => {
    test('is a proxy resolving the adapter store', () => {
      expect(henri.user.sessionStore).toBeInstanceOf(SessionStoreProxy);
      expect(henri.user.sessionStore.store()).not.toBeNull();
    });

    test('survives a model reload', async () => {
      const before = henri.user.sessionStore.store();

      await henri.model.reload();

      // The test disk store is in memory: the users are gone with the reload
      const browser = supertest.agent(app);

      expect(
        (await browser.post('/register').send({ email, name: 'Ada', password }))
          .status
      ).toBe(201);
      expect(
        (await browser.post('/login').send({ email, password })).status
      ).toBe(200);
      expect((await browser.get('/profile')).status).toBe(200);
      expect(henri.user.sessionStore.store()).not.toBe(before);
    }, 60000);
  });

  describe('without a user model', () => {
    test('warns when a roles route is registered', () => {
      const model = henri._user;
      const { warn } = henri.pen;
      const warnings = [];

      henri.pen.warn = (...args) => warnings.push(args.join(' '));
      henri._user = null;

      try {
        henri.router.register({
          controller: 'user#admin',
          opts: {},
          roles: ['admin'],
          route: '/_needs_roles',
          verb: 'get',
        });
      } finally {
        henri.pen.warn = warn;
        henri._user = model;
      }

      expect(warnings.some((line) => /no user model/.test(line))).toBe(true);
    });

    test('answers 401 instead of crashing', async () => {
      const model = henri._user;

      henri._user = null;

      try {
        const res = await agent.get('/profile');

        expect(res.status).toBe(401);
      } finally {
        henri._user = model;
      }
    });
  });
});
