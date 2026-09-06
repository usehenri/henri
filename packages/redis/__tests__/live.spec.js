const express = require('express');
const supertest = require('supertest');

const { SharedStore } = require('@usehenri/core/src/base/shared');
const Lockout = require('@usehenri/core/src/base/lockout');
const boom = require('@usehenri/core/src/base/boom');
const { errorHandler } = require('@usehenri/core/src/base/http');
const {
  MemoryStore,
  idempotency,
} = require('@usehenri/core/src/base/idempotency');

const Backend = require('../index');
const { clear, live, prefix, url } = require('./targets');

/**
 * The little of henri the idempotency middleware reads
 *
 * @param {object} store what `henri.api.idempotencyStore` answers
 * @returns {object} a henri look-alike
 */
const fakeHenri = (store) => ({
  api: { idempotencyStore: store },
  isDev: false,
  isProduction: false,
  isTest: true,
  pen: { error: () => {}, info: () => {}, warn: () => {} },
});

/**
 * A backend on the live server, with a key space of its own
 *
 * @param {string} name what the keys are for
 * @param {object} [settings={}] overrides
 * @returns {object} a started backend
 */
const backendFor = (name, settings = {}) =>
  new Backend(
    Object.assign({ adapter: 'redis', prefix: prefix(name), url }, settings)
  );

/**
 * The shared store core would build around one
 *
 * @param {object} backend the backend
 * @param {string} [onError='closed'] the failure policy
 * @returns {SharedStore} the store
 */
const sharedOn = (backend, onError = 'closed') =>
  new SharedStore(backend, { adapter: 'redis', onError }, null);

