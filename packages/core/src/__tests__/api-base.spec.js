const express = require('express');
const supertest = require('supertest');

const Server = require('../2.server');
const { settings } = require('../base/api');
const boom = require('../base/boom');
const health = require('../base/health');
const { errorHandler, notFound } = require('../base/http');
const {
  cspDirectives,
  merge,
  normalizeVersion,
  secureHeaders,
} = require('../base/headers');
const {
  fill,
  identify,
  resourceLinks,
  collectionLinks,
  toPlain,
} = require('../base/hateoas');
const {
  hasExternalId,
  isUuid,
  stripInternalIds,
} = require('../base/external-id');
const {
  MemoryStore,
  fingerprint,
  scopeOf,
  stableStringify,
} = require('../base/idempotency');
const { linkHeader, pageLinks, paginate } = require('../base/pagination');
const { authLimiter, limiter, shutdown } = require('../base/rate-limit');
const { redact, redactUrl } = require('../base/redact');
const { context, currentRequestId, requestId } = require('../base/request-id');

/**
 * A minimal henri
 *
 * @param {object} [config={}] the configuration
 * @param {object} [flags={}] overrides (isDev, isProduction, model...)
 * @returns {object} a henri look-alike
 */
const fakeHenri = (config = {}, flags = {}) =>
  Object.assign(
    {
      config: {
        get: (key, safe) => {
          if (Object.prototype.hasOwnProperty.call(config, key)) {
            return config[key];
          }
          if (safe) {
            return false;
          }
          throw new Error(`Config key ${key} does not exist`);
        },
        has: (key) => Object.prototype.hasOwnProperty.call(config, key),
      },
      cwd: () => process.cwd(),
      isDev: false,
      isProduction: false,
      isTest: true,
      pen: { error: () => {}, info: () => {}, line: () => {}, warn: () => {} },
      release: '0.42.0',
      utils: { clearConsole: () => true },
    },
    flags
  );

/** The paths of a `resources tasks` route, as Router.pathForRoles gives them */
const TASK_PATHS = {
  create_tasks_path: { method: 'post', route: '/tasks' },
  edit_tasks_path: { method: 'get', route: '/tasks/:id/edit' },
  index_tasks_path: { method: 'get', route: '/tasks' },
  new_tasks_path: { method: 'get', route: '/tasks/new' },
  show_tasks_path: { method: 'get', route: '/tasks/:id' },
  update_tasks_path: { method: 'put', route: '/tasks/:id' },
};

describe('api settings', () => {
  test('defaults', () => {
    const defaults = settings(fakeHenri().config);

    expect(defaults).toEqual({
      bodyLimit: '1mb',
      filterParameters: ['password', 'token', 'secret', 'authorization'],
      idempotency: { store: null, ttl: 24 * 60 * 60 * 1000 },
      pagination: { maxPerPage: 100, perPage: 25 },
      rateLimit: {
        auth: {
          loginPath: '/login',
          max: 10,
          paths: undefined,
          windowMs: 60000,
        },
        max: 600,
        store: null,
        windowMs: 60000,
      },
      requestTimeout: 30000,
      strict: false,
    });
  });

  test('reads and bounds the configuration', () => {
    const custom = settings(
      fakeHenri({
        api: {
          idempotency: { store: './config/store.js', ttl: 5000 },
          maxPerPage: 50,
          perPage: 10,
          strict: true,
        },
        bodyLimit: '2mb',
        filterParameters: ['ssn'],
        rateLimit: {
          auth: { max: 3, paths: ['/signin'] },
          max: 42,
          windowMs: 1000,
        },
        requestTimeout: 500,
      }).config,
      { loginPath: '/signin' }
    );

    expect(custom).toMatchObject({
      bodyLimit: '2mb',
      filterParameters: ['ssn'],
      idempotency: { store: './config/store.js', ttl: 5000 },
      pagination: { maxPerPage: 50, perPage: 10 },
      rateLimit: {
        auth: { loginPath: '/signin', max: 3, paths: ['/signin'] },
        max: 42,
        windowMs: 1000,
      },
      requestTimeout: 500,
      strict: true,
    });
  });

  test('false disables the rate limits, the idempotency and the timeout', () => {
    const off = settings(
      fakeHenri({
        api: { idempotency: false },
        rateLimit: false,
        requestTimeout: false,
      }).config
    );

    expect(off.idempotency).toBe(false);
    expect(off.rateLimit).toBe(false);
    expect(off.requestTimeout).toBe(false);
    expect(
      settings(fakeHenri({ rateLimit: { auth: false } }).config).rateLimit.auth
    ).toBe(false);
  });
});

