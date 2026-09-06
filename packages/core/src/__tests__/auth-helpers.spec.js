const session = require('express-session');
const { publicUser, userAdapter, userConfig } = require('../base/auth');
const { params, permitMiddleware } = require('../base/params');
const csrf = require('../base/csrf');
const SessionStoreProxy = require('../base/session-store');

/**
 * Minimal config stand-in
 *
 * @param {object} values configuration values
 * @returns {{get: function, has: function}} config
 */
const configOf = (values) => ({
  get: (key) => values[key],
  has: (key) => typeof values[key] !== 'undefined',
});

describe('userConfig', () => {
  test('defaults without a user key', () => {
    expect(userConfig(configOf({}))).toEqual({
      afterLogin: '/',
      lockout: { max: 10, store: null, windowMs: 15 * 60 * 1000 },
      loginPath: '/login',
      model: 'user',
      password: {
        algorithm: 'auto',
        bcryptRounds: 12,
        binding: { allowUnbound: true, enabled: true },
        maxBytes: 72,
        memoryCost: 19456,
        minLength: 12,
        parallelism: 1,
        pepper: { allowUnpeppered: true, current: null, previous: [] },
        timeCost: 2,
      },
      public: [],
      sessionMaxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  test('accepts the model name as a string', () => {
    expect(userConfig(configOf({ user: 'Account' })).model).toBe('Account');
  });

  test('accepts an object and ignores invalid values', () => {
    const settings = userConfig(
      configOf({
        user: {
          afterLogin: '/home',
          loginPath: '/signin',
          model: 'account',
          public: ['name', 'password', 42],
          sessionMaxAge: -1,
        },
      })
    );

    expect(settings).toMatchObject({
      afterLogin: '/home',
      loginPath: '/signin',
      model: 'account',
      public: ['name'],
      sessionMaxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  test('rejects other shapes', () => {
    expect(() => userConfig(configOf({ user: 42 }))).toThrow(TypeError);
    expect(() => userConfig(configOf({ user: ['user'] }))).toThrow(TypeError);
  });
});

describe('userAdapter', () => {
  test('prefers the adapter contract methods', async () => {
    const calls = [];
    const store = {
      findUserByEmail: async (email) =>
        calls.push(['email', email]) && { email },
      findUserById: async (id) => calls.push(['id', id]) && { id },
      toPlain: (user) => ({ plain: true, ...user }),
      userId: (user) => `id:${user.id}`,
    };
    const adapter = userAdapter(store, { findByPk: () => null });

    expect(adapter.native).toBe(true);
    expect(await adapter.findUserByEmail('a@b.c')).toEqual({ email: 'a@b.c' });
    expect(await adapter.findUserById('7')).toEqual({ id: '7' });
    expect(adapter.userId({ id: 7 })).toBe('id:7');
    expect(adapter.toPlain({ id: 7 })).toEqual({ id: 7, plain: true });
    expect(calls).toEqual([
      ['email', 'a@b.c'],
      ['id', '7'],
    ]);
  });

  test('falls back to mongoose calls', async () => {
    const queries = [];
    const model = {
      findById: async (id, projection) => {
        queries.push(['findById', id, projection]);
        if (id === 'bad') {
          const error = new Error('Cast to ObjectId failed');

          error.name = 'CastError';
          throw error;
        }

        return { _id: id };
      },
      findOne: (filter) => ({
        select: async (projection) => {
          queries.push(['findOne', filter, projection]);

          return { _id: 'abc', email: filter.email, password: 'hash' };
        },
      }),
    };
    const adapter = userAdapter({}, model);

    expect(adapter.native).toBe(false);
    expect(await adapter.findUserByEmail('a@b.c')).toMatchObject({
      password: 'hash',
    });
    expect(await adapter.findUserById('abc')).toEqual({ _id: 'abc' });
    expect(await adapter.findUserById('bad')).toBeNull();
    expect(adapter.userId({ _id: { toString: () => 'oid' } })).toBe('oid');
    expect(adapter.toPlain({ toObject: () => ({ email: 'x' }) })).toEqual({
      email: 'x',
    });
    expect(queries).toEqual([
      ['findOne', { email: 'a@b.c' }, '+password'],
      ['findById', 'abc', { password: 0 }],
      ['findById', 'bad', { password: 0 }],
    ]);
  });

  test('falls back to sequelize calls', async () => {
    const queries = [];
    const model = {
      findByPk: async (id, options) => {
        queries.push(['findByPk', id, options]);

        return { id };
      },
      findOne: async (options) => {
        queries.push(['findOne', options]);

        return { id: 1, ...options.where };
      },
    };
    const adapter = userAdapter(null, model);

    expect(await adapter.findUserByEmail('a@b.c')).toEqual({
      email: 'a@b.c',
      id: 1,
    });
    expect(await adapter.findUserById(1)).toEqual({ id: 1 });
    expect(adapter.userId({ id: 1 })).toBe('1');
    expect(adapter.toPlain({ toJSON: () => ({ id: 1 }) })).toEqual({ id: 1 });
    expect(queries).toEqual([
      ['findOne', { where: { email: 'a@b.c' } }],
      ['findByPk', 1, { attributes: { exclude: ['password'] } }],
    ]);
  });

  test('answers null without a model', async () => {
    const adapter = userAdapter(null, null);

    expect(await adapter.findUserByEmail('a@b.c')).toBeNull();
    expect(await adapter.findUserById('1')).toBeNull();
    expect(adapter.userId(null)).toBeUndefined();
  });
});

describe('publicUser', () => {
  const adapter = userAdapter(null, null);

  test('is null without a user', () => {
    expect(publicUser(adapter, null)).toBeNull();
  });

  test('exposes id, email, roles and the public fields only', () => {
    const user = {
      _id: 42,
      email: 'a@b.c',
      name: 'Ada',
      password: 'hash',
      roles: ['member'],
      secret: 'no',
    };

    expect(publicUser(adapter, user, ['name', 'password', 'missing'])).toEqual({
      email: 'a@b.c',
      id: '42',
      name: 'Ada',
      roles: ['member'],
    });
  });

  test('normalizes roles and copies them', () => {
    const roles = ['a'];
    const result = publicUser(adapter, { _id: 1, roles });

    expect(result.roles).toEqual(['a']);
    expect(result.roles).not.toBe(roles);
    expect(publicUser(adapter, { _id: 1, roles: 'admin' }).roles).toEqual([
      'admin',
    ]);
    expect(publicUser(adapter, { _id: 1 }).roles).toEqual([]);
  });
});

describe('params', () => {
  const req = {
    body: { email: 'a@b.c', name: 'body', roles: ['admin'] },
    params: { id: '42' },
    query: { name: 'query', page: '2' },
  };

  test('merges query, body and params with path params winning', () => {
    expect(params(req).all()).toEqual({
      email: 'a@b.c',
      id: '42',
      name: 'body',
      page: '2',
      roles: ['admin'],
    });
    expect(
      params({ body: { id: 'body' }, params: { id: 'path' } }).all()
    ).toEqual({
      id: 'path',
    });
  });

  test('permit picks the listed fields and omits missing ones', () => {
    const picked = params(req).permit('email', 'name', 'missing', ['page']);

    expect(picked).toEqual({ email: 'a@b.c', name: 'body', page: '2' });
    expect(Object.prototype.hasOwnProperty.call(picked, 'missing')).toBe(false);
    expect(params(req).permit()).toEqual({});
  });

  test('ignores prototype keys and undefined values', () => {
    const body = JSON.parse(
      '{"__proto__": {"admin": true}, "ok": 1, "gone": null}'
    );
    const picked = params({ body: { ...body, undef: undefined } }).permit(
      '__proto__',
      'constructor',
      'ok',
      'gone',
      'undef'
    );

    expect(picked).toEqual({ gone: null, ok: 1 });
    expect(picked.admin).toBeUndefined();
  });

  test('the middleware adds req.permit', () => {
    const request = { body: { title: 'x', year: 1 } };
    let called = false;

    permitMiddleware()(request, {}, () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(request.permit('title')).toEqual({ title: 'x' });
  });
});

describe('csrfConfig', () => {
  const { csrfConfig } = csrf;

  test('checks the origin by default and trusts nothing else', () => {
    expect(csrfConfig(configOf({}))).toEqual({
      checkOrigin: true,
      trustedOrigins: [],
    });
    expect(csrfConfig(configOf({ csrf: true })).checkOrigin).toBe(true);
  });

  test('inherits the origins cors already allows', () => {
    expect(
      csrfConfig(
        configOf({ cors: { credentials: true, origin: ['https://app.io'] } })
      ).trustedOrigins
    ).toEqual(['https://app.io']);

    // `"cors": true` is the library defaults, which name no origin
    expect(csrfConfig(configOf({ cors: true })).trustedOrigins).toEqual([]);
  });

  test('takes its own trusted origins, and can keep the token check alone', () => {
    expect(
      csrfConfig(
        configOf({
          cors: { origin: 'https://app.io' },
          csrf: { origin: false, trustedOrigins: ['https://admin.io'] },
        })
      )
    ).toEqual({
      checkOrigin: false,
      trustedOrigins: ['https://app.io', 'https://admin.io'],
    });
  });

  test('rejects other shapes', () => {
    expect(() => csrfConfig(configOf({ csrf: 'yes' }))).toThrow(TypeError);
  });
});

describe('csrf origin check', () => {
  const { originAllowed } = csrf;

  /**
   * A request stand-in
   *
   * @param {object} headers the headers, lowercased
   * @returns {object} the request
   */
  const requestOf = (headers) => ({
    get: (name) => headers[name.toLowerCase()],
    protocol: 'https',
  });

  test('says nothing when the request says nothing', () => {
    expect(originAllowed(requestOf({ host: 'app.io' }), new Set())).toBeNull();
  });

  test('trusts same-origin and user-initiated navigations', () => {
    for (const site of ['same-origin', 'none']) {
      expect(
        originAllowed(
          requestOf({ host: 'app.io', 'sec-fetch-site': site }),
          new Set()
        )
      ).toBe(true);
    }
  });

  test('refuses a sibling subdomain, which same-site would otherwise cover', () => {
    expect(
      originAllowed(
        requestOf({
          host: 'app.io',
          origin: 'https://evil.app.io',
          'sec-fetch-site': 'same-site',
        }),
        new Set()
      )
    ).toBe(false);
  });

  test('accepts an origin matching the host, or one explicitly trusted', () => {
    expect(
      originAllowed(
        requestOf({ host: 'app.io', origin: 'https://app.io/' }),
        new Set()
      )
    ).toBe(true);

    expect(
      originAllowed(
        requestOf({
          host: 'app.io',
          origin: 'https://admin.io',
          'sec-fetch-site': 'cross-site',
        }),
        new Set(['https://admin.io'])
      )
    ).toBe(true);
  });
});

describe('csrf', () => {
  /**
   * Builds a fake request/response pair
   *
   * @param {object} [options={}] method, cookies, headers, body
   * @returns {{req: object, res: object, calls: Array}} the pair and what happened
   */
  const build = ({ method = 'GET', cookies = {}, headers = {}, body } = {}) => {
    const calls = [];
    const req = {
      body,
      cookies,
      get: (name) => headers[name.toLowerCase()],
      method,
    };
    const res = {
      boom: { forbidden: (message) => calls.push(['forbidden', message]) },
      cookie: (name, value, options) =>
        calls.push(['cookie', name, value, options]),
    };

    return { calls, req, res };
  };
  const middleware = csrf({ maxAge: 1000, secure: true });
  const token = 'a'.repeat(48);

  test('sets a readable, lax cookie when missing or malformed', () => {
    for (const cookies of [{}, { 'henri.csrf': 'short' }]) {
      const { calls, req, res } = build({ cookies });
      let next = false;

      middleware(req, res, () => {
        next = true;
      });

      expect(next).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toBe('henri.csrf');
      expect(calls[0][2]).toMatch(/^[a-f0-9]{48}$/);
      expect(calls[0][3]).toEqual({
        httpOnly: false,
        maxAge: 1000,
        path: '/',
        sameSite: 'lax',
        secure: true,
      });
      expect(req.csrfToken).toBe(calls[0][2]);
    }
  });

  test('keeps an existing token', () => {
    const { calls, req, res } = build({ cookies: { 'henri.csrf': token } });

    middleware(req, res, () => {});

    expect(calls).toHaveLength(0);
    expect(req.csrfToken).toBe(token);
  });

  test('lets unsafe requests through without a session cookie', () => {
    const { calls, req, res } = build({
      cookies: { 'henri.csrf': token },
      method: 'POST',
    });
    let next = false;

    middleware(req, res, () => {
      next = true;
    });

    expect(next).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test('rejects unsafe requests with a session and no matching token', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const { calls, req, res } = build({
        body: { _csrf: 'b'.repeat(48) },
        cookies: { 'henri.csrf': token, 'henri.sid': 's' },
        method,
      });
      let next = false;

      middleware(req, res, () => {
        next = true;
      });

      expect(next).toBe(false);
      expect(calls).toEqual([['forbidden', 'Invalid CSRF token']]);
    }
  });

  test('accepts the header (or its xsrf alias), the body field or a bearer token', () => {
    const variants = [
      { headers: { 'x-csrf-token': token } },
      { headers: { 'x-xsrf-token': token } },
      { body: { _csrf: token } },
      { headers: { authorization: 'Bearer abc.def.ghi' } },
    ];

    for (const variant of variants) {
      const { calls, req, res } = build({
        cookies: { 'henri.csrf': token, 'henri.sid': 's' },
        method: 'POST',
        ...variant,
      });
      let next = false;

      middleware(req, res, () => {
        next = true;
      });

      expect(next).toBe(true);
      expect(calls).toHaveLength(0);
    }
  });

  test('falls back to a plain 403 without res.boom', () => {
    const { req } = build({
      cookies: { 'henri.csrf': token, 'henri.sid': 's' },
      method: 'DELETE',
    });
    let sent = null;
    const res = {
      cookie: () => {},
      status: (code) => ({
        json: (body) => {
          sent = { body, code };
        },
      }),
    };

    middleware(req, res, () => {});

    expect(sent.code).toBe(403);
    expect(sent.body.statusCode).toBe(403);
  });
});

describe('SessionStoreProxy', () => {
  /**
   * A fake express-session store recording its calls
   *
   * @param {string} label store name
   * @returns {object} store
   */
  const fakeStore = (label) => {
    const calls = [];
    const store = {
      calls,
      destroy: (sid, cb) => cb(calls.push(['destroy', sid]) && null),
      get: (sid, cb) => cb(null, { label, sid }),
      set: (sid, data, cb) => cb(calls.push(['set', sid, data]) && null),
      stopExpiringSessions: () => calls.push(['stop']),
    };

    return store;
  };

  /**
   * Promisified store call
   *
   * @param {object} store the proxy
   * @param {string} method method name
   * @param {...*} args arguments
   * @returns {Promise<*>} the callback result
   */
  const call = (store, method, ...args) =>
    new Promise((resolve, reject) =>
      store[method](...args, (error, result) =>
        error ? reject(error) : resolve(result)
      )
    );

  test('is an express-session store', () => {
    const proxy = new SessionStoreProxy({ create: () => {}, owner: () => {} });

    expect(proxy).toBeInstanceOf(session.Store);
    expect(() => new SessionStoreProxy({})).toThrow(TypeError);
  });

  test('resolves the store lazily, once per adapter', async () => {
    let owner = { name: 'first' };
    let created = 0;
    const proxy = new SessionStoreProxy({
      create: async (adapter) => {
        created++;

        return fakeStore(adapter.name);
      },
      owner: () => owner,
    });

    expect(proxy.store()).toBeNull();

    const [one, two] = await Promise.all([
      call(proxy, 'get', 'a'),
      call(proxy, 'get', 'b'),
    ]);

    expect(one).toEqual({ label: 'first', sid: 'a' });
    expect(two).toEqual({ label: 'first', sid: 'b' });
    expect(created).toBe(1);

    await call(proxy, 'set', 'a', { user: 1 });
    expect(proxy.store().calls).toEqual([['set', 'a', { user: 1 }]]);

    owner = { name: 'second' };
    expect(await call(proxy, 'get', 'a')).toEqual({
      label: 'second',
      sid: 'a',
    });
    expect(created).toBe(2);
  });

  test('answers an error while the models are not loaded', async () => {
    const proxy = new SessionStoreProxy({
      create: () => fakeStore('x'),
      owner: () => null,
    });

    await expect(call(proxy, 'get', 'a')).rejects.toThrow(/not loaded/);
  });

  test('reports a failing adapter and retries later', async () => {
    let fail = true;
    const proxy = new SessionStoreProxy({
      create: () => {
        if (fail) {
          throw new Error('boom');
        }

        return fakeStore('ok');
      },
      owner: () => 'adapter',
    });

    await expect(call(proxy, 'get', 'a')).rejects.toThrow('boom');
    fail = false;
    expect(await call(proxy, 'get', 'a')).toEqual({ label: 'ok', sid: 'a' });
  });

  test('is a no-op for methods the store lacks', async () => {
    const proxy = new SessionStoreProxy({
      create: () => fakeStore('x'),
      owner: () => 'adapter',
    });

    expect(await call(proxy, 'touch', 'a', {})).toBeUndefined();
    expect(await call(proxy, 'length')).toBeUndefined();
  });

  test('detaches on close and stops the store timers', async () => {
    const proxy = new SessionStoreProxy({
      create: () => fakeStore('x'),
      owner: () => 'adapter',
    });

    await call(proxy, 'get', 'a');

    const store = proxy.store();

    await proxy.close();

    expect(store.calls).toEqual([['stop']]);
    expect(proxy.store()).toBeNull();
    await expect(call(proxy, 'get', 'a')).rejects.toThrow(/closed/);
  });
});
