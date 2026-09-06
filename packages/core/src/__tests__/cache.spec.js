const {
  Cache,
  DEFAULTS,
  MAX_KEY_LENGTH,
  MemoryBackend,
  bound,
  bytes,
  cacheConfig,
  cacheKey,
  createCache,
  decode,
  duration,
  encode,
  formatBytes,
  formatDuration,
  maskKey,
} = require('../base/cache');

const CacheModule = require('../3.cache');
const Config = require('../0.config');
const Henri = require('../henri');

/**
 * A henri look-alike: the configuration, and a pen that keeps its lines
 *
 * @param {object} [config={}] the configuration
 * @param {object} [flags={}] overrides (`shared`, `cwd`, ...)
 * @returns {object} the fake
 */
const fakeHenri = (config = {}, flags = {}) => {
  const logged = [];

  return Object.assign(
    {
      config: {
        get: (key) => config[key],
        has: (key) => Object.prototype.hasOwnProperty.call(config, key),
      },
      cwd: () => __dirname,
      isDev: false,
      isProduction: false,
      isTest: true,
      logged,
      pen: {
        error: (...args) => logged.push(['error', ...args]),
        info: (...args) => logged.push(['info', ...args]),
        warn: (...args) => logged.push(['warn', ...args]),
      },
      shared: null,
      utils: { resolveFrom: require('../utils').resolveFrom },
    },
    flags
  );
};

/**
 * A cache on a backend of its own
 *
 * @param {object} [settings={}] overrides of `config.cache`
 * @param {object} [options={}] `store` and `henri`
 * @returns {Cache} the cache
 */
const cacheWith = (settings = {}, options = {}) => {
  const merged = Object.assign({}, DEFAULTS, settings);

  return new Cache({
    henri: options.henri || fakeHenri(),
    settings: merged,
    store: options.store || new MemoryBackend(merged),
  });
};

/**
 * A backend that fails every call, like one that is down
 *
 * @returns {object} the store
 */
const brokenStore = () => ({
  /**
   * Fails
   *
   * @returns {Promise<never>} never
   */
  clear: async () => {
    throw new Error('ECONNREFUSED');
  },
  /**
   * Fails
   *
   * @returns {Promise<never>} never
   */
  delete: async () => {
    throw new Error('ECONNREFUSED');
  },
  /**
   * Fails
   *
   * @returns {Promise<never>} never
   */
  get: async () => {
    throw new Error('ECONNREFUSED');
  },

  name: 'broken',

  /**
   * Fails
   *
   * @returns {Promise<never>} never
   */
  set: async () => {
    throw new Error('ECONNREFUSED');
  },
});

