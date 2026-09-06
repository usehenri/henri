// The call log against a real Drizzle store.
//
// It lives in @usehenri/core and reaches a database the adapter opened
// through `query()`, like the access trail, so this file runs it on
// whatever the environment points at -- sqlite offline, a PostgreSQL or a
// MySQL server with HENRI_TEST_POSTGRES_URL or HENRI_TEST_MYSQL_URL
// (`pnpm test:sql:live`).
//
// The partitions are the half that only shows up on a real server: sqlite
// has no range partitioning, so the second describe here is skipped
// offline and is the reason this suite exists at all.
const { build, target } = require('./helpers');

const { install, storeFor } = require('../../core/src/base/call-store');
const { callsConfig, toCall, toRow } = require('../../core/src/base/calls');
const { redact } = require('../../core/src/base/redact');

/** A day, in milliseconds */
const DAY = 86400000;

/** The settings a store is built from, with the defaults filled in */
const settings = (calls = {}) =>
  callsConfig({
    get: () => ({ ...calls }),
    has: (key) => key === 'calls',
  });

/** The redaction context of a suite that has no privacy map */
const context = (over = {}) => ({
  filters: ['password'],
  keys: new Set(),
  mask: (url) => url,
  redact: (value) => redact(value, ['password']),
  settings: settings(over),
});

/** One row, ready to insert */
const row = (call) =>
  toRow(
    {
      at: Date.now(),
      direction: 'out',
      id: `${Math.random().toString(36).slice(2)}${Date.now()}`.slice(0, 36),
      method: 'GET',
      outcome: 'ok',
      status: 200,
      url: 'https://example.test/x',
      ...call,
    },
    context()
  );

