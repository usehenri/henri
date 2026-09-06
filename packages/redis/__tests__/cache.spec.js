const {
  Cache,
  DEFAULTS,
  cacheConfig,
} = require('@usehenri/core/src/base/cache');
const { SharedStore } = require('@usehenri/core/src/base/shared');

const Backend = require('../index');
const { clear, live, prefix, url } = require('./targets');

/**
 * The little of henri the cache reads
 *
 * @returns {object} a henri look-alike keeping what it logged
 */
const fakeHenri = () => {
  const logged = [];

  return {
    config: { get: () => undefined, has: () => false },
    isTest: true,
    logged,
    pen: {
      error: (...args) => logged.push(['error', ...args]),
      info: (...args) => logged.push(['info', ...args]),
      warn: (...args) => logged.push(['warn', ...args]),
    },
  };
};

describe.skipIf(!live)('the cache on a live Redis', () => {
  const open = [];

  /**
   * A started backend, closed when the file is done
   *
   * @param {string} name what the keys are for
   * @param {object} [settings={}] overrides
   * @returns {Promise<object>} the backend
   */
  const started = async (name, settings = {}) => {
    const backend = new Backend(
      Object.assign({ adapter: 'redis', prefix: prefix(name), url }, settings)
    );

    await backend.start();
    open.push(backend);

    return backend;
  };

  /**
   * A cache on a backend, the way core builds one
   *
   * @param {object} backend the backend
   * @param {object} [settings={}] overrides of `config.cache`
   * @param {object} [henri=fakeHenri()] the henri look-alike
   * @returns {Cache} the cache
   */
  const cacheOn = (backend, settings = {}, henri = fakeHenri()) => {
    const shared = new SharedStore(
      backend,
      { adapter: 'redis', onError: 'closed' },
      henri
    );

    return new Cache({
      henri,
      settings: Object.assign({}, DEFAULTS, settings),
      store: shared.unguarded('cache', { raw: true }),
    });
  };

  afterAll(async () => {
    for (const backend of open) {
      await clear(backend, backend.prefix).catch(() => 0);
      await backend.stop();
    }
  });

  test('keeps a value, and brings a Date back as a Date', async () => {
    const cache = cacheOn(await started('cache-values'));
    const when = new Date('2024-03-01T10:00:00.000Z');

    // What the boot line says, and what tells `henri.cache.stats()` apart
    // from the same cache in the process memory
    expect(cache.name).toBe('redis');
    expect(cache.describe()).toBe('5m default ttl, 256kb per entry');

    expect(await cache.set(['memo', 7], { tags: ['a'], when })).toBe(true);

    const back = await cache.get(['memo', 7]);

    expect(back.tags).toEqual(['a']);
    expect(back.when).toBeInstanceOf(Date);
    expect(back.when.getTime()).toBe(when.getTime());
    expect(await cache.get(['memo', 8])).toBeUndefined();
  });

  test('writes the encoded entry itself, without wrapping it in JSON again', async () => {
    const backend = await started('cache-raw');
    const cache = cacheOn(backend);
    const client = await backend.connected();

    await cache.set('memo', { id: 1 });

    expect(await client.get(`${backend.prefix}kv:cache:memo`)).toBe('{"id":1}');
  });

  test('lets Redis expire an entry, in milliseconds', async () => {
    const backend = await started('cache-ttl');
    const cache = cacheOn(backend);
    const client = await backend.connected();

    await cache.set('short', 'value', { ttl: '30s' });

    const left = await client.pTTL(`${backend.prefix}kv:cache:short`);

    expect(left).toBeGreaterThan(25000);
    expect(left).toBeLessThanOrEqual(30000);

    await cache.set('shorter', 'value', { ttl: 60 });
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(await cache.get('shorter')).toBeUndefined();
  });

  test('two processes share one cache', async () => {
    const keys = prefix('cache-shared');
    const one = cacheOn(await started('cache-shared', { prefix: keys }));
    const two = cacheOn(await started('cache-shared', { prefix: keys }));

    await one.set('leaderboard', [1, 2, 3]);

    expect(await two.get('leaderboard')).toEqual([1, 2, 3]);

    // And what one forgets, the other stops seeing: the whole reason a
    // deployment that invalidates keys wants a shared backend
    await two.delete('leaderboard');
    expect(await one.get('leaderboard')).toBeUndefined();
  });

  test('runs the function once for a hundred concurrent misses', async () => {
    const cache = cacheOn(await started('cache-stampede'));
    let runs = 0;

    const answers = await Promise.all(
      Array.from({ length: 100 }, () =>
        cache.fetch('leaderboard', async () => {
          runs += 1;
          await new Promise((resolve) => setTimeout(resolve, 25));

          return { runs };
        })
      )
    );

    expect(runs).toBe(1);
    expect(answers.every((answer) => answer.runs === 1)).toBe(true);
  });

  test('clears its own key space, and only its own', async () => {
    const backend = await started('cache-clear');
    const cache = cacheOn(backend);
    const reports = cache.scope('reports');
    const client = await backend.connected();

    await client.set(`${backend.prefix}kv:idempotency:kept`, 'not the cache');
    await cache.set('kept', 1);
    await reports.set('daily', 2);
    await reports.set('weekly', 3);

    expect(await reports.clear()).toBe(2);
    expect(await reports.get('daily')).toBeUndefined();
    expect(await cache.get('kept')).toBe(1);

    expect(await cache.clear()).toBe(1);
    expect(await client.get(`${backend.prefix}kv:idempotency:kept`)).toBe(
      'not the cache'
    );
  });

  // Not the same thing as `stop()`, which the driver undoes by reconnecting
  // on the next command: this is a server that is not there at all
  test('a server that does not answer is a miss, never a failed request', async () => {
    const henri = fakeHenri();
    const backend = new Backend({
      adapter: 'redis',
      connectTimeout: 200,
      prefix: prefix('cache-down'),
      url: 'redis://127.0.0.1:1',
    });
    const cache = cacheOn(backend, {}, henri);

    expect(await cache.get('memo')).toBeUndefined();
    expect(await cache.set('memo', 'kept')).toBe(false);
    expect(await cache.fetch('memo', () => 'computed')).toBe('computed');

    const warnings = henri.logged.filter(([level]) => level === 'warn');

    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.map((line) => line.join(' ')).join(' ')).toContain(
      'treating it as a miss'
    );

    await backend.stop();
  });

  test('the settings core reads are the ones a cache is built with', () => {
    expect(cacheConfig(null).ttl).toBe(DEFAULTS.ttl);
  });
});
