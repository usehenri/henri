const express = require('express');
const path = require('path');
const supertest = require('supertest');

const { createApi } = require('../base/api');
const Lockout = require('../base/lockout');
const boom = require('../base/boom');
const { errorHandler } = require('../base/http');
const { limiter } = require('../base/rate-limit');
const {
  SharedStore,
  SharedStoreError,
  createShared,
  loadBackend,
  manyProcesses,
  sharedConfig,
  unavailable,
} = require('../base/shared');

/** Where the fake backend the fixtures resolve lives */
const FIXTURES = path.join(__dirname, 'fixtures');

/**
 * A minimal henri
 *
 * @param {object} [config={}] the configuration
 * @param {object} [flags={}] overrides
 * @returns {object} a henri look-alike
 */
const fakeHenri = (config = {}, flags = {}) =>
  Object.assign(
    {
      config: {
        get: (key) => config[key],
        has: (key) => Object.prototype.hasOwnProperty.call(config, key),
      },
      cwd: () => FIXTURES,
      isDev: false,
      isProduction: false,
      isTest: true,
      logged: [],
      pen: { error: () => {}, info: () => {}, line: () => {}, warn: () => {} },
      shared: null,
      utils: { resolveFrom: require('../utils').resolveFrom },
    },
    flags
  );

/**
 * An in-memory backend: the whole contract, and one shared key space, so
 * two SharedStores built on the same one behave like two processes talking
 * to one server
 *
 * @class FakeBackend
 */
class FakeBackend {
  /**
   * Creates an instance of FakeBackend.
   *
   * @param {object} [settings={}] the normalized `config.shared`
   * @memberof FakeBackend
   */
  constructor(settings = {}) {
    this.name = 'fake';
    this.settings = settings;
    this.prefix = settings.prefix || 'henri:';
    this.counters = FakeBackend.counters;
    this.entries = FakeBackend.entries;
    this.down = false;
    this.started = 0;
    this.stopped = 0;
  }

  /**
   * Refuses every call from now on
   *
   * @returns {void}
   * @memberof FakeBackend
   */
  fail() {
    this.down = true;
  }

  /**
   * Throws when the backend is pretending to be down
   *
   * @returns {void}
   * @throws {Error} when down
   * @memberof FakeBackend
   */
  check() {
    if (this.down) {
      throw new Error('connection refused');
    }
  }

  /**
   * What it is talking to
   *
   * @returns {string} a description
   * @memberof FakeBackend
   */
  describe() {
    return 'memory://fake';
  }

  /**
   * Opens the connection
   *
   * @returns {Promise<boolean>} done
   * @memberof FakeBackend
   */
  async start() {
    this.check();
    this.started += 1;

    return true;
  }

  /**
   * Closes it
   *
   * @returns {Promise<boolean>} done
   * @memberof FakeBackend
   */
  async stop() {
    this.stopped += 1;

    return true;
  }

  /**
   * Whether it answers
   *
   * @returns {Promise<boolean>} true
   * @memberof FakeBackend
   */
  async ping() {
    this.check();

    return true;
  }

  /**
   * An express-rate-limit store on the shared counters
   *
   * @param {string} feature the limiter name
   * @returns {object} the store
   * @memberof FakeBackend
   */
  rateLimitStore(feature) {
    const backend = this;
    const at = (key) => `${this.prefix}rl:${feature}:${key}`;
    let windowMs = 60000;

    return {
      /**
       * Forgets one hit
       *
       * @param {string} key the key
       * @returns {Promise<void>} done
       */
      async decrement(key) {
        backend.check();

        const entry = backend.counters.get(at(key));

        entry && (entry.totalHits -= 1);
      },

      /**
       * Reads a counter
       *
       * @param {string} key the key
       * @returns {Promise<*>} the count
       */
      async get(key) {
        backend.check();

        return backend.counters.get(at(key));
      },

      /**
       * Counts one hit
       *
       * @param {string} key the key
       * @returns {Promise<object>} the count
       */
      async increment(key) {
        backend.check();

        const found = backend.counters.get(at(key));

        if (found && found.resetTime.getTime() > Date.now()) {
          found.totalHits += 1;

          return found;
        }

        const fresh = {
          resetTime: new Date(Date.now() + windowMs),
          totalHits: 1,
        };

        backend.counters.set(at(key), fresh);

        return fresh;
      },

      /**
       * Takes the window
       *
       * @param {object} options the limiter options
       * @returns {void}
       */
      init(options) {
        windowMs = options.windowMs;
      },

      prefix: `${this.prefix}rl:${feature}:`,

      /**
       * Clears a counter
       *
       * @param {string} key the key
       * @returns {Promise<void>} done
       */
      async resetKey(key) {
        backend.check();
        backend.counters.delete(at(key));
      },
    };
  }