describe(`the call log on ${target.name}`, () => {
  let adapter = null;
  let store = null;

  beforeAll(async () => {
    ({ adapter } = build());
    await adapter.start();
    store = storeFor(adapter, settings());
    await store.install();
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  test('the install is idempotent', async () => {
    await expect(store.install()).resolves.toBeDefined();
    expect(store.kind).toBe('sql');
  });

  test('a page of rows goes in with one statement', async () => {
    const rows = Array.from({ length: 25 }, (unused, index) =>
      row({ requestId: 'bulk', service: `svc-${index % 3}`, status: 200 })
    );

    expect(await store.insert(rows)).toBe(25);
    expect(await store.insert([])).toBe(0);
    expect(await store.count({ requestId: 'bulk' })).toBe(25);
    expect(await store.count({ requestId: 'bulk', service: 'svc-0' })).toBe(9);
  });

  test('the join is one read, oldest first, the answer before what it caused', async () => {
    const at = Date.now();

    await store.insert([
      row({
        at: at + 2,
        direction: 'out',
        requestId: 'story',
        service: 'search',
      }),
      row({
        at,
        direction: 'in',
        method: 'POST',
        requestId: 'story',
        route: '/orders',
        url: '/orders?page=1',
      }),
      row({
        at: at + 1,
        direction: 'out',
        requestId: 'story',
        service: 'billing',
      }),
    ]);

    const story = (await store.list({ requestId: 'story' })).map(toCall);

    expect(story.map((call) => call.direction)).toEqual(['in', 'out', 'out']);
    expect(story.map((call) => call.service)).toEqual([
      null,
      'billing',
      'search',
    ]);
    expect(story[0].route).toBe('/orders');
    expect(story[0].url).toBe('/orders?page=1');
  });

  test('a body and its headers come back as they went in', async () => {
    await store.insert([
      toRow(
        {
          at: Date.now(),
          direction: 'in',
          id: 'body-and-headers',
          method: 'POST',
          request: {
            body: { deep: { list: [1, 2] }, password: 'hunter2' },
            headers: { accept: 'application/json', authorization: 'Bearer x' },
          },
          response: { body: { ok: true } },
          status: 201,
          url: '/things',
        },
        context()
      ),
    ]);

    const [call] = (await store.list({ limit: 1000 }))
      .filter((found) => found.id === 'body-and-headers')
      .map(toCall);

    expect(call.request.body).toEqual({
      deep: { list: [1, 2] },
      password: '[FILTERED]',
    });
    expect(call.request.headers.authorization).toBe('[FILTERED]');
    expect(call.request.headers.accept).toBe('application/json');
    expect(call.response.body).toEqual({ ok: true });
    expect(call.at).toMatch(/^\d{4}-/u);
  });

  test('the address goes in and comes back, all three columns of it', async () => {
    await store.insert([
      row({
        address: {
          client: '203.0.113.9',
          peer: '10.1.2.3',
          source: 'proxy',
        },
        direction: 'in',
        id: 'with-an-address',
        requestId: 'addressed',
        route: '/orders',
        url: '/orders',
      }),
      row({
        // What a row holds when the configuration could not support an
        // answer: the peer, and a word saying why the client is empty
        address: { client: null, peer: '10.1.2.3', source: 'unverified' },
        direction: 'in',
        id: 'without-an-address',
        requestId: 'addressed',
        url: '/orders',
      }),
      // An anonymized one keeps its prefix length, which is why the column
      // is wide enough for a full IPv6 and a `/48`
      row({
        address: {
          client: '2001:db8:85a3::/48',
          peer: '2001:db8:1::/48',
          source: 'header',
        },
        direction: 'in',
        id: 'truncated-address',
        requestId: 'addressed',
        url: '/orders',
      }),
    ]);

    const found = Object.fromEntries(
      (await store.list({ requestId: 'addressed' }))
        .map(toCall)
        .map((call) => [call.id, call.address])
    );

    expect(found['with-an-address']).toEqual({
      client: '203.0.113.9',
      peer: '10.1.2.3',
      source: 'proxy',
    });
    expect(found['without-an-address']).toEqual({
      client: null,
      peer: '10.1.2.3',
      source: 'unverified',
    });
    expect(found['truncated-address'].client).toBe('2001:db8:85a3::/48');
  });

  test('a person is taken out of the rows that named them, and the rows stay', async () => {
    await store.insert([
      row({
        actor: '018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56',
        address: { client: '203.0.113.9', peer: '10.1.2.3', source: 'proxy' },
        direction: 'in',
        id: 'theirs',
        request: { body: { note: 'about them' }, headers: { accept: 'x' } },
        requestId: 'erasure',
        route: '/profile',
        status: 200,
        url: '/profile',
      }),
      row({
        actor: '018f5c2e-1f2a-7c31-9f0a-000000000000',
        address: { client: '198.51.100.4', peer: '10.1.2.3', source: 'proxy' },
        direction: 'in',
        id: 'somebody-elses',
        requestId: 'erasure',
        url: '/profile',
      }),
    ]);

    expect(await store.forget('018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56')).toBe(1);
    // A person nobody's rows name is a clean, empty, successful run
    expect(await store.forget('018f5c2e-0000-7c31-9f0a-2b7c1d3e4f56')).toBe(0);

    const found = Object.fromEntries(
      (await store.list({ requestId: 'erasure' }))
        .map(toCall)
        .map((call) => [call.id, call])
    );

    expect(found.theirs.actor).toBeNull();
    expect(found.theirs.address).toEqual({
      client: null,
      peer: null,
      source: 'proxy',
    });
    expect(found.theirs.request.body).toBeNull();
    expect(found.theirs.request.headers).toBeNull();
    // The operational record of a request that did happen, naming nobody
    expect(found.theirs.route).toBe('/profile');
    expect(found.theirs.status).toBe(200);
    // ... and nobody else was touched
    expect(found['somebody-elses'].address.client).toBe('198.51.100.4');
  });

  test('a filter the store cannot use narrows rather than widening', async () => {
    const since = Date.now() + DAY;

    expect(await store.count({ since })).toBe(0);
    expect(await store.count({ direction: 'in', since })).toBe(0);
    expect(await store.count({ status: 999 })).toBe(0);
    expect((await store.list({ limit: 5 })).length).toBe(5);
  });

  test('the sweep deletes in bounded batches and stops when it is done', async () => {
    const old = Date.now() - 90 * DAY;

    await store.insert(
      Array.from({ length: 12 }, (unused, index) =>
        row({ at: old + index, requestId: 'ancient', service: 'gone' })
      )
    );

    const before = Date.now() - 30 * DAY;
    const result = await store.sweep(before, { batch: 5 });

    expect(result.removed).toBe(12);
    expect(result.partitions).toEqual([]);
    expect(await store.count({ requestId: 'ancient' })).toBe(0);
    // What is not old enough is still there
    expect(await store.count({ requestId: 'bulk' })).toBe(25);
    // And a second pass finds nothing rather than looping
    expect((await store.sweep(before, { batch: 5 })).removed).toBe(0);
  });
});

/**
 * A call log an older henri created, which is the one henri will find in
 * every application that turned the feature on before the address columns
 * existed.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on it, so without the `ALTER`s
 * every insert would name three columns the table has not got. This builds
 * exactly what the previous version emitted -- the same statement with the
 * three column definitions taken out -- and then lets `install()` catch it
 * up.
 */
describe(`a table created before the address columns, on ${target.name}`, () => {
  const table = 'henri_calls_old';
  let adapter = null;
  let store = null;

  beforeAll(async () => {
    ({ adapter } = build());
    await adapter.start();
    store = storeFor(adapter, settings({ table }));

    const [create] = install(store.dialect, table);

    await store.run(
      create.replace(/\n\s*(?:client_ip|peer_ip|ip_source) [^,]+,/gu, '')
    );
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  test('install adds what is missing, and says nothing when it is there', async () => {
    await expect(store.install()).resolves.toBeDefined();
    // Idempotent: the second pass meets its own columns and swallows it
    await expect(store.install()).resolves.toBeDefined();

    await store.insert([
      row({
        address: {
          client: '203.0.113.9',
          peer: '10.1.2.3',
          source: 'proxy',
        },
        direction: 'in',
        id: 'after-the-upgrade',
        requestId: 'upgraded',
        url: '/orders',
      }),
    ]);

    const [call] = (await store.list({ requestId: 'upgraded' })).map(toCall);

    expect(call.address).toEqual({
      client: '203.0.113.9',
      peer: '10.1.2.3',
      source: 'proxy',
    });
  });
});

/**
 * The partitions, which only exist on a server that has them.
 *
 * This is the half of the sweep that makes it work at ten million rows:
 * dropping a partition is a metadata operation whatever it held, and
 * deleting ten million rows is not. sqlite has no range partitioning at
 * all, so there is nothing here to run offline and the guide says so
 * plainly.
 */
const partitioned = ['mysql', 'postgres'].includes(target.name)
  ? describe
  : describe.skip;

partitioned(`partitions on ${target.name}`, () => {
  const every = 'day';
  const table = 'henri_calls_p';
  // Fixed rather than "now", so what a partition covers is not a race with
  // the clock the suite runs on
  const now = Date.UTC(2026, 8, 20, 12);
  let adapter = null;
  let store = null;

  beforeAll(async () => {
    ({ adapter } = build());
    await adapter.start();
    store = storeFor(
      adapter,
      settings({ partition: every, partitionsAhead: 3, table })
    );
    await store.install(now);
  }, 60000);

  afterAll(async () => {
    await adapter.stop();
  });

  /**
   * What a period is called on this server: PostgreSQL partitions are
   * tables of their own and carry the table name, MySQL's do not
   *
   * @param {number} day The day of September 2026
   * @returns {string} The partition name
   */
  const named = (day) =>
    `${target.name === 'mysql' ? '' : `${table}_`}p202609${day}`;

  test('the table is created partitioned, with the periods in front', async () => {
    const found = await store.partitions();

    expect(found.map((one) => one.name)).toEqual([23, 22, 21, 20].map(named));
    expect(found[3]).toMatchObject({
      from: Date.UTC(2026, 8, 20),
      to: Date.UTC(2026, 8, 21),
    });
  });

  test('the install is idempotent, partitions included', async () => {
    await expect(store.install(now)).resolves.toBeDefined();
    expect(await store.partitions()).toHaveLength(4);
  });

  test('a row lands in the partition of its own day', async () => {
    await store.insert([
      row({ at: Date.UTC(2026, 8, 20, 1), requestId: 'day-20' }),
      row({ at: Date.UTC(2026, 8, 21, 1), requestId: 'day-21' }),
      row({ at: Date.UTC(2026, 8, 22, 1), requestId: 'day-22' }),
    ]);

    expect(await store.count({ requestId: 'day-20' })).toBe(1);
    expect(await store.count({ requestId: 'day-22' })).toBe(1);
  });

  test('an address survives the partitioned path too', async () => {
    await store.insert([
      row({
        address: { client: '203.0.113.9', peer: '10.1.2.3', source: 'proxy' },
        at: Date.UTC(2026, 8, 22, 2),
        direction: 'in',
        id: 'partitioned-address',
        requestId: 'day-22-address',
        url: '/orders',
      }),
    ]);

    const [call] = (await store.list({ requestId: 'day-22-address' })).map(
      toCall
    );

    expect(call.address).toEqual({
      client: '203.0.113.9',
      peer: '10.1.2.3',
      source: 'proxy',
    });
  });

  test('a row outside every period is kept by the catch-all, not refused', async () => {
    // The reason there is a DEFAULT partition (MAXVALUE on mysql): a
    // partition henri did not create in time would otherwise be failed
    // inserts rather than a slower sweep
    await expect(
      store.insert([row({ at: Date.UTC(2030, 0, 1), requestId: 'far-future' })])
    ).resolves.toBe(1);

    expect(await store.count({ requestId: 'far-future' })).toBe(1);
  });

  test('the sweep drops whole periods and keeps the rest', async () => {
    const before = Date.UTC(2026, 8, 22);
    const result = await store.sweep(before, { batch: 100, now: before });

    // The 20th and the 21st are entirely past the cutoff
    expect(result.partitions.sort()).toEqual([named(20), named(21)].sort());
    expect(await store.count({ requestId: 'day-20' })).toBe(0);
    expect(await store.count({ requestId: 'day-21' })).toBe(0);
    expect(await store.count({ requestId: 'day-22' })).toBe(1);
    // And the catch-all keeps what is not old enough
    expect(await store.count({ requestId: 'far-future' })).toBe(1);
  });

  test('and tops the plan back up in front of the clock', async () => {
    const found = await store.partitions();

    // A period that was dropped does not come back -- MySQL keeps its
    // ranges in increasing order, so a range below an existing one cannot
    // be added, and what that period held is gone anyway
    expect(found.map((one) => one.name).sort()).toEqual([
      named(22),
      named(23),
      named(24),
      named(25),
    ]);
  });

  test('what the catch-all took is still swept, by deleting it', async () => {
    const result = await store.sweep(Date.UTC(2031, 0, 1), {
      batch: 100,
      now: Date.UTC(2031, 0, 1),
    });

    expect(result.removed).toBeGreaterThan(0);
    expect(await store.count({ requestId: 'far-future' })).toBe(0);
  });
});