describe('server middlewares (stubbed henri)', () => {
  let server;
  let app;

  beforeAll(async () => {
    server = new Server();
    server.henri = fakeHenri({ bodyLimit: '1kb', requestTimeout: 60 });
    await server.init();
    ({ app } = server);
    app.post('/echo', (req, res) => res.json(req.body));
    app.get('/slow', () => {});
    app.get('/page', (req, res) => res.json(req.pagination()));
    app.use(notFound(server.henri));
    app.use(errorHandler(server.henri));
  });

  afterAll(async () => {
    await server.stop();
  });

  test('a body over config.bodyLimit is a 413', async () => {
    const res = await supertest(app)
      .post('/echo')
      .set('Accept', 'application/json')
      .send({ text: 'x'.repeat(2048) });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      message: 'request entity too large',
      statusCode: 413,
    });
    expect(res.headers['x-request-id']).toBeDefined();

    const small = await supertest(app).post('/echo').send({ text: 'x' });

    expect(small.status).toBe(200);
  });

  test('a request without an answer after config.requestTimeout is a 503', async () => {
    const res = await supertest(app)
      .get('/slow')
      .set('Accept', 'application/json');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      data: { timeout: 60 },
      error: 'Service Unavailable',
      message: 'Request timed out after 60ms',
      statusCode: 503,
    });
    expect(res.headers.connection).toBe('close');
  });

  test('the health check answers without stores', async () => {
    const res = await supertest(app).get('/_henri/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', stores: {} });
  });

  test('req.pagination() reads page and per_page, bounded', async () => {
    const res = await supertest(app).get('/page?page=3&per_page=500');

    expect(res.body).toEqual({
      limit: 100,
      offset: 200,
      page: 3,
      perPage: 100,
      skip: 200,
    });
  });
});