  /**
   * A key/value store on the shared entries
   *
   * @param {string} feature what the keys are for
   * @returns {object} the store
   * @memberof FakeBackend
   */
  keyValueStore(feature) {
    const backend = this;
    const at = (key) => `${this.prefix}kv:${feature}:${key}`;

    return {
      /**
       * Writes unless taken
       *
       * @param {string} key the key
       * @param {*} value the value
       * @returns {Promise<boolean>} true when written
       */
      async add(key, value) {
        backend.check();

        if (backend.entries.has(at(key))) {
          return false;
        }

        backend.entries.set(at(key), value);

        return true;
      },

      /**
       * Removes a key
       *
       * @param {string} key the key
       * @returns {Promise<void>} done
       */
      async delete(key) {
        backend.check();
        backend.entries.delete(at(key));
      },

      /**
       * Reads a key
       *
       * @param {string} key the key
       * @returns {Promise<*>} the value
       */
      async get(key) {
        backend.check();

        return backend.entries.get(at(key));
      },

      /**
       * Writes a key
       *
       * @param {string} key the key
       * @param {*} value the value
       * @returns {Promise<void>} done
       */
      async set(key, value) {
        backend.check();
        backend.entries.set(at(key), value);
      },
    };
  }
}

/** The one key space every FakeBackend shares, like one Redis would be */
FakeBackend.counters = new Map();
FakeBackend.entries = new Map();

/**
 * A shared store on a fresh fake backend
 *
 * @param {object} [settings={}] overrides of the normalized block
 * @returns {SharedStore} the store
 */
const shared = (settings = {}) => {
  const full = Object.assign(
    { adapter: 'fake', onError: 'closed', prefix: 'henri:' },
    settings
  );

  return new SharedStore(new FakeBackend(full), full, fakeHenri());
};

beforeEach(() => {
  FakeBackend.counters.clear();
  FakeBackend.entries.clear();
});

describe('config.shared', () => {
  test('is nothing when the application names no backend', () => {
    expect(sharedConfig(fakeHenri().config)).toBeNull();
    expect(sharedConfig(null)).toBeNull();
    expect(createShared(fakeHenri())).toBeNull();
  });

  test('fills in the defaults and keeps the driver options', () => {
    const settings = sharedConfig(
      fakeHenri({ shared: { adapter: 'redis', db: 3, url: 'redis://x' } })
        .config
    );

    expect(settings).toMatchObject({
      adapter: 'redis',
      db: 3,
      enabled: true,
      onError: 'closed',
      prefix: 'henri:',
      url: 'redis://x',
    });
  });

  test('`enabled: false` counts in this process again', () => {
    expect(
      sharedConfig(
        fakeHenri({ shared: { adapter: 'redis', enabled: false } }).config
      )
    ).toBeNull();
  });

  test('refuses a block that is not an object, or names no adapter', () => {
    expect(() => sharedConfig(fakeHenri({ shared: 'redis' }).config)).toThrow(
      /must be an object/u
    );
    expect(() => sharedConfig(fakeHenri({ shared: {} }).config)).toThrow(
      /needs an adapter/u
    );
    expect(() =>
      sharedConfig(
        fakeHenri({ shared: { adapter: 'redis', onError: 'maybe' } }).config
      )
    ).toThrow(/onError must be one of closed, open/u);
  });

  test('loads an adapter from the application, and says what to install', () => {
    expect(
      loadBackend('./shared-backend', FIXTURES, require('../utils').resolveFrom)
    ).toBeInstanceOf(Function);

    expect(() =>
      loadBackend('nope', FIXTURES, require('../utils').resolveFrom)
    ).toThrow(/install it with `npm install @usehenri\/nope`/u);
  });

  test('createShared builds the backend the configuration names', () => {
    const store = createShared(
      fakeHenri({ shared: { adapter: './shared-backend', prefix: 'app:' } })
    );

    expect(store).toBeInstanceOf(SharedStore);
    expect(store.name).toBe('fixture');
    expect(store.describe()).toBe('fixture://app:');
    expect(store.onError).toBe('closed');
  });

  test('refuses an adapter that is not a shared store', () => {
    expect(() =>
      createShared(fakeHenri({ shared: { adapter: './not-a-backend' } }))
    ).toThrow(/does not export a constructor/u);

    expect(() =>
      createShared(fakeHenri({ shared: { adapter: './half-a-backend' } }))
    ).toThrow(/has no keyValueStore\(\)/u);
  });
});

