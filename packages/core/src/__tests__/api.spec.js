/* global Artwork */
const supertest = require('supertest');
const Henri = require('../henri');
const { keyFor } = require('../base/rate-limit');
const { filterParameters, redact } = require('../base/redact');

const password = 'difference-engine';
const memberEmail = 'grace@usehenri.io';
const adminEmail = 'charles@usehenri.io';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Reads a cookie value from a response
 *
 * @param {object} res supertest response
 * @param {string} name cookie name
 * @returns {?string} the value or null when the cookie was not set
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
 * @param {Array<string>} [roles] roles to grant before the login
 * @returns {Promise<{agent: object, csrf: string}>} the agent and the token
 */
const signUp = async (app, email, roles = null) => {
  const agent = supertest.agent(app);
  const registered = await agent
    .post('/register')
    .send({ email, name: email.split('@')[0], password });

  if (registered.status !== 201) {
    throw new Error(`unable to register ${email}: ${registered.status}`);
  }

  if (roles) {
    const user = await henri.user.findByEmail(email);

    await user.setRoles(roles);
  }

  const logged = await agent.post('/login').send({ email, password });

  if (logged.status !== 200) {
    throw new Error(`unable to log ${email} in: ${logged.status}`);
  }

  return { agent, csrf: cookieOf(registered, 'henri.csrf') };
};