describe('the cache', () => {
  describe('durations and sizes', () => {
    test('reads what the configuration writes', () => {
      expect(duration('5m')).toBe(300000);
      expect(duration(250)).toBe(250);
      expect(duration('30 s')).toBe(30000);
      expect(duration('1d')).toBe(86400000);
      expect(duration('nope', 42)).toBe(42);
      expect(duration(0, 42)).toBe(42);
      expect(duration(null, 42)).toBe(42);
      expect(bytes('256kb')).toBe(262144);
      expect(bytes('1mb')).toBe(1048576);
      expect(bytes(2048)).toBe(2048);
      expect(bytes('huge', 7)).toBe(7);
    });

    test('prints them the way the documentation does', () => {
      expect(formatBytes(262144)).toBe('256kb');
      expect(formatBytes(900)).toBe('900b');
      expect(formatDuration(300000)).toBe('5m');
      expect(formatDuration(250)).toBe('250ms');
      expect(formatDuration(86400000)).toBe('1d');
    });
  });

  describe('config.cache', () => {
    test('defaults to a bounded cache in this process', () => {
      expect(cacheConfig(null)).toEqual(DEFAULTS);
      expect(cacheConfig({ get: () => null, has: () => false })).toEqual(
        DEFAULTS
      );
    });

    test('false turns it off, without removing henri.cache', () => {
      const settings = cacheConfig({ get: () => false, has: () => true });

      expect(settings.enabled).toBe(false);
    });

    test('reads the durations and the sizes', () => {
      const settings = cacheConfig({
        get: () => ({
          maxEntries: 10,
          maxEntrySize: '1kb',
          maxSize: '2mb',
          ttl: '30s',
        }),
        has: () => true,
      });

      expect(settings).toEqual({
        enabled: true,
        maxEntries: 10,
        maxEntrySize: 1024,
        maxSize: 2097152,
        store: null,
        ttl: 30000,
      });
    });

    test('never lets one entry be bigger than everything', () => {
      const settings = cacheConfig({
        get: () => ({ maxEntrySize: '10mb', maxSize: '1mb' }),
        has: () => true,
      });

      expect(settings.maxEntrySize).toBe(settings.maxSize);
    });

    test('refuses a block that is not one', () => {
      expect(() =>
        cacheConfig({ get: () => 'redis', has: () => true })
      ).toThrow(/must be an object/u);
    });
  });

  describe('keys', () => {
    test('are made out of what a caller keys on', () => {
      expect(cacheKey('top')).toBe('top');
      expect(cacheKey(12)).toBe('12');
      expect(cacheKey(true)).toBe('true');
      expect(cacheKey(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
      expect(cacheKey(['user', 12, 'posts'])).toBe('user/12/posts');
      expect(cacheKey([['a', 'b'], 'c'])).toBe('a/b/c');
    });

    test('do not depend on the order the keys of an object were written', () => {
      expect(cacheKey({ page: 2, sort: 'name' })).toBe(
        // eslint-disable-next-line sort-keys -- the point of the test
        cacheKey({ sort: 'name', page: 2 })
      );
    });

    test('let an object answer for itself', () => {
      const record = { cacheKey: () => ['memo', 7] };

      expect(cacheKey(record)).toBe('memo/7');
    });

    test('refuse what cannot become one', () => {
      for (const value of [
        null,
        undefined,
        '',
        '   ',
        [],
        NaN,
        new Date('nope'),
        () => 1,
        new (class Memo {})(),
        'with\na newline',
      ]) {
        let error = null;

        try {
          cacheKey(value);
        } catch (thrown) {
          error = thrown;
        }

        expect(error && error.code).toBe('HENRI_CACHE_KEY_INVALID');
      }
    });

    test('are shortened, deterministically, past the bound', () => {
      const long = `memo:${'x'.repeat(400)}`;
      const short = bound(long);

      expect(short).toHaveLength(MAX_KEY_LENGTH);
      expect(short).toBe(bound(long));
      expect(short.startsWith('memo:xxx')).toBe(true);
      expect(bound(`${long}!`)).not.toBe(short);
      expect(bound('short')).toBe('short');
    });

    test('are masked in a log line when they name a filtered parameter', () => {
      const filters = ['password', 'token'];

      expect(maskKey('memo:7', filters)).toBe('memo:7');
      expect(maskKey('reset-token:abc123', filters)).toBe('[FILTERED]');
    });
  });

  describe('what a value may be', () => {
    test('keeps what JSON keeps', () => {
      const value = {
        list: [1, 'two', false, null],
        nested: { deep: { ok: true } },
        number: 1.5,
      };

      expect(decode(encode(value))).toEqual(value);
      expect(decode(encode(null))).toBe(null);
      expect(decode(encode(0))).toBe(0);
      expect(decode(encode(''))).toBe('');
      expect(decode(encode(false))).toBe(false);
    });

    test('brings a Date back as a Date', () => {
      const when = new Date('2024-03-01T10:00:00.000Z');
      const back = decode(encode({ list: [when], when }));

      expect(back.when).toBeInstanceOf(Date);
      expect(back.when.getTime()).toBe(when.getTime());
      expect(back.list[0]).toBeInstanceOf(Date);
    });

    test('brings an object holding a tag of henri back as it went in', () => {
      for (const value of [
        { $date: 'not a date' },
        { $esc: 1 },
        { $esc: { $esc: 1, other: 2 } },
        { $date: 'x', other: { $esc: [1, 2] } },
        // eslint-disable-next-line sort-keys -- the tag is what matters here
        { when: new Date(0), $esc: 'kept' },
      ]) {
        expect(decode(encode(value))).toEqual(value);
      }
    });

    test('drops an undefined property, the way JSON does', () => {
      // eslint-disable-next-line sort-keys -- an undefined value, wherever it sits
      expect(decode(encode({ b: 2, a: undefined }))).toEqual({ b: 2 });
    });

    test('refuses everything that would come back wrong', () => {
      const circular = { name: 'loop' };

      circular.self = circular;

      for (const value of [
        undefined,
        [undefined],
        NaN,
        Infinity,
        new Date('nope'),
        new Map([['a', 1]]),
        new Set([1]),
        Buffer.from('hi'),
        /regexp/u,
        () => 1,
        Symbol('nope'),
        10n,
        new (class Memo {
          constructor() {
            this.id = 1;
          }
        })(),
        { rows: [new (class Memo {})()] },
        circular,
      ]) {
        let error = null;

        try {
          encode(value);
        } catch (thrown) {
          error = thrown;
        }

        expect(error && error.code).toBe('HENRI_CACHE_VALUE_UNSUPPORTED');
      }
    });

    test('says where the refused value sits, and never what it is', () => {
      const secret = new (class Session {
        constructor() {
          this.password = 'hunter2';
        }
      })();

      let message = '';

      try {
        encode({ user: { session: secret } });
      } catch (error) {
        message = error.message;
      }

      expect(message).toContain('the value.user.session');
      expect(message).toContain('an instance of Session');
      expect(message).not.toContain('hunter2');
    });

    test('reads an entry it did not write as a miss', () => {
      expect(decode('{not json')).toBeUndefined();
      expect(decode(undefined)).toBeUndefined();
      expect(decode(null)).toBeUndefined();
    });
  });

  describe('the memory backend', () => {
    test('forgets an entry when its ttl has run out', async () => {
      let now = 1000;
      const store = new MemoryBackend({ now: () => now });
      const cache = cacheWith({}, { store });

      await cache.set('memo', { id: 1 }, { ttl: '1s' });
      expect(await cache.get('memo')).toEqual({ id: 1 });

      now += 1001;
      expect(await cache.get('memo')).toBeUndefined();
      expect(store.entries.size).toBe(0);
    });

    test('sweeps what expired, without waiting for a reader', async () => {
      let now = 1000;
      const store = new MemoryBackend({ now: () => now });

      await store.set('a', 'one', 500);
      await store.set('b', 'two', 5000);

      now += 1000;

      expect(store.sweep()).toBe(1);
      expect(store.entries.size).toBe(1);
      expect(store.usage().bytes).toBeGreaterThan(0);
    });

    test('evicts the least recently used to stay under maxEntries', async () => {
      const store = new MemoryBackend({ maxEntries: 3 });
      const cache = cacheWith({}, { store });

      await cache.set('a', 1);
      await cache.set('b', 2);
      await cache.set('c', 3);
      // `a` is now the most recently used, `b` the least
      await cache.get('a');
      await cache.set('d', 4);

      expect(await cache.get('b')).toBeUndefined();
      expect(await cache.get('a')).toBe(1);
      expect(store.entries.size).toBe(3);
      expect(store.evictions).toBe(1);
    });

    test('evicts to stay under maxSize, and keeps its byte count honest', async () => {
      const store = new MemoryBackend({ maxEntries: 100, maxSize: 200 });

      for (let index = 0; index < 20; index += 1) {
        await store.set(`key-${index}`, 'x'.repeat(30), 60000);
      }

      expect(store.size).toBeLessThanOrEqual(200);
      expect(store.evictions).toBeGreaterThan(0);
      expect(store.size).toBe(
        [...store.entries.values()].reduce(
          (total, entry) => total + entry.weight,
          0
        )
      );
    });

    test('cannot become a leak: a value bigger than everything is refused', async () => {
      const store = new MemoryBackend({ maxSize: 50 });

      expect(await store.set('big', 'x'.repeat(100), 60000)).toBe(false);
      expect(store.entries.size).toBe(0);
    });

    test('stops its timer when the cache stops', async () => {
      const cache = cacheWith();

      await cache.set('a', 1);
      await cache.stop();

      expect(cache.store.entries.size).toBe(0);
    });
  });

  describe('get, set and delete', () => {
    test('answer undefined for a miss and the value for a hit', async () => {
      const cache = cacheWith();

      expect(await cache.get('nothing')).toBeUndefined();
      expect(await cache.set('memo', { id: 1 })).toBe(true);
      expect(await cache.get('memo')).toEqual({ id: 1 });
    });

    test('tell a cached null from a miss', async () => {
      const cache = cacheWith();

      await cache.set('nobody', null);

      expect(await cache.get('nobody')).toBe(null);
      expect(await cache.get('nobody else')).toBeUndefined();
    });

    test('hand every reader a copy of its own', async () => {
      const cache = cacheWith();

      await cache.set('memo', { tags: ['one'] });

      const first = await cache.get('memo');

      first.tags.push('two');

      expect((await cache.get('memo')).tags).toEqual(['one']);
    });

    test('forget a key on delete, and only that one', async () => {
      const cache = cacheWith();

      await cache.set('a', 1);
      await cache.set('b', 2);

      expect(await cache.delete('a')).toBe(true);
      expect(await cache.get('a')).toBeUndefined();
      expect(await cache.get('b')).toBe(2);
    });

    test('refuse a ttl that is not a duration', async () => {
      const cache = cacheWith();
      let error = null;

      try {
        await cache.set('a', 1, { ttl: 'forever' });
      } catch (thrown) {
        error = thrown;
      }

      expect(error && error.code).toBe('HENRI_CACHE_TTL_INVALID');
    });

    test('do not store a value bigger than maxEntrySize, and say so once', async () => {
      const henri = fakeHenri();
      const cache = cacheWith({ maxEntrySize: 64 }, { henri });

      expect(await cache.set('big', 'x'.repeat(200))).toBe(false);
      expect(await cache.get('big')).toBeUndefined();
      expect(await cache.set('big', 'x'.repeat(200))).toBe(false);

      const warnings = henri.logged.filter(([level]) => level === 'warn');

      expect(warnings).toHaveLength(1);
      expect(warnings[0].join(' ')).toContain('maxEntrySize');
    });

    test('forget what a value too big to keep was replacing', async () => {
      const cache = cacheWith({ maxEntrySize: 64 });

      await cache.set('memo', 'small');

      expect(await cache.set('memo', 'x'.repeat(200))).toBe(false);
      expect(await cache.get('memo')).toBeUndefined();
    });

    test('mask a key that names a filtered parameter when they report', async () => {
      const henri = fakeHenri();
      const cache = cacheWith({ maxEntrySize: 16 }, { henri });

      await cache.set('reset-token:abc123', 'x'.repeat(100));

      const warnings = henri.logged.filter(([level]) => level === 'warn');

      expect(warnings[0].join(' ')).toContain('[FILTERED]');
      expect(warnings[0].join(' ')).not.toContain('abc123');
    });
  });

  describe('scopes', () => {
    test('keep two features from colliding on one key', async () => {
      const cache = cacheWith();
      const reports = cache.scope('reports');
      const boards = cache.scope('boards');

      await reports.set('daily', 'a report');
      await boards.set('daily', 'a board');

      expect(await reports.get('daily')).toBe('a report');
      expect(await boards.get('daily')).toBe('a board');
      expect(await cache.get('daily')).toBeUndefined();
    });

    test('clear only their own keys', async () => {
      const cache = cacheWith();
      const reports = cache.scope('reports');

      await cache.set('kept', 1);
      await reports.set('daily', 2);

      expect(await reports.clear()).toBe(1);
      expect(await reports.get('daily')).toBeUndefined();
      expect(await cache.get('kept')).toBe(1);

      expect(await cache.clear()).toBe(1);
      expect(await cache.get('kept')).toBeUndefined();
    });

    test('share the counters and the single flight of the cache', async () => {
      const cache = cacheWith();

      await cache.scope('reports').set('daily', 1);

      expect(cache.stats().writes).toBe(1);
    });

    test('refuse to clear a backend that cannot', async () => {
      const store = {
        delete: async () => true,
        get: async () => undefined,
        name: 'clearless',
        set: async () => true,
      };
      const cache = cacheWith({}, { store });
      let error = null;

      try {
        await cache.clear();
      } catch (thrown) {
        error = thrown;
      }

      expect(error && error.code).toBe('HENRI_CACHE_STORE_INCAPABLE');
    });
  });

  describe('fetch', () => {
    test('answers from the cache, and runs the function once for a miss', async () => {
      const cache = cacheWith();
      let runs = 0;

      /**
       * The expensive thing
       *
       * @returns {Promise<object>} the answer
       */
      const expensive = async () => {
        runs += 1;

        return { runs };
      };

      expect(await cache.fetch('memo', expensive)).toEqual({ runs: 1 });
      expect(await cache.fetch('memo', expensive)).toEqual({ runs: 1 });
      expect(runs).toBe(1);
    });

    test('runs the function once for a hundred concurrent misses', async () => {
      const cache = cacheWith();
      let runs = 0;

      const answers = await Promise.all(
        Array.from({ length: 100 }, () =>
          cache.fetch('leaderboard', async () => {
            runs += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));

            return { runs };
          })
        )
      );

      expect(runs).toBe(1);
      expect(answers).toHaveLength(100);
      expect(answers.every((answer) => answer.runs === 1)).toBe(true);
      expect(cache.stats().inflight).toBe(0);
    });

    test('takes a ttl, and lets the entry expire', async () => {
      let now = 1000;
      const store = new MemoryBackend({ now: () => now });
      const cache = cacheWith({}, { store });
      let runs = 0;

      /**
       * The expensive thing
       *
       * @returns {number} the run count
       */
      const expensive = () => {
        runs += 1;

        return runs;
      };

      await cache.fetch('memo', { ttl: '1s' }, expensive);
      now += 1001;
      await cache.fetch('memo', { ttl: '1s' }, expensive);

      expect(runs).toBe(2);
    });

    test('caches null, because "there is nothing" is an answer', async () => {
      const cache = cacheWith();
      let runs = 0;

      /**
       * A lookup that finds nothing
       *
       * @returns {null} nothing
       */
      const missing = () => {
        runs += 1;

        return null;
      };

      expect(await cache.fetch('gone', missing)).toBe(null);
      expect(await cache.fetch('gone', missing)).toBe(null);
      expect(runs).toBe(1);
    });

    test('caches nothing when the function throws, and rejects every waiter', async () => {
      const cache = cacheWith();
      let runs = 0;

      /**
       * A lookup that fails
       *
       * @returns {Promise<never>} never
       */
      const failing = async () => {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));

        throw new Error('the database is on fire');
      };

      const waiters = Array.from({ length: 5 }, () =>
        cache.fetch('memo', failing).catch((error) => error.message)
      );

      expect(await Promise.all(waiters)).toEqual(
        Array.from({ length: 5 }, () => 'the database is on fire')
      );
      expect(runs).toBe(1);
      expect(await cache.get('memo')).toBeUndefined();
      expect(cache.stats().inflight).toBe(0);

      // And the next call is free to try again
      await expect(cache.fetch('memo', failing)).rejects.toThrow(/on fire/u);
      expect(runs).toBe(2);
    });

    test('force runs the function and writes what it answered', async () => {
      const cache = cacheWith();

      await cache.set('memo', 'old');

      expect(await cache.fetch('memo', { force: true }, () => 'new')).toBe(
        'new'
      );
      expect(await cache.get('memo')).toBe('new');
    });

    test('refuses a value the cache cannot keep, from the function too', async () => {
      const cache = cacheWith();
      let error = null;

      try {
        await cache.fetch('memo', () => new (class Memo {})());
      } catch (thrown) {
        error = thrown;
      }

      expect(error && error.code).toBe('HENRI_CACHE_VALUE_UNSUPPORTED');
    });

    test('needs a function', async () => {
      const cache = cacheWith();

      await expect(cache.fetch('memo')).rejects.toThrow(/needs a function/u);
    });
  });

  describe('when the cache is turned off', () => {
    test('every fetch runs its function and nothing is kept', async () => {
      const cache = cacheWith({ enabled: false });
      let runs = 0;

      /**
       * The expensive thing
       *
       * @returns {number} the run count
       */
      const expensive = () => {
        runs += 1;

        return runs;
      };

      expect(await cache.fetch('memo', expensive)).toBe(1);
      expect(await cache.fetch('memo', expensive)).toBe(2);
      expect(await cache.set('memo', 1)).toBe(false);
      expect(await cache.get('memo')).toBeUndefined();
      expect(await cache.delete('memo')).toBe(false);
      expect(await cache.clear()).toBe(0);
    });
  });

  describe('when the backend is down', () => {
    test('a read is a miss and a fetch still answers', async () => {
      const henri = fakeHenri();
      const cache = cacheWith({}, { henri, store: brokenStore() });

      expect(await cache.get('memo')).toBeUndefined();
      expect(await cache.fetch('memo', () => 'computed')).toBe('computed');
      expect(await cache.set('memo', 'value')).toBe(false);
      expect(await cache.delete('memo')).toBe(false);
      expect(await cache.clear()).toBe(0);
    });

    test('it is said out loud, at most once every ten seconds per call', async () => {
      const henri = fakeHenri();
      const cache = cacheWith({}, { henri, store: brokenStore() });

      for (let index = 0; index < 20; index += 1) {
        await cache.get('memo');
        await cache.set('memo', 1);
      }

      const warnings = henri.logged.filter(([level]) => level === 'warn');

      expect(warnings).toHaveLength(2);
      expect(warnings.map((line) => line.join(' ')).join(' ')).toContain(
        'treating it as a miss'
      );
      expect(cache.stats().errors).toBe(40);
    });
  });

  describe('the backend it ends up on', () => {
    test('is this process without a shared store', () => {
      const settings = cacheConfig(null);
      const store = createCache(fakeHenri(), settings);

      expect(store).toBeInstanceOf(MemoryBackend);
      expect(store.maxEntries).toBe(DEFAULTS.maxEntries);
      store.shutdown();
    });

    test('is the shared backend when config.shared names one', () => {
      const asked = [];
      const henri = fakeHenri(
        {},
        {
          shared: {
            name: 'redis',
            unguarded: (feature, options) => {
              asked.push([feature, options]);

              return { name: 'redis' };
            },
          },
        }
      );
      const store = createCache(henri, cacheConfig(null));

      expect(store.name).toBe('redis');
      expect(asked).toEqual([['cache', { raw: true }]]);
    });

    test('is what cache.store names, over the shared one', () => {
      const henri = fakeHenri(
        {},
        { shared: { name: 'redis', unguarded: () => ({ name: 'redis' }) } }
      );
      const settings = Object.assign({}, DEFAULTS, {
        store: './fixtures/cache-store',
      });
      const store = createCache(henri, settings);

      expect(store.name).toBe('fixture');
    });

    test('says what it is in one line', () => {
      const cache = cacheWith();

      expect(cache.describe()).toBe(
        '5m default ttl, 1000 entries, 32mb, 256kb per entry'
      );
    });
  });

  describe('the module', () => {
    /**
     * A henri with the configuration and the cache, and nothing else: the
     * cache needs `config` and only follows the server when there is one
     *
     * @returns {Promise<object>} the booted instance
     */
    const boot = async () => {
      const instance = new Henri({ runlevel: 3 });

      instance.modules.add(new Config());
      instance.modules.add(new CacheModule());

      await instance.modules.init();

      return instance;
    };

    test('is henri.cache, and it works end to end', async () => {
      const instance = await boot();

      expect(instance.cache.name).toBe('cache');
      expect(instance.cache.settings.ttl).toBe(DEFAULTS.ttl);
      expect(await instance.cache.fetch('memo', () => ({ id: 1 }))).toEqual({
        id: 1,
      });
      expect(await instance.cache.get('memo')).toEqual({ id: 1 });
      expect(instance.cache.stats().backend).toBe('memory');

      await instance.stop();
    });

    test('waits for the server, which is where config.shared is built', () => {
      const module = new CacheModule();

      expect(module.name).toBe('cache');
      expect(module.needs).toEqual(['config']);
      expect(module.after).toEqual(['server']);
      expect(module.before).toEqual(['router']);
      expect(module.runlevel).toBe(3);
    });

    test('drops what this process cached on a reload, never a shared one', async () => {
      const instance = await boot();

      await instance.cache.set('memo', 1);
      await instance.cache.reload();

      expect(await instance.cache.get('memo')).toBeUndefined();

      instance.cache.cache.name = 'redis';
      await instance.cache.set('memo', 1);
      await instance.cache.reload();

      expect(await instance.cache.get('memo')).toBe(1);

      await instance.stop();
    });

    test('warns when the cache is per process and there are several', () => {
      const module = new CacheModule();

      module.henri = fakeHenri();
      module.cache = cacheWith({}, { henri: module.henri });

      expect(module.warnUnshared()).toBe(false);

      const instances = process.env.NODE_APP_INSTANCE;

      process.env.NODE_APP_INSTANCE = '3';

      expect(module.warnUnshared()).toBe(true);
      expect(module.henri.logged[0].join(' ')).toContain('pm2 instance 3');

      module.cache.name = 'redis';
      expect(module.warnUnshared()).toBe(false);

      if (typeof instances === 'undefined') {
        delete process.env.NODE_APP_INSTANCE;
      } else {
        process.env.NODE_APP_INSTANCE = instances;
      }
    });
  });
});