describe('one backend, three counters', () => {
  test('the limiter, the lockout and the keys all reach the same backend', async () => {
    const henri = fakeHenri({
      rateLimit: { max: 5, windowMs: 60000 },
      user: 'user',
    });

    henri.shared = shared();

    const api = createApi(henri, {});

    expect(api.shared).toBe(henri.shared);

    const global = api.rateLimitStore('global');
    const lockout = api.rateLimitStore('lockout');

    global.init({ windowMs: 60000 });
    lockout.init({ windowMs: 60000 });

    await global.increment('ip:1.2.3.4');
    await global.increment('ip:1.2.3.4');
    await lockout.increment('login:abc');

    expect(await global.get('ip:1.2.3.4')).toMatchObject({ totalHits: 2 });
    // Separate key spaces: one limiter's key is not another's
    expect(await lockout.get('ip:1.2.3.4')).toBeUndefined();
    expect(await lockout.get('login:abc')).toMatchObject({ totalHits: 1 });

    await api.idempotencyStore.set('k', { status: 201 }, 1000);
    expect(await api.idempotencyStore.get('k')).toEqual({ status: 201 });

    await api.stop();
    expect(henri.shared).toBeNull();
  });

  test('two processes count once, not twice', async () => {
    const one = shared();
    const two = shared();
    const first = one.rateLimitStore('global');
    const second = two.rateLimitStore('global');

    first.init({ windowMs: 60000 });
    second.init({ windowMs: 60000 });

    await first.increment('ip:1.2.3.4');
    await second.increment('ip:1.2.3.4');
    const third = await first.increment('ip:1.2.3.4');

    expect(third.totalHits).toBe(3);
    expect((await second.get('ip:1.2.3.4')).totalHits).toBe(3);
  });

  test('a lockout counted in one process locks the other', async () => {
    const one = new Lockout({
      max: 3,
      secret: 'x',
      store: shared().rateLimitStore('lockout'),
      windowMs: 60000,
    });
    const two = new Lockout({
      max: 3,
      secret: 'x',
      store: shared().rateLimitStore('lockout'),
      windowMs: 60000,
    });

    await one.fail('someone@example.com');
    await two.fail('someone@example.com');
    expect((await two.check('someone@example.com')).locked).toBe(false);

    const third = await one.fail('someone@example.com');

    expect(third.locked).toBe(true);
    expect((await two.check('someone@example.com')).locked).toBe(true);

    await two.succeed('someone@example.com');
    expect((await one.check('someone@example.com')).locked).toBe(false);
  });

  test('an idempotency key claimed in one process is taken in the other', async () => {
    const one = shared().keyValueStore('idempotency');
    const two = shared().keyValueStore('idempotency');

    expect(await one.add('key', { state: 'pending' }, 1000)).toBe(true);
    expect(await two.add('key', { state: 'pending' }, 1000)).toBe(false);
    expect(await two.get('key')).toEqual({ state: 'pending' });
  });

  test('the cache takes the same backend, without the failure policy', async () => {
    const store = shared({ onError: 'closed' });
    const kept = store.unguarded('cache', { raw: true });

    // Named after the adapter, so whoever takes it can say where it is
    expect(kept.name).toBe('fake');

    await kept.set('memo', '{"id":1}', 1000);
    expect(await kept.get('memo')).toBe('{"id":1}');

    // And nothing between it and the backend: a cache that cannot read is a
    // miss, which is the cache's decision to make (base/cache.js), not a 503
    store.backend.fail();
    await expect(kept.get('memo')).rejects.toThrow(/connection refused/u);
    expect(store.stores).toContain(kept);
  });

  test('a named store still wins over the shared backend', () => {
    const henri = fakeHenri({
      api: { idempotency: { store: './idempotency-store' } },
      rateLimit: { store: './rate-limit-store' },
    });

    henri.shared = shared();

    const api = createApi(henri, {});

    expect(api.rateLimitStore('global').named).toBe('global');
    expect(api.idempotencyStore.named).toBe('idempotency');
  });
});