describe('secure headers', () => {
  /**
   * An app answering with the helmet middleware of a henri
   *
   * @param {object} henri a henri look-alike
   * @returns {object} supertest
   */
  const withHelmet = (henri) => {
    const app = express();
    const middleware = secureHeaders(henri);

    middleware && app.use(middleware);
    app.get('/', (req, res) => res.send('ok'));

    return supertest(app);
  };

  test('the csp allows inline and eval scripts, websockets and blob workers only in development', () => {
    const dev = cspDirectives({ isDev: true });
    const prod = cspDirectives();

    expect(dev['script-src']).toEqual([
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
    ]);
    expect(dev['connect-src']).toEqual(["'self'", 'ws:', 'wss:']);
    expect(dev['worker-src']).toEqual(["'self'", 'blob:']);
    expect(dev['upgrade-insecure-requests']).toBeUndefined();
    expect(prod['script-src']).toEqual(["'self'"]);
    expect(prod['connect-src']).toBeUndefined();
    expect(prod['upgrade-insecure-requests']).toBeUndefined();
    expect(
      cspDirectives({ secure: true })['upgrade-insecure-requests']
    ).toEqual([]);
  });

  test('upgrade-insecure-requests follows the protocol of the request', async () => {
    const henri = fakeHenri({ trustProxy: true }, { isProduction: true });
    const app = express();

    app.set('trust proxy', true);
    app.use(secureHeaders(henri));
    app.get('/', (req, res) => res.send('ok'));

    const plain = await supertest(app).get('/');
    const encrypted = await supertest(app)
      .get('/')
      .set('X-Forwarded-Proto', 'https');

    // Over http the directive would rewrite the redirect of a POST to https
    expect(plain.headers['content-security-policy']).not.toContain(
      'upgrade-insecure-requests'
    );
    expect(encrypted.headers['content-security-policy']).toContain(
      'upgrade-insecure-requests'
    );
  });

  test('hsts is off in development, on otherwise', async () => {
    const dev = await withHelmet(fakeHenri({}, { isDev: true })).get('/');
    const prod = await withHelmet(fakeHenri({}, { isProduction: true })).get(
      '/'
    );

    expect(dev.headers['strict-transport-security']).toBeUndefined();
    expect(dev.headers['content-security-policy']).toContain("'unsafe-eval'");
    expect(prod.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(prod.headers['content-security-policy']).not.toContain(
      'unsafe-eval'
    );
  });

  test('config.helmet false disables it, an object overrides the defaults', async () => {
    expect(secureHeaders(fakeHenri({ helmet: false }))).toBeNull();

    const res = await withHelmet(
      fakeHenri({
        helmet: {
          contentSecurityPolicy: {
            directives: { 'script-src': ["'self'", 'https://cdn.example'] },
          },
          referrerPolicy: { policy: 'same-origin' },
        },
      })
    ).get('/');

    expect(res.headers['content-security-policy']).toContain(
      "script-src 'self' https://cdn.example"
    );
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'"
    );
    expect(res.headers['referrer-policy']).toBe('same-origin');
  });

  test('the powerful browser features are denied, and nameable', async () => {
    const sent = await withHelmet(fakeHenri()).get('/');
    const asked = await withHelmet(
      fakeHenri({ helmet: { permissionsPolicy: 'geolocation=(self)' } })
    ).get('/');
    const off = await withHelmet(
      fakeHenri({ helmet: { permissionsPolicy: false } })
    ).get('/');

    expect(sent.headers['permissions-policy']).toContain('camera=()');
    expect(sent.headers['permissions-policy']).toContain('geolocation=()');
    expect(asked.headers['permissions-policy']).toBe('geolocation=(self)');
    expect(off.headers['permissions-policy']).toBeUndefined();
    // Helmet refuses an option it does not know: ours never reaches it
    expect(off.headers['x-content-type-options']).toBe('nosniff');
  });

  test('no directive is opened to every host on the internet', async () => {
    const directives = cspDirectives();
    const res = await withHelmet(fakeHenri({}, { isProduction: true })).get(
      '/'
    );

    expect(directives['font-src']).toEqual(["'self'", 'data:']);
    expect(directives['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(res.headers['content-security-policy']).not.toContain(' https:');
  });

  test('cors opens the cross origin resource policy', async () => {
    const closed = await withHelmet(fakeHenri()).get('/');
    const open = await withHelmet(fakeHenri({ cors: true })).get('/');

    expect(closed.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(open.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  test('helpers', () => {
    expect(normalizeVersion('V2')).toBe('v2');
    expect(normalizeVersion(1)).toBe('v1');
    expect(normalizeVersion('beta')).toBeNull();
    expect(
      merge({ a: { b: 1, c: [1] }, d: 1 }, { a: { c: [2] }, e: 2 })
    ).toEqual({
      a: { b: 1, c: [2] },
      d: 1,
      e: 2,
    });
  });
});

describe('pagination helpers', () => {
  test('paginate bounds the page and the size', () => {
    expect(paginate({ query: { page: '3', per_page: '10' } })).toEqual({
      limit: 10,
      offset: 20,
      page: 3,
      perPage: 10,
      skip: 20,
    });
    expect(paginate({ query: { page: '0', perPage: 'abc' } })).toEqual({
      limit: 25,
      offset: 0,
      page: 1,
      perPage: 25,
      skip: 0,
    });
    expect(
      paginate({ query: { per_page: '500' } }, { maxPerPage: 50, perPage: 5 })
    ).toMatchObject({ page: 1, perPage: 50 });
    expect(paginate({})).toMatchObject({ page: 1, perPage: 25 });
  });

  test('pageLinks with a known total', () => {
    expect(
      pageLinks('/tasks?page=2&per_page=10&q=x', {
        page: 2,
        perPage: 10,
        total: 35,
      })
    ).toEqual({
      first: '/tasks?page=1&per_page=10&q=x',
      last: '/tasks?page=4&per_page=10&q=x',
      next: '/tasks?page=3&per_page=10&q=x',
      prev: '/tasks?page=1&per_page=10&q=x',
      self: '/tasks?page=2&per_page=10&q=x',
    });
    expect(pageLinks('/tasks', { page: 1, perPage: 10, total: 0 })).toEqual({
      first: '/tasks?page=1&per_page=10',
      last: '/tasks?page=1&per_page=10',
      self: '/tasks',
    });
  });

  test('pageLinks without a total offers next while the page is full', () => {
    expect(pageLinks('/tasks', { count: 10, page: 1, perPage: 10 })).toEqual({
      first: '/tasks?page=1&per_page=10',
      next: '/tasks?page=2&per_page=10',
      self: '/tasks',
    });
    expect(
      pageLinks('/tasks?page=3', { count: 4, page: 3, perPage: 10 })
    ).toEqual({
      first: '/tasks?page=1&per_page=10',
      prev: '/tasks?page=2&per_page=10',
      self: '/tasks?page=3',
    });
  });

  test('linkHeader leaves self out', () => {
    expect(linkHeader({ next: '/tasks?page=2', self: '/tasks' })).toBe(
      '</tasks?page=2>; rel="next"'
    );
    expect(linkHeader({ self: '/tasks' })).toBe('');
  });
});

describe('hateoas helpers', () => {
  test('fill replaces the route parameters', () => {
    expect(fill('/users/:userId/tasks/:id', { id: 'a b', userId: 5 })).toBe(
      '/users/5/tasks/a%20b'
    );
    expect(fill('/tasks/:id', {})).toBe('/tasks/:id');
  });

  test('toPlain serializes model instances and exposes an id', () => {
    expect(toPlain({ _id: 42, title: 't' })).toEqual({
      _id: 42,
      id: '42',
      title: 't',
    });
    expect(toPlain({ id: 7, title: 't' })).toEqual({ id: 7, title: 't' });
    expect(
      toPlain({ secret: 'hidden', toJSON: () => ({ _id: 'x', title: 't' }) })
    ).toEqual({ _id: 'x', id: 'x', title: 't' });
    expect(identify({ _id: { toString: () => 'oid' } })).toBe('oid');
    expect(identify({})).toBeNull();
  });

  test('toPlain drops the internal ids of a record that has a public one', () => {
    const external = '0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11';

    // A `.lean()` document: no toJSON of its own to do the job
    expect(toPlain({ _id: 42, externalId: external, title: 't' })).toEqual({
      externalId: external,
      title: 't',
    });
    expect(
      toPlain({
        toJSON: () => ({
          author: { externalId: external, id: 9 },
          externalId: external,
          id: 3,
        }),
      })
    ).toEqual({
      author: { externalId: external },
      externalId: external,
    });
    expect(identify({ externalId: external, id: 3 })).toBe(external);
  });

  test('resourceLinks only contains the paths the user may follow', () => {
    expect(
      resourceLinks({ id: '1', paths: TASK_PATHS, type: 'tasks' })
    ).toEqual({
      collection: { href: '/tasks' },
      edit: { href: '/tasks/1/edit' },
      self: { href: '/tasks/1' },
      update: { href: '/tasks/1', method: 'PATCH' },
    });

    const { show_tasks_path: show, ...crud } = TASK_PATHS;

    crud.destroy_tasks_path = { method: 'delete', route: '/tasks/:id' };

    // A crud resource has no show page: self comes from the update route
    expect(show).toBeDefined();
    expect(
      resourceLinks({ id: '1', paths: crud, type: 'tasks' })
    ).toMatchObject({
      destroy: { href: '/tasks/1', method: 'DELETE' },
      self: { href: '/tasks/1' },
    });
    expect(resourceLinks({ id: '1', paths: {}, type: 'tasks' })).toEqual({});
    expect(resourceLinks({ paths: TASK_PATHS, type: 'tasks' })).toEqual({
      collection: { href: '/tasks' },
    });
  });

  test('collectionLinks offers create and the form', () => {
    expect(collectionLinks({ paths: TASK_PATHS, type: 'tasks' })).toEqual({
      create: { href: '/tasks', method: 'POST' },
      new: { href: '/tasks/new' },
    });
    expect(collectionLinks({ paths: {}, type: 'tasks' })).toEqual({});
  });
});

describe('external ids', () => {
  const external = '0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11';

  test('a uuid is never confused with a primary key', () => {
    expect(isUuid(external)).toBe(true);
    expect(isUuid(external.toUpperCase())).toBe(true);
    expect(isUuid('42')).toBe(false);
    expect(isUuid(42)).toBe(false);
    // A MongoDB object id: 24 hex characters, no dashes
    expect(isUuid('6a9cc1ae7276eaea0bf93cfe')).toBe(false);
    expect(hasExternalId({ externalId: external })).toBe(true);
    expect(hasExternalId({ externalId: '' })).toBe(false);
    expect(hasExternalId({ id: 1 })).toBe(false);
    expect(hasExternalId(null)).toBe(false);
  });

  test('stripInternalIds walks the whole payload', () => {
    const author = { externalId: 'a', id: 7 };
    const posts = [
      { author, externalId: 'p1', id: 1 },
      { author, externalId: 'p2', id: 2 },
    ];

    // The same record twice: both copies lose the id
    expect(stripInternalIds(posts)).toEqual([
      { author: { externalId: 'a' }, externalId: 'p1' },
      { author: { externalId: 'a' }, externalId: 'p2' },
    ]);
    // A record without a public id is left exactly as it was
    expect(stripInternalIds({ id: 3, name: 'kept' })).toEqual({
      id: 3,
      name: 'kept',
    });
  });

  test('stripInternalIds leaves dates, buffers and cycles alone', () => {
    const when = new Date('2026-01-02T03:04:05.000Z');
    const buffer = Buffer.from('x');
    const cyclic = { externalId: 'c', id: 1 };

    cyclic.self = cyclic;

    const walked = stripInternalIds({ buffer, record: cyclic, when });

    expect(walked.when).toBe(when);
    expect(walked.buffer).toBe(buffer);
    expect(walked.record.id).toBeUndefined();
    expect(walked.record.self).toBe(walked.record);
    expect(stripInternalIds('a string')).toBe('a string');
    expect(stripInternalIds(null)).toBeNull();
  });
});

describe('idempotency helpers', () => {
  test('the memory store expires its entries after the ttl', async () => {
    let clock = 1000;
    const store = new MemoryStore({ now: () => clock, sweepEvery: 100000 });

    try {
      await store.set('a', { state: 'done' }, 500);
      expect(await store.get('a')).toEqual({ state: 'done' });
      expect(await store.add('a', { state: 'pending' }, 500)).toBe(false);

      clock = 1499;
      expect(await store.get('a')).toEqual({ state: 'done' });

      clock = 1500;
      expect(await store.get('a')).toBeUndefined();
      expect(await store.add('a', { state: 'pending' }, 500)).toBe(true);

      await store.set('b', 1, 10);
      clock = 5000;
      expect(store.size).toBe(2);
      expect(store.sweep()).toBe(2);
      expect(store.size).toBe(0);

      await store.set('c', 1, 10);
      await store.delete('c');
      expect(await store.get('c')).toBeUndefined();
    } finally {
      store.shutdown();
    }
  });

  test('the fingerprint does not depend on the order of the keys', () => {
    const one = fingerprint({
      body: JSON.parse('{"a":1,"b":{"c":[1,2],"d":null}}'),
      method: 'POST',
      originalUrl: '/tasks',
    });
    const two = fingerprint({
      body: JSON.parse('{"b":{"d":null,"c":[1,2]},"a":1}'),
      method: 'POST',
      originalUrl: '/tasks',
    });
    const other = fingerprint({
      body: { a: 2 },
      method: 'POST',
      originalUrl: '/tasks',
    });

    expect(one).toBe(two);
    expect(one).not.toBe(other);
    expect(stableStringify(JSON.parse('{"b":1,"a":[{"d":1,"c":2}]}'))).toBe(
      '{"a":[{"c":2,"d":1}],"b":1}'
    );
  });

  test('keys are scoped to the user, the session or the ip', () => {
    expect(scopeOf({ user: { id: 7 } })).toBe('user:7');
    expect(scopeOf({ user: { _id: 'abc' } })).toBe('user:abc');
    expect(
      scopeOf({
        cookies: { 'henri.sid': 'x' },
        ip: '1.2.3.4',
        sessionID: 'sid',
      })
    ).toBe('session:sid');
    expect(scopeOf({ ip: '1.2.3.4', sessionID: 'fresh' })).toBe('ip:1.2.3.4');
    expect(scopeOf({})).toBe('ip:unknown');
  });
});

describe('rate limiters', () => {
  const limiters = [];

  afterAll(() => {
    limiters.forEach(shutdown);
  });

  /**
   * An app with boom and the given limiter
   *
   * @param {function} guard a limiter
   * @returns {object} supertest
   */
  const withLimiter = (guard) => {
    const app = express();

    limiters.push(guard);
    app.use(boom());
    app.use(guard);
    app.all('/{*splat}', (req, res) => res.json({ ok: true }));

    return supertest(app);
  };

  test('the auth limiter allows 10 POST per minute to the login and register paths', async () => {
    const app = withLimiter(authLimiter(fakeHenri()));

    for (let index = 0; index < 10; index++) {
      expect((await app.post('/login').send({})).status).toBe(200);
    }

    const limited = await app.post('/login').send({});

    expect(limited.status).toBe(429);
    expect(limited.body).toMatchObject({
      data: { limit: 10, windowMs: 60000 },
      statusCode: 429,
    });
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(limited.headers['ratelimit-policy']).toBe('10;w=60');
    // Same counter for the register-style paths, nothing else is counted
    expect((await app.post('/register').send({})).status).toBe(429);
    expect((await app.get('/login')).status).toBe(200);
    expect((await app.post('/other').send({})).status).toBe(200);
  });

  test('the auth limiter follows config.user.loginPath and custom paths', async () => {
    const app = withLimiter(
      authLimiter(fakeHenri(), { loginPath: '/signin', max: 1 })
    );

    expect((await app.post('/signin').send({})).status).toBe(200);
    expect((await app.post('/signin').send({})).status).toBe(429);
    expect((await app.post('/login').send({})).status).toBe(200);

    const custom = withLimiter(
      authLimiter(fakeHenri(), { max: 1, paths: ['/auth'] })
    );

    expect((await custom.post('/login').send({})).status).toBe(200);
    expect((await custom.post('/auth').send({})).status).toBe(200);
    expect((await custom.post('/auth').send({})).status).toBe(429);
  });

  test('a limiter sets the draft-7 headers', async () => {
    const app = withLimiter(limiter(fakeHenri(), { max: 2, windowMs: 1000 }));
    const first = await app.get('/');

    expect(first.headers.ratelimit).toBe('limit=2, remaining=1, reset=1');
    expect(first.headers['ratelimit-policy']).toBe('2;w=1');
    expect(first.headers['x-ratelimit-limit']).toBeUndefined();
  });
});

describe('health checks', () => {
  test('liveness answers 200 without looking at a store', async () => {
    const app = express();
    let pinged = 0;
    const henri = fakeHenri(
      {},
      {
        model: {
          stores: {
            default: {
              adapterName: 'disk',
              ping: async () => {
                pinged++;
                throw new Error('connection refused');
              },
            },
          },
        },
      }
    );

    app.get(health.LIVE_PATH, health.live(henri));

    const res = await supertest(app).get('/livez');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      version: '0.42.0',
    });
    expect(pinged).toBe(0);
  });

  test('readiness answers 503 while the boot is running', async () => {
    const app = express();
    const henri = fakeHenri(
      {},
      { model: { stores: {} }, modules: { initialized: false } }
    );

    app.get(health.READY_PATH, health.ready(henri));

    const res = await supertest(app).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      reason: 'starting',
      status: 'unavailable',
      stores: {},
    });
  });

  test('readiness answers 503 while the server is draining', async () => {
    const app = express();
    let pinged = 0;
    const henri = fakeHenri(
      {},
      {
        model: {
          stores: {
            default: {
              adapterName: 'disk',
              ping: async () => {
                pinged++;

                return true;
              },
            },
          },
        },
        modules: { initialized: true },
        server: { draining: true },
      }
    );

    app.get(health.READY_PATH, health.ready(henri));

    const res = await supertest(app).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      reason: 'shutting down',
      status: 'unavailable',
    });
    // A store that is about to be stopped is not worth waking up
    expect(pinged).toBe(0);
  });

  test('answers 503 when a store fails or does not answer in time', async () => {
    const app = express();
    const henri = fakeHenri(
      {},
      {
        model: {
          stores: {
            broken: {
              adapterName: 'mysql',
              ping: async () => {
                throw new Error('connection refused');
              },
            },
            fine: { adapterName: 'disk', ping: async () => true },
            legacy: { adapterName: 'old' },
            slow: {
              adapterName: 'mongoose',
              ping: () => new Promise(() => {}),
            },
          },
        },
      }
    );

    app.get('/_henri/health', health(henri, { timeout: 20 }));

    const res = await supertest(app).get('/_henri/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.reason).toBe('a store did not answer');
    // What the driver said is in the log, never in the body: a connection
    // error carries the url, the user and sometimes the password
    expect(res.body.stores).toEqual({
      broken: { adapter: 'mysql', error: 'unreachable', ok: false },
      fine: { adapter: 'disk', latency: expect.any(Number), ok: true },
      legacy: { adapter: 'old', ok: true, skipped: true },
      slow: { adapter: 'mongoose', error: 'timeout', ok: false },
    });
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
    expect(res.body.version).toBe('0.42.0');
  });

  test('hides the version in production', async () => {
    const app = express();
    const henri = fakeHenri(
      {},
      {
        isProduction: true,
        model: {
          stores: {
            broken: {
              adapterName: 'mysql',
              ping: async () => {
                throw new Error('connection refused');
              },
            },
          },
        },
      }
    );

    app.get('/_henri/health', health(henri));

    const res = await supertest(app).get('/_henri/health');

    expect(res.status).toBe(503);
    expect(res.body.stores.broken).toEqual({
      adapter: 'mysql',
      error: 'unreachable',
      ok: false,
    });
    expect(res.body.version).toBeUndefined();
  });
});

describe('request id and redaction', () => {
  test('the context follows the request', async () => {
    expect(currentRequestId()).toBeNull();
    expect(context.run({ id: 'abc' }, () => currentRequestId())).toBe('abc');

    const app = express();

    app.use(requestId());
    app.get('/', async (req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      res.json({ id: req.id, inContext: currentRequestId() });
    });

    const generated = await supertest(app).get('/');
    const echoed = await supertest(app).get('/').set('X-Request-Id', 'given.1');

    expect(generated.body.id).toBe(generated.headers['x-request-id']);
    expect(generated.body.inContext).toBe(generated.body.id);
    expect(echoed.body).toEqual({ id: 'given.1', inContext: 'given.1' });
  });

  test('redact masks by substring, walks arrays and toJSON, keeps the rest', () => {
    expect(
      redact({
        Authorization: 'Bearer x',
        apiToken: 'y',
        date: new Date(0),
        list: [{ password: 'p' }, 'text'],
        model: { toJSON: () => ({ secret: 's', title: 't' }) },
        name: 'n',
      })
    ).toEqual({
      Authorization: '[FILTERED]',
      apiToken: '[FILTERED]',
      date: new Date(0),
      list: [{ password: '[FILTERED]' }, 'text'],
      model: { secret: '[FILTERED]', title: 't' },
      name: 'n',
    });
    expect(redact('password')).toBe('password');
    expect(redact({ password: 'p' }, [])).toEqual({ password: 'p' });
  });

  test('redactUrl masks the filtered query parameters', () => {
    expect(redactUrl('/login?token=abc&next=%2Fhome')).toBe(
      '/login?token=%5BFILTERED%5D&next=%2Fhome'
    );
    expect(redactUrl('/tasks?page=2')).toBe('/tasks?page=2');
    expect(redactUrl('/tasks')).toBe('/tasks');
  });
});