describe('api (demo app, disk store)', () => {
  const skipWorkers = process.env.SKIP_WORKERS;
  let henri;
  let app;
  let request;
  let member;
  let admin;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    app = henri.server.app;
    request = supertest(app);
    member = await signUp(app, memberEmail);
    admin = await signUp(app, adminEmail, ['admin']);
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

  describe('request id', () => {
    test('generates an id and echoes the one sent by the client', async () => {
      const generated = await request.get('/version');
      const echoed = await request
        .get('/version')
        .set('X-Request-Id', 'trace-42');

      expect(generated.headers['x-request-id']).toMatch(UUID);
      expect(echoed.headers['x-request-id']).toBe('trace-42');
    });

    test('replaces an id that does not look like one', async () => {
      const res = await request
        .get('/version')
        .set('X-Request-Id', 'not valid!');

      expect(res.headers['x-request-id']).toMatch(UUID);
    });

    test('is on error responses too', async () => {
      const res = await request
        .get('/nope')
        .set('Accept', 'application/json')
        .set('X-Request-Id', 'trace-404');

      expect(res.status).toBe(404);
      expect(res.headers['x-request-id']).toBe('trace-404');
    });

    test('is written in every pen line of the request', async () => {
      henri.router.handler.get('/_log', (req, res) =>
        res.json({
          id: req.id,
          line: henri.pen.output('api', 'info', 'hello').fullMsg,
        })
      );

      const res = await request.get('/_log').set('X-Request-Id', 'trace-log');

      expect(res.body.id).toBe('trace-log');
      expect(res.body.line).toContain('[trace-log]');
      expect(henri.pen.output('api', 'info', 'outside').fullMsg).not.toContain(
        '['
      );
    });
  });

  describe('secure headers', () => {
    test('helmet headers are on every answer, with a strict csp outside development', async () => {
      const res = await request.get('/version');
      const csp = res.headers['content-security-policy'];

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("img-src 'self' data: blob:");
      expect(csp).not.toContain('unsafe-eval');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('HAL resources', () => {
    let id;
    let url;

    test('create answers 201, a Location header and the resource with its links', async () => {
      const res = await request
        .post('/api/v1/artworks')
        .set('Accept', 'application/json')
        .send({ title: 'Nocturne', year: 1875 });

      expect(res.status).toBe(201);
      // The public identifier is what the payload and the links carry; the
      // document id stays on the server
      id = res.body.externalId;
      url = `/api/v1/artworks/${id}`;
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(res.body.id).toBeUndefined();
      expect(res.body._id).toBeUndefined();
      expect(res.headers.location).toBe(url);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toMatchObject({ title: 'Nocturne', year: 1875 });
      // Anonymous clients may not destroy: no destroy link
      expect(res.body._links).toEqual({
        collection: { href: '/api/v1/artworks' },
        edit: { href: `${url}/edit` },
        self: { href: url },
        update: { href: url, method: 'PATCH' },
      });
    });

    test('show answers application/hal+json when asked for', async () => {
      const res = await request.get(url).set('Accept', 'application/hal+json');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/hal\+json/);
      expect(res.body._links.self.href).toBe(url);
      expect(res.body.title).toBe('Nocturne');
    });

    test('links follow the roles of the user', async () => {
      const asMember = await member.agent
        .get(url)
        .set('Accept', 'application/json');
      const asAdmin = await admin.agent
        .get(url)
        .set('Accept', 'application/json');

      expect(asMember.body._links.destroy).toBeUndefined();
      expect(asAdmin.body._links.destroy).toEqual({
        href: url,
        method: 'DELETE',
      });
    });

    test('update answers the resource', async () => {
      const res = await request
        .patch(url)
        .set('Accept', 'application/json')
        .send({ title: 'Nocturne in Blue' });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Nocturne in Blue');
      expect(res.body._links.self.href).toBe(url);
    });

    test('destroy is denied to anonymous clients and members, and answers 204 to admins', async () => {
      const anonymous = await request.delete(url);
      const denied = await member.agent
        .delete(url)
        .set('X-CSRF-Token', member.csrf);
      // Without Accept: application/json a browser form would be redirected
      const done = await admin.agent
        .delete(url)
        .set('Accept', 'application/json')
        .set('X-CSRF-Token', admin.csrf);
      const gone = await request.get(url).set('Accept', 'application/json');

      expect(anonymous.status).toBe(401);
      expect(denied.status).toBe(403);
      expect(done.status).toBe(204);
      expect(gone.status).toBe(404);
      expect(gone.body).toMatchObject({ statusCode: 404 });
    });

    test('an unknown id is a 404', async () => {
      const res = await request
        .get('/api/v1/artworks/nope')
        .set('Accept', 'application/json');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Artwork nope not found');
    });
  });

  describe('HAL collections', () => {
    beforeAll(async () => {
      for (let index = 0; index < 20; index++) {
        await Artwork.create({ title: `Study ${index}`, year: 1900 + index });
      }
    });

    test('index paginates with the links around the page, Link and X-Total-Count headers', async () => {
      const total = await Artwork.countDocuments();
      const res = await request
        .get('/api/v1/artworks?page=2&per_page=5')
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ count: 5, page: 2, perPage: 5, total });
      expect(res.body._embedded.artworks).toHaveLength(5);
      expect(res.body._embedded.artworks[0]._links.self.href).toMatch(
        /^\/api\/v1\/artworks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(res.body._embedded.artworks[0].id).toBeUndefined();
      expect(res.body._embedded.artworks[0]._id).toBeUndefined();
      expect(res.body._links).toEqual({
        create: { href: '/api/v1/artworks', method: 'POST' },
        first: { href: '/api/v1/artworks?page=1&per_page=5' },
        last: {
          href: `/api/v1/artworks?page=${Math.ceil(total / 5)}&per_page=5`,
        },
        new: { href: '/api/v1/artworks/new' },
        next: { href: '/api/v1/artworks?page=3&per_page=5' },
        prev: { href: '/api/v1/artworks?page=1&per_page=5' },
        self: { href: '/api/v1/artworks?page=2&per_page=5' },
      });
      expect(res.headers.link).toContain(
        '</api/v1/artworks?page=3&per_page=5>; rel="next"'
      );
      expect(res.headers.link).toContain('rel="last"');
      expect(res.headers['x-total-count']).toBe(String(total));
    });

    test('the first page has no prev link and self is the url as requested', async () => {
      const res = await request
        .get('/api/v1/artworks')
        .set('Accept', 'application/json');

      expect(res.body.page).toBe(1);
      expect(res.body.perPage).toBe(25);
      expect(res.body._links.self).toEqual({ href: '/api/v1/artworks' });
      expect(res.body._links.prev).toBeUndefined();
      expect(res.body._links.first).toEqual({
        href: '/api/v1/artworks?page=1&per_page=25',
      });
    });

    test('per_page is bounded by config.api.maxPerPage and page starts at 1', async () => {
      const res = await request
        .get('/api/v1/artworks?page=0&per_page=1000')
        .set('Accept', 'application/json');

      expect(res.body.page).toBe(1);
      expect(res.body.perPage).toBe(100);
    });
  });

  describe('res.render for JSON clients', () => {
    test('keeps the view options and gains the links of the route', async () => {
      const res = await request
        .get('/artwork')
        .set('Accept', 'application/json');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data.artwork');
      expect(res.body).toHaveProperty('paths.index_artwork_path');
      expect(res.body).toHaveProperty('user', null);
      expect(res.body._links).toEqual({
        collection: { href: '/artwork' },
        create: { href: '/artwork', method: 'POST' },
        self: { href: '/artwork' },
      });
    });

    test('answers JSON to clients asking for application/hal+json', async () => {
      const res = await request
        .get('/artwork')
        .set('Accept', 'application/hal+json');

      expect(res.status).toBe(200);
      expect(res.body._links.self.href).toBe('/artwork');
    });

    test('still renders html for browsers', async () => {
      const res = await request.get('/artwork').set('Accept', 'text/html');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
    });
  });

  describe('idempotency', () => {
    test('replays the first answer to the same key and request', async () => {
      const first = await request
        .post('/once')
        .set('Idempotency-Key', 'order-1')
        .send({ item: 'book' });
      const again = await request
        .post('/once')
        .set('Idempotency-Key', 'order-1')
        .send({ item: 'book' });

      expect(first.status).toBe(200);
      expect(first.headers['idempotency-key']).toBe('order-1');
      expect(first.headers['idempotency-replayed']).toBeUndefined();
      expect(again.status).toBe(200);
      expect(again.headers['idempotency-replayed']).toBe('true');
      expect(again.headers['content-type']).toBe(first.headers['content-type']);
      expect(again.body).toEqual(first.body);
    });

    test('a key reused with another body is a 422', async () => {
      const res = await request
        .post('/once')
        .set('Idempotency-Key', 'order-1')
        .send({ item: 'pen' });

      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        data: { key: 'order-1' },
        statusCode: 422,
      });
    });

    test('a key reused with another url is a 422', async () => {
      const res = await request
        .post('/api/v1/artworks')
        .set('Idempotency-Key', 'order-1')
        .send({ item: 'book' });

      expect(res.status).toBe(422);
    });

    test('a concurrent request with the same key is a 409, then replayed', async () => {
      henri.controllers.set('main#slow', async (req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        res.json({ _links: {}, slow: true });
      });
      henri.router.register({
        controller: 'main#slow',
        opts: {},
        route: '/slow',
        verb: 'post',
      });

      const [one, two] = await Promise.all([
        request.post('/slow').set('Idempotency-Key', 'slow-1').send({}),
        request.post('/slow').set('Idempotency-Key', 'slow-1').send({}),
      ]);
      const conflict = one.status === 409 ? one : two;

      expect([one.status, two.status].sort()).toEqual([200, 409]);
      expect(conflict.headers['retry-after']).toBe('1');
      expect(conflict.body.message).toMatch(/still in progress/);

      const later = await request
        .post('/slow')
        .set('Idempotency-Key', 'slow-1')
        .send({});

      expect(later.status).toBe(200);
      expect(later.headers['idempotency-replayed']).toBe('true');
    });

    test('a route opts out with idempotent: false', async () => {
      const one = await request
        .post('/echo')
        .set('Idempotency-Key', 'echo-1')
        .send({ x: 1 });
      const two = await request
        .post('/echo')
        .set('Idempotency-Key', 'echo-1')
        .send({ x: 1 });

      expect(one.headers['idempotency-key']).toBeUndefined();
      expect(two.headers['idempotency-replayed']).toBeUndefined();
      expect(two.body.sequence).toBe(one.body.sequence + 1);
    });

    test('keys are scoped per user', async () => {
      const anonymous = await request
        .post('/once')
        .set('Idempotency-Key', 'scoped')
        .send({ who: 'me' });
      const asMember = await member.agent
        .post('/once')
        .set('Idempotency-Key', 'scoped')
        .set('X-CSRF-Token', member.csrf)
        .send({ who: 'me' });
      const replayed = await member.agent
        .post('/once')
        .set('Idempotency-Key', 'scoped')
        .set('X-CSRF-Token', member.csrf)
        .send({ who: 'me' });

      expect(asMember.headers['idempotency-replayed']).toBeUndefined();
      expect(asMember.body.sequence).not.toBe(anonymous.body.sequence);
      expect(replayed.headers['idempotency-replayed']).toBe('true');
      expect(replayed.body).toEqual(asMember.body);
    });

    test('answers expire after config.api.idempotency.ttl', async () => {
      const store = henri.api.idempotencyStore;
      const { now } = store;
      const { ttl } = henri.api.settings.idempotency;

      expect(ttl).toBe(24 * 60 * 60 * 1000);

      const first = await request
        .post('/once')
        .set('Idempotency-Key', 'expiring')
        .send({});

      store.now = () => Date.now() + ttl + 1000;

      try {
        const later = await request
          .post('/once')
          .set('Idempotency-Key', 'expiring')
          .send({});

        expect(later.headers['idempotency-replayed']).toBeUndefined();
        expect(later.body.sequence).toBeGreaterThan(first.body.sequence);
      } finally {
        store.now = now;
      }
    });

    test('rejects a malformed key with 400', async () => {
      const res = await request
        .post('/once')
        .set('Idempotency-Key', 'k'.repeat(256))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Idempotency-Key/);
    });

    test('forgets an answer that failed with a 5xx so the client may retry', async () => {
      let calls = 0;

      henri.controllers.set('main#flaky', (req, res) => {
        calls++;
        if (calls === 1) {
          throw new Error('first try fails');
        }

        res.json({ _links: {}, calls });
      });
      henri.router.register({
        controller: 'main#flaky',
        opts: {},
        route: '/flaky',
        verb: 'post',
      });

      const failed = await request
        .post('/flaky')
        .set('Accept', 'application/json')
        .set('Idempotency-Key', 'flaky-1')
        .send({});
      const retried = await request
        .post('/flaky')
        .set('Accept', 'application/json')
        .set('Idempotency-Key', 'flaky-1')
        .send({});

      expect(failed.status).toBe(500);
      expect(retried.status).toBe(200);
      expect(retried.body.calls).toBe(2);
      expect(retried.headers['idempotency-replayed']).toBeUndefined();
    });

    test('a replayed create keeps its status, Location and body', async () => {
      const created = await request
        .post('/api/v1/artworks')
        .set('Accept', 'application/json')
        .set('Idempotency-Key', 'create-1')
        .send({ title: 'Twice', year: 2 });
      const replayed = await request
        .post('/api/v1/artworks')
        .set('Accept', 'application/json')
        .set('Idempotency-Key', 'create-1')
        .send({ title: 'Twice', year: 2 });

      expect(created.status).toBe(201);
      expect(replayed.status).toBe(201);
      expect(replayed.headers.location).toBe(created.headers.location);
      expect(replayed.headers['idempotency-replayed']).toBe('true');
      expect(replayed.body).toEqual(created.body);
      expect(await Artwork.countDocuments({ title: 'Twice' })).toBe(1);
    });
  });

  describe('rate limit', () => {
    test('answers carry the draft-7 headers', async () => {
      const res = await request.get('/version');

      expect(res.headers['ratelimit-policy']).toBe('600;w=60');
      expect(res.headers.ratelimit).toMatch(
        /^limit=600, remaining=\d+, reset=\d+$/
      );
    });

    test('a route limit answers 429 through boom with Retry-After', async () => {
      const first = await request.get('/limited');
      const second = await request.get('/limited');
      const third = await request.get('/limited');

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(third.status).toBe(429);
      expect(third.body).toEqual({
        data: { limit: 2, retryAfter: expect.any(Number), windowMs: 60000 },
        error: 'Too Many Requests',
        message: 'Too many requests, retry later',
        statusCode: 429,
      });
      expect(third.headers['retry-after']).toMatch(/^\d+$/);
      expect(third.headers.ratelimit).toMatch(/^limit=2, remaining=0/);
      expect(third.headers['ratelimit-policy']).toBe('2;w=60');
    });

    test('counts logged-in users by id, others by ip', () => {
      expect(keyFor({ user: { id: 7 } })).toBe('user:7');
      expect(keyFor({ user: { _id: 'abc' } })).toBe('user:abc');
      expect(keyFor({ ip: '127.0.0.1' })).toBe('ip:127.0.0.1');
      expect(keyFor({})).toBe('ip:unknown');
    });

    test('the auth and global limiters are mounted with the configured limits', () => {
      const names = henri.api.limiters.map((guard) => guard.limiterName);
      const auth = henri.api.limiters.find(
        (guard) => guard.limiterName === 'auth'
      );
      const global = henri.api.limiters.find(
        (guard) => guard.limiterName === 'global'
      );

      expect(names).toEqual(['auth', 'global']);
      // Raised in packages/demo/config/test.json (10 per minute by default)
      expect(auth.settings).toEqual({ limit: 200, windowMs: 60000 });
      expect(global.settings).toEqual({ limit: 600, windowMs: 60000 });
    });
  });

  describe('conditional GET and caching', () => {
    let url;

    beforeAll(async () => {
      const artwork = await Artwork.create({ title: 'Cached', year: 1 });

      url = `/api/v1/artworks/${artwork.id}`;
    });

    test('JSON answers carry a weak ETag and If-None-Match gets a 304', async () => {
      const res = await request.get(url).set('Accept', 'application/json');
      const cached = await request
        .get(url)
        .set('Accept', 'application/json')
        .set('If-None-Match', res.headers.etag);

      expect(res.headers.etag).toMatch(/^W\//);
      expect(cached.status).toBe(304);
      expect(cached.text).toBeFalsy();
    });

    test('authenticated JSON is Cache-Control: no-store', async () => {
      const anonymous = await request
        .get(url)
        .set('Accept', 'application/json');
      const logged = await member.agent
        .get(url)
        .set('Accept', 'application/json');

      expect(anonymous.headers['cache-control']).toBeUndefined();
      expect(logged.headers['cache-control']).toBe('no-store');
    });
  });

  describe('api version', () => {
    test('reads the vendor media type into req.apiVersion', async () => {
      const versioned = await request
        .get('/version')
        .set('Accept', 'application/vnd.henri.v2+json');
      const plain = await request
        .get('/version')
        .set('Accept', 'application/json');

      expect(versioned.status).toBe(200);
      expect(versioned.body.version).toBe('v2');
      expect(plain.body.version).toBeNull();
    });

    test('a versioned route serves its version and refuses the others with 406', async () => {
      const served = await request
        .get('/api/v1/artworks')
        .set('Accept', 'application/vnd.henri.v1+json');
      const refused = await request
        .get('/api/v1/artworks')
        .set('Accept', 'application/vnd.henri.v2+json');

      expect(served.status).toBe(200);
      expect(served.body._embedded.artworks).toEqual(expect.any(Array));
      expect(refused.status).toBe(406);
      expect(refused.body).toEqual({
        data: { requested: 'v2', served: 'v1' },
        error: 'Not Acceptable',
        message: 'API version v2 is not served by this route (v1)',
        statusCode: 406,
      });
    });
  });

  describe('health', () => {
    test('answers 200 with the stores', async () => {
      const res = await request.get('/_henri/health');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        requestId: res.headers['x-request-id'],
        status: 'ok',
        stores: {
          default: { adapter: 'disk', latency: expect.any(Number), ok: true },
        },
        uptime: expect.any(Number),
        version: henri.release,
      });
    });

    test('answers 503 when a store does not answer', async () => {
      const store = henri.model.stores.default;
      const { ping } = store;

      store.ping = async () => {
        throw new Error('connection lost');
      };

      try {
        const res = await request.get('/_henri/health');

        expect(res.status).toBe(503);
        expect(res.body.status).toBe('unavailable');
        expect(res.body.stores.default).toEqual({
          adapter: 'disk',
          error: 'connection lost',
          ok: false,
        });
      } finally {
        store.ping = ping;
      }
    });
  });

  describe('parameter filtering', () => {
    test('pen masks the filtered parameters of anything it prints', () => {
      expect(
        henri.pen.redact({
          email: 'grace@usehenri.io',
          list: [{ secret: 's' }],
          nested: { ok: 1, token: 't' },
          password: 'hunter2',
          password_confirmation: 'hunter2',
        })
      ).toEqual({
        email: 'grace@usehenri.io',
        list: [{ secret: '[FILTERED]' }],
        nested: { ok: 1, token: '[FILTERED]' },
        password: '[FILTERED]',
        password_confirmation: '[FILTERED]',
      });

      const { fullMsg } = henri.pen.output('api', 'info', 'params', {
        password: 'hunter2',
        title: 'ok',
      });

      expect(fullMsg).toContain('[FILTERED]');
      expect(fullMsg).toContain('title');
      expect(fullMsg).not.toContain('hunter2');
    });

    test('config.filterParameters replaces the defaults', () => {
      const config = {
        get: () => ['ssn'],
        has: (key) => key === 'filterParameters',
      };

      expect(filterParameters(config)).toEqual(['ssn']);
      expect(filterParameters(henri.config)).toEqual([
        'password',
        'token',
        'secret',
        'authorization',
      ]);
      expect(
        redact({ password: 'p', ssn: '1' }, filterParameters(config))
      ).toEqual({ password: 'p', ssn: '[FILTERED]' });
    });
  });

  describe('strict mode (last: reloads the routes)', () => {
    afterAll(async () => {
      await henri.controllers.reload();
      await henri.router.reload();
    });

    test('reports a resource route answering JSON without _links once, and refuses it when strict', async () => {
      const { warn } = henri.pen;
      const warnings = [];

      henri.controllers.set('artwork#index', (req, res) =>
        res.json({ plain: true })
      );
      await henri.router.reload();
      henri.pen.warn = (...args) => warnings.push(args.join(' '));

      try {
        const first = await request
          .get('/artwork')
          .set('Accept', 'application/json');
        const second = await request
          .get('/artwork')
          .set('Accept', 'application/json');
        const reported = warnings.filter((line) =>
          /answered JSON without _links/.test(line)
        );

        expect(first.status).toBe(200);
        expect(first.body).toEqual({ plain: true });
        expect(second.status).toBe(200);
        expect(reported).toHaveLength(1);
        expect(reported[0]).toMatch(/^api get \/artwork answered JSON/);

        henri.api.settings.strict = true;

        const refused = await request
          .get('/artwork')
          .set('Accept', 'application/json');

        expect(refused.status).toBe(500);
        expect(refused.body.message).toMatch(
          /use res\.resource\(\) or res\.collection\(\) \(config\.api\.strict\)/
        );
      } finally {
        henri.pen.warn = warn;
        henri.api.settings.strict = false;
      }
    });
  });
});