describe('when the backend is down', () => {
  test('fail closed refuses the request with a 503 and a Retry-After', async () => {
    const store = shared({ onError: 'closed' });
    const limits = store.rateLimitStore('global');

    limits.init({ windowMs: 60000 });
    store.backend.fail();

    const error = await limits
      .increment('ip:1.2.3.4')
      .catch((thrown) => thrown);

    expect(error).toBeInstanceOf(SharedStoreError);
    expect(unavailable(error)).toBe(true);
    expect(error.status).toBe(503);
    expect(error.retryAfter).toBe(1);
    expect(error.feature).toBe('global');
    expect(error.cause.message).toBe('connection refused');
    expect(store.healthy).toBe(false);
  });

  test('fail open serves the request uncounted', async () => {
    const store = shared({ onError: 'open' });
    const limits = store.rateLimitStore('global');

    limits.init({ windowMs: 60000 });
    store.backend.fail();

    const answer = await limits.increment('ip:1.2.3.4');

    expect(answer.totalHits).toBe(0);
    expect(answer.resetTime.getTime()).toBeGreaterThan(Date.now());
    expect(await limits.get('ip:1.2.3.4')).toBeUndefined();
  });

  test('the idempotency keys are closed even when the limiter is open', async () => {
    const store = shared({ onError: 'open' });
    const keys = store.keyValueStore('idempotency');

    store.backend.fail();

    await expect(keys.get('k')).rejects.toBeInstanceOf(SharedStoreError);
    await expect(keys.add('k', {}, 10)).rejects.toBeInstanceOf(
      SharedStoreError
    );
    await expect(keys.set('k', {}, 10)).rejects.toBeInstanceOf(
      SharedStoreError
    );
    await expect(keys.delete('k')).rejects.toBeInstanceOf(SharedStoreError);
  });

  test('a request the limiter cannot count is answered 503, not 500', async () => {
    const henri = fakeHenri();
    const store = shared();
    const app = express();

    app.use(boom());
    app.use(
      limiter(henri, {
        max: 5,
        name: 'global',
        store: store.rateLimitStore('global'),
        windowMs: 60000,
      })
    );
    app.get('/tasks', (req, res) => res.json({ ok: true }));
    app.use(errorHandler(henri));

    const agent = supertest(app);

    await agent.get('/tasks').expect(200);

    store.backend.fail();

    const answer = await agent
      .get('/tasks')
      .set('Accept', 'application/json')
      .expect(503);

    expect(answer.headers['retry-after']).toBe('1');
    expect(answer.body.message).toMatch(/did not answer/u);
  });

  test('an outage is logged, but not once per request', async () => {
    const lines = [];
    const store = shared();

    store.henri = { pen: { error: (...args) => lines.push(args) } };
    store.backend.fail();

    const limits = store.rateLimitStore('global');

    for (let i = 0; i < 5; i++) {
      await limits.increment('ip:1.2.3.4').catch(() => null);
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('shared');
    expect(lines[0][3]).toMatch(/unavailable, refusing/u);

    // A second feature is a second line: they fail for their own reasons
    await store
      .rateLimitStore('auth')
      .increment('ip:1.2.3.4')
      .catch(() => null);
    expect(lines).toHaveLength(2);
  });

  test('a fail-open outage says it is serving uncounted', async () => {
    const lines = [];
    const store = shared({ onError: 'open' });

    store.henri = { pen: { error: (...args) => lines.push(args) } };
    store.backend.fail();

    await store.rateLimitStore('global').increment('ip:1.2.3.4');

    expect(lines[0][3]).toMatch(/unavailable, serving uncounted/u);
  });

  test('a boot that cannot reach the backend does not fail', async () => {
    const store = shared();

    store.backend.fail();

    expect(await store.start()).toBe(false);
    expect(store.healthy).toBe(false);
    await expect(store.ping()).rejects.toThrow('connection refused');
  });

  test('stop closes the backend and every store it handed out', async () => {
    const store = shared();
    const released = [];

    store.stores.push({ shutdown: () => released.push('one') });
    store.rateLimitStore('global');

    await store.stop();

    expect(released).toEqual(['one']);
    expect(store.backend.stopped).toBe(1);
    expect(store.stores).toHaveLength(0);
  });
});

describe('saying it out loud', () => {
  test('nothing in the environment says there is more than one process', () => {
    expect(manyProcesses({}, { isWorker: false })).toBeNull();
    expect(
      manyProcesses({ NODE_APP_INSTANCE: '0', WEB_CONCURRENCY: '1' }, {})
    ).toBeNull();
    expect(manyProcesses({ DYNO: 'web.1' }, {})).toBeNull();
  });

  test('a cluster worker, pm2, WEB_CONCURRENCY and a dyno do', () => {
    expect(manyProcesses({}, { isWorker: true })).toBe(
      'this process is a cluster worker'
    );
    expect(manyProcesses({ NODE_APP_INSTANCE: '2' }, {})).toBe(
      'pm2 instance 2'
    );
    expect(manyProcesses({ WEB_CONCURRENCY: '4' }, {})).toBe(
      'WEB_CONCURRENCY is 4'
    );
    expect(manyProcesses({ DYNO: 'web.3' }, {})).toBe('dyno web.3');
  });
});