describe.skipIf(!live)('@usehenri/redis against a live server', () => {
  const open = [];

  /**
   * A started backend, closed when the file is done
   *
   * @param {string} name what the keys are for
   * @param {object} [settings={}] overrides
   * @returns {Promise<object>} the backend
   */
  const started = async (name, settings = {}) => {
    const backend = backendFor(name, settings);

    await backend.start();
    open.push(backend);

    return backend;
  };

  afterAll(async () => {
    for (const backend of open) {
      await clear(backend, backend.prefix).catch(() => 0);
      await backend.stop();
    }
  });

  test('answers a ping', async () => {
    const backend = await started('ping');

    expect(await backend.ping()).toBe(true);
  });

  test('counts a rate limit, with the window Redis keeps', async () => {
    const backend = await started('limit');
    const store = backend.rateLimitStore('global');

    await store.init({ windowMs: 5000 });

    const first = await store.increment('ip:1.2.3.4');
    const second = await store.increment('ip:1.2.3.4');

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(second.resetTime.getTime()).toBeGreaterThan(Date.now());

    await store.resetKey('ip:1.2.3.4');
    expect((await store.increment('ip:1.2.3.4')).totalHits).toBe(1);
  });

  // The point of the whole tranche: two connections, one counter
  test('two processes share one rate limit, not one each', async () => {
    const keys = prefix('two-processes');
    const one = await started('two-processes', { prefix: keys });
    const two = await started('two-processes', { prefix: keys });

    expect(one.client).not.toBe(two.client);

    const first = sharedOn(one).rateLimitStore('global');
    const second = sharedOn(two).rateLimitStore('global');

    first.init({ windowMs: 10000 });
    second.init({ windowMs: 10000 });

    for (let i = 0; i < 5; i++) {
      await first.increment('ip:9.9.9.9');
      await second.increment('ip:9.9.9.9');
    }

    // Ten requests, ten hits: in memory each process would have counted five
    expect((await first.get('ip:9.9.9.9')).totalHits).toBe(10);
    expect((await second.get('ip:9.9.9.9')).totalHits).toBe(10);
  });

  test('two processes share one lockout', async () => {
    const keys = prefix('two-lockouts');
    const one = await started('two-lockouts', { prefix: keys });
    const two = await started('two-lockouts', { prefix: keys });
    const options = { max: 3, secret: 'pepper', windowMs: 10000 };
    const first = new Lockout(
      Object.assign({ store: sharedOn(one).rateLimitStore('lockout') }, options)
    );
    const second = new Lockout(
      Object.assign({ store: sharedOn(two).rateLimitStore('lockout') }, options)
    );

    await first.fail('victim@example.com');
    await second.fail('victim@example.com');
    expect((await second.check('victim@example.com')).locked).toBe(false);

    // The third failure locks the account, whichever process sees it
    expect((await first.fail('victim@example.com')).locked).toBe(true);

    const verdict = await second.check('victim@example.com');

    expect(verdict.locked).toBe(true);
    expect(verdict.retryAfter).toBeGreaterThan(0);

    await first.succeed('victim@example.com');
    expect((await second.check('victim@example.com')).locked).toBe(false);
  });

  test('an idempotency key is claimed once, whoever races for it', async () => {
    const keys = prefix('race');
    const backends = await Promise.all([
      started('race', { prefix: keys }),
      started('race', { prefix: keys }),
      started('race', { prefix: keys }),
      started('race', { prefix: keys }),
    ]);
    const stores = backends.map((backend) =>
      sharedOn(backend).keyValueStore('idempotency')
    );

    const claims = await Promise.all(
      stores.map((store) => store.add('same-key', { state: 'pending' }, 5000))
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await stores[3].get('same-key')).toEqual({ state: 'pending' });

    await stores[0].set('same-key', { state: 'done', status: 201 }, 5000);
    expect(await stores[1].get('same-key')).toEqual({
      state: 'done',
      status: 201,
    });

    await stores[2].delete('same-key');
    expect(await stores[0].get('same-key')).toBeUndefined();
  });

  test('an entry expires when its ttl runs out', async () => {
    const backend = await started('ttl');
    const store = backend.keyValueStore('idempotency');

    await store.set('short', { state: 'done' }, 50);
    expect(await store.get('short')).toEqual({ state: 'done' });

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await store.get('short')).toBeUndefined();
  });

  test('an entry something else wrote is forgotten, not thrown', async () => {
    const backend = await started('garbage');
    const store = backend.keyValueStore('idempotency');
    const client = await backend.connected();

    await client.set(store.key('junk'), 'not json', { PX: 5000 });

    expect(await store.get('junk')).toBeUndefined();
    expect(await client.get(store.key('junk'))).toBeNull();
  });

  test('the memory store and this one answer the idempotency contract alike', async () => {
    const backend = await started('contract');
    const stores = [new MemoryStore(), backend.keyValueStore('idempotency')];

    for (const store of stores) {
      expect(await store.get('absent')).toBeUndefined();
      expect(await store.add('key', { first: true }, 5000)).toBe(true);
      expect(await store.add('key', { second: true }, 5000)).toBe(false);
      expect(await store.get('key')).toEqual({ first: true });
      await store.set('key', { third: true }, 5000);
      expect(await store.get('key')).toEqual({ third: true });
      await store.delete('key');
      expect(await store.get('key')).toBeUndefined();
    }

    stores[0].shutdown();
  });

  // The whole point, through the middleware rather than around it: the
  // request lands on one process and the retry on the other
  test('a request answered by one process is replayed by the other', async () => {
    const keys = prefix('replay');
    const backends = [
      await started('replay', { prefix: keys }),
      await started('replay', { prefix: keys }),
    ];
    let created = 0;

    const app = (backend) => {
      const henri = fakeHenri(sharedOn(backend).keyValueStore('idempotency'));
      const server = express();

      server.use(boom());
      server.use(express.json());
      server.use(idempotency(henri, { ttl: 5000 }));
      server.post('/tasks', (req, res) => {
        created += 1;

        return res.status(201).json({ id: created, title: req.body.title });
      });
      server.use(errorHandler(henri));

      return supertest(server);
    };

    const [one, two] = backends.map(app);
    const key = `${prefix('replay')}key`;
    const body = { title: 'ship it' };

    const first = await one
      .post('/tasks')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    const retry = await two
      .post('/tasks')
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    // One execution, two answers, and the second says it is a replay
    expect(created).toBe(1);
    expect(retry.body).toEqual(first.body);
    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(first.headers['idempotency-replayed']).toBeUndefined();

    // The same key with another body is refused, whichever process sees it
    await two
      .post('/tasks')
      .set('Idempotency-Key', key)
      .send({ title: 'something else' })
      .expect(422);

    expect(created).toBe(1);
  });

  test('a shared store answers what /readyz asks', async () => {
    const backend = await started('ready');
    const store = sharedOn(backend);

    expect(await store.ping()).toBe(true);
    expect(store.healthy).toBe(true);
    expect(store.describe()).toContain('redis://');
  });
});
