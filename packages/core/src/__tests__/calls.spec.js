const supertest = require('supertest');
const Henri = require('../henri');

const {
  Ceiling,
  always,
  bytes,
  callsConfig,
  capture,
  checkPartition,
  hash32,
  headers,
  ignored,
  outcomeOf,
  safeUrl,
  toCall,
  toRow,
  walkable,
} = require('../base/calls');
const {
  boundsOf,
  install,
  partitionName,
  planOf,
  startOf,
} = require('../base/call-store');
const { redactor, urlRedactor } = require('../base/redact');

/** A configuration module standing in for the real one */
const config = (calls) => ({
  get: (key) => ({ calls, filterParameters: ['password', 'token'] })[key],
  has: (key) => ['calls', 'filterParameters'].includes(key),
});

/** The context `toRow` reads, with a couple of personal names marked */
const context = (settings = {}) => {
  const instance = {
    config: config(true),
    privacy: { keys: new Set(['name', 'phone']) },
  };

  return {
    filters: ['password', 'token'],
    keys: instance.privacy.keys,
    mask: urlRedactor(instance),
    redact: redactor(instance),
    settings: { ...callsConfig(config({})), ...settings },
  };
};

describe('the settings', () => {
  test('nothing said is nothing kept', () => {
    for (const raw of [undefined, false, null]) {
      const settings = callsConfig(config(raw));

      expect(settings.enabled).toBe(false);
      expect(settings.inbound).toBe(false);
      expect(settings.outbound).toBe(false);
      expect(settings.maxBody).toBe(0);
    }

    expect(callsConfig(null).enabled).toBe(false);
  });

  test('an empty object is the defaults', () => {
    const settings = callsConfig(config({}));

    expect(settings).toMatchObject({
      always: ['error'],
      buffer: 1000,
      enabled: true,
      inbound: true,
      maxBody: 8192,
      maxPerSecond: 100,
      outbound: true,
      partition: false,
      sample: 1,
      store: 'default',
      table: 'henri_calls',
    });
    expect(settings.keep).toBe(30 * 86400000);
  });

  test('the bounds can be lifted one at a time, and each of them says so', () => {
    expect(callsConfig(config({ keep: false })).keep).toBeNull();
    expect(callsConfig(config({ maxPerSecond: false })).maxPerSecond).toBe(
      Infinity
    );
    expect(callsConfig(config({ bodies: false })).maxBody).toBe(0);
    expect(callsConfig(config({ maxBody: '1kb' })).maxBody).toBe(1024);
    expect(callsConfig(config({ sample: 2 })).sample).toBe(1);
    expect(callsConfig(config({ sample: -1 })).sample).toBe(0);
    expect(callsConfig(config({ always: ['nope', 'aborted'] })).always).toEqual(
      ['aborted']
    );
    expect(callsConfig(config({ partition: 'week' })).partition).toBe(false);
    expect(callsConfig(config({ partition: 'day' })).partition).toBe('day');
  });

  test('a size is a number of bytes or a string', () => {
    expect(bytes('8kb', 1)).toBe(8192);
    expect(bytes(64, 1)).toBe(64);
    expect(bytes('2mb', 1)).toBe(2097152);
    expect(bytes(false, 1)).toBe(0);
    expect(bytes('a lot', 7)).toBe(7);
  });

  test('a partition scheme a dialect cannot carry out fails loudly', () => {
    expect(checkPartition('postgres', 'day')).toBe(true);
    expect(checkPartition('mysql', 'month')).toBe(true);
    expect(checkPartition('sqlite', false)).toBe(true);
    expect(checkPartition('mongodb', false)).toBe(true);

    for (const dialect of ['sqlite', 'mssql', 'mongodb']) {
      let error = null;

      try {
        checkPartition(dialect, 'day');
      } catch (thrown) {
        error = thrown;
      }

      expect(error.code).toBe('HENRI_CALLS_PARTITION_UNSUPPORTED');
      expect(error.hint).toMatch(/PostgreSQL and MySQL/u);
    }
  });
});

/**
 * The redaction rule of `base/calls.js`, which is the reason this table is
 * the most dangerous one henri writes. It has a test of its own the way the
 * trail's refusal does, and each of these is a sentence of the header.
 */
describe('what never reaches a row', () => {
  const head = {
    filters: ['password', 'token'],
    keys: new Set(['name']),
    max: 50,
  };

  test('the credentials of an exchange are masked whatever the filters say', () => {
    // Not one of them is in `filterParameters`: the point is that no
    // application has to remember to write them down
    expect(
      headers(
        {
          accept: 'application/json',
          authorization: 'Bearer sk_live_1234',
          cookie: 'henri.sid=s%3Aabc',
          'proxy-authorization': 'Basic zzz',
          'set-cookie': 'henri.sid=s%3Aabc; HttpOnly',
          'webhook-signature': 'v1,abc',
          'x-api-key': 'key_1234',
          'x-csrf-token': 'tok',
        },
        { ...head, filters: [] }
      )
    ).toEqual({
      accept: 'application/json',
      authorization: '[FILTERED]',
      cookie: '[FILTERED]',
      'proxy-authorization': '[FILTERED]',
      'set-cookie': '[FILTERED]',
      'webhook-signature': '[FILTERED]',
      'x-api-key': '[FILTERED]',
      'x-csrf-token': '[FILTERED]',
    });
  });

  test("and so is anything the application's own filters name", () => {
    expect(
      headers({ 'x-name': 'Ada', 'x-session-token': 'abc' }, head)
    ).toEqual({ 'x-name': 'Ada', 'x-session-token': '[FILTERED]' });
  });

  test('a body is walked: filters as substrings, personal names exactly', () => {
    const stored = capture(
      {
        deep: { passwordConfirmation: 'hunter2', phone: '555' },
        encryption: { keys: ['deadbeef'] },
        name: 'Ada Lovelace',
        note: 'kept',
        password: 'hunter2',
      },
      { max: 8192, redact: context().redact }
    );
    const body = JSON.parse(stored.body);

    expect(body.password).toBe('[FILTERED]');
    // A substring, the way `filterParameters` matches
    expect(body.deep.passwordConfirmation).toBe('[FILTERED]');
    // Exactly, the way a `personal` mark matches
    expect(body.name).toBe('[FILTERED]');
    expect(body.deep.phone).toBe('[FILTERED]');
    // The one no configuration lifts
    expect(body.encryption).toBe('[FILTERED]');
    expect(body.note).toBe('kept');
    expect(stored.truncated).toBe(false);
  });

  test('a body henri cannot walk is not stored, only its shape', () => {
    expect(walkable({ a: 1 })).toBe(true);
    expect(walkable([1])).toBe(true);
    expect(walkable('<html>secret</html>')).toBe(false);
    expect(walkable(Buffer.from('secret'))).toBe(false);
    expect(walkable(new Date())).toBe(false);

    expect(
      capture('<html>secret</html>', { max: 8192, redact: (x) => x })
    ).toEqual({ body: null, kind: 'string', truncated: false });
    expect(
      capture(Buffer.from('secret'), { max: 8192, redact: (x) => x })
    ).toEqual({ body: null, kind: 'buffer', truncated: false });
  });

  test('a body past the cap is cut and says so', () => {
    const stored = capture(
      { long: 'x'.repeat(500) },
      { max: 64, redact: (value) => value }
    );

    expect(stored.truncated).toBe(true);
    expect(stored.body).toHaveLength(64 + '…[truncated]'.length);
    expect(stored.body.endsWith('…[truncated]')).toBe(true);
    expect(
      toCall({ request_body: stored.body, truncated: 'request' }).truncated
    ).toEqual(['request']);
  });

  test('a url loses its userinfo and its filtered query values', () => {
    const mask = context().mask;

    expect(safeUrl('https://key:s3cret@api.example.test/v1/x', mask)).toBe(
      'https://api.example.test/v1/x'
    );
    expect(safeUrl('/login?token=abc&page=2', mask)).toBe(
      '/login?token=%5BFILTERED%5D&page=2'
    );
    expect(safeUrl(null, mask)).toBeNull();
  });

  test('a whole row keeps no credential and no address', () => {
    const row = toRow(
      {
        at: 1,
        direction: 'out',
        id: 'x',
        method: 'post',
        request: {
          body: { email: 'ada@example.test', name: 'Ada', token: 'abc' },
          headers: { authorization: 'Bearer sk_live' },
        },
        response: { body: { ok: true }, headers: { 'set-cookie': 'a=b' } },
        service: 'billing',
        status: 200,
        url: 'https://user:pass@api.example.test/charge?token=abc',
      },
      context()
    );
    const text = JSON.stringify(row);

    expect(text).not.toMatch(/sk_live/u);
    expect(text).not.toMatch(/a=b/u);
    expect(text).not.toMatch(/Ada/u);
    expect(text).not.toMatch(/user:pass/u);
    expect(text).not.toMatch(/abc/u);
    // The address is not a personal *name*, so this is what is left to say:
    // an application marks `email` personal and the guide says to
    expect(row.url).toBe(
      'https://api.example.test/charge?token=%5BFILTERED%5D'
    );
    expect(row.method).toBe('POST');
    expect(row.outcome).toBe('ok');
  });
});

describe('the four bounds', () => {
  test('an outcome is what decides whether sampling gets to drop it', () => {
    expect(outcomeOf({ status: 200 })).toBe('ok');
    expect(outcomeOf({ status: 404 })).toBe('ok');
    expect(outcomeOf({ status: 500 })).toBe('failed');
    expect(outcomeOf({ aborted: true })).toBe('aborted');
    expect(outcomeOf({ error: 'ECONNRESET', status: null })).toBe('failed');

    expect(always({ outcome: 'ok', status: 200 }, ['error'])).toBe(false);
    expect(always({ outcome: 'failed', status: 500 }, ['error'])).toBe(true);
    expect(always({ outcome: 'ok', status: 422 }, ['error'])).toBe(false);
    expect(always({ outcome: 'ok', status: 422 }, ['client-error'])).toBe(true);
    expect(always({ outcome: 'aborted', status: null }, ['aborted'])).toBe(
      true
    );
    expect(always({ outcome: 'failed', status: 500 }, [])).toBe(false);
  });

  test('the ceiling is absolute and refills every second', () => {
    const ceiling = new Ceiling(2);

    expect(ceiling.take(1000)).toBe(true);
    expect(ceiling.take(1100)).toBe(true);
    expect(ceiling.take(1200)).toBe(false);
    expect(ceiling.take(2000)).toBe(true);
    expect(new Ceiling(Infinity).take(1)).toBe(true);
  });

  test('the sampling is a hash, so it is stable and it is seeded', () => {
    const bucket = (id, seed) => hash32(id, seed) % 10000;
    const ids = Array.from({ length: 2000 }, (unused, i) => `req-${i}`);

    // Stable: the same id answers the same, which is what lets the inbound
    // call and its outbound calls agree without carrying state
    expect(bucket('req-1', 7)).toBe(bucket('req-1', 7));

    // Seeded: the request id comes from a header a client can choose, so
    // which ids are sampled must not be something a client can work out
    const one = ids.filter((id) => bucket(id, 7) < 500);
    const two = ids.filter((id) => bucket(id, 99) < 500);

    expect(one.length).toBeGreaterThan(50);
    expect(one.filter((id) => two.includes(id)).length).toBeLessThan(
      one.length
    );

    // Spread evenly enough to mean 5%
    expect(one.length / ids.length).toBeGreaterThan(0.02);
    expect(one.length / ids.length).toBeLessThan(0.09);
  });

  test('the health probes are never recorded, whatever ignore says', () => {
    expect(ignored('/livez', [])).toBe(true);
    expect(ignored('/readyz', [])).toBe(true);
    expect(ignored('/_henri/health', [])).toBe(true);
    expect(ignored('/version', [])).toBe(false);
    expect(ignored('/assets/app.css', ['/assets'])).toBe(true);
  });
});

describe('the table, per dialect', () => {
  test('every dialect gets the same columns and the same three indexes', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql', 'mssql']) {
      const statements = install(dialect, 'henri_calls').join('\n');

      expect(statements).toContain('request_id');
      expect(statements).toContain('PRIMARY KEY (at, id)');
      expect(statements).toContain('henri_calls_request');
      expect(statements).toContain('henri_calls_at');
      expect(statements).toContain('henri_calls_service');
    }
  });

  test('a table name that is not an identifier is refused', () => {
    expect(() => install('sqlite', 'drop me')).toThrow(/invalid table name/u);
    expect(() => install('oracle', 'henri_calls')).toThrow(
      /cannot be kept in a oracle store/u
    );
  });

  test('postgres declares the scheme, then the periods and a default', () => {
    const statements = install('postgres', 'henri_calls', {
      ahead: 2,
      now: Date.UTC(2026, 8, 6, 12),
      partition: 'day',
    });
    const text = statements.join('\n');

    expect(text).toContain('PARTITION BY RANGE (at)');
    expect(text).toContain(
      `"henri_calls_p20260906" PARTITION OF "henri_calls" FOR VALUES FROM (${Date.UTC(
        2026,
        8,
        6
      )}) TO (${Date.UTC(2026, 8, 7)})`
    );
    expect(text).toContain('"henri_calls_p20260908"');
    // Nothing henri writes is ever refused for want of a partition
    expect(text).toContain('"henri_calls_pdefault" PARTITION OF');
  });

  test('mysql puts the periods in the CREATE TABLE and keeps a MAXVALUE', () => {
    const text = install('mysql', 'henri_calls', {
      ahead: 1,
      now: Date.UTC(2026, 8, 6, 12),
      partition: 'month',
    }).join('\n');

    expect(text).toContain('PARTITION BY RANGE (at) (');
    expect(text).toContain(
      `PARTITION p20260901 VALUES LESS THAN (${Date.UTC(2026, 9, 1)})`
    );
    expect(text).toContain('PARTITION pmax VALUES LESS THAN MAXVALUE');
  });

  test('a partition says what it covers through its name', () => {
    expect(startOf(Date.UTC(2026, 8, 6, 23, 59), 'day')).toBe(
      Date.UTC(2026, 8, 6)
    );
    expect(startOf(Date.UTC(2026, 8, 6, 23, 59), 'month')).toBe(
      Date.UTC(2026, 8, 1)
    );
    expect(partitionName('postgres', 'henri_calls', Date.UTC(2026, 8, 6))).toBe(
      'henri_calls_p20260906'
    );
    expect(partitionName('mysql', 'henri_calls', Date.UTC(2026, 8, 6))).toBe(
      'p20260906'
    );
    expect(boundsOf('henri_calls_p20260906', 'day')).toEqual({
      from: Date.UTC(2026, 8, 6),
      to: Date.UTC(2026, 8, 7),
    });
    expect(boundsOf('henri_calls_pdefault', 'day')).toBeNull();
    expect(boundsOf('pmax', 'month')).toBeNull();
    expect(planOf(Date.UTC(2026, 8, 6, 3), { ahead: 2, every: 'day' })).toEqual(
      [Date.UTC(2026, 8, 6), Date.UTC(2026, 8, 7), Date.UTC(2026, 8, 8)]
    );
  });
});

describe('the module, in the demo application', () => {
  let henri = null;
  let request = null;
  const skipWorkers = process.env.SKIP_WORKERS;

  beforeAll(async () => {
    process.env.SKIP_WORKERS = '1';
    henri = new Henri();
    await henri.init();
    global.henri = henri;
    request = supertest(henri.server.app);
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

  test('it is on, it owns a table, and MongoDB gets the delete path', () => {
    expect(henri.calls.enabled).toBe(true);
    expect(henri.calls.settings.table).toBe('henri_calls');
    expect(henri.calls.store.kind).toBe('mongo');
    expect(henri.calls.store.partition).toBe(false);
  });

  test('an answered call is recorded, off the hot path', async () => {
    const id = `spec-in-${Date.now()}`;
    const answer = await request
      .post('/echo')
      .set('X-Request-Id', id)
      .set('Authorization', 'Bearer sk_live_should_not_be_stored')
      .send({ password: 'hunter2', title: 'Kept' });

    expect(answer.status).toBe(200);

    // Nothing was written yet: the answer went out first
    expect(henri.calls.buffer.length).toBeGreaterThan(0);

    await henri.calls.flush();

    const [call] = await henri.calls.about(id);

    expect(call.direction).toBe('in');
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/echo');
    expect(call.status).toBe(200);
    expect(call.outcome).toBe('ok');
    expect(call.duration).toBeGreaterThanOrEqual(0);
    expect(call.request.body.title).toBe('Kept');
    expect(call.request.body.password).toBe('[FILTERED]');
    expect(call.request.headers.authorization).toBe('[FILTERED]');
    expect(call.response.body.sequence).toEqual(expect.any(Number));
    expect(JSON.stringify(call)).not.toMatch(/sk_live/u);
  });

  test('the route is the pattern, and the person is a public identifier', async () => {
    const agent = supertest.agent(henri.server.app);
    const email = 'called@demo.test';
    const password = 'difference-engine';

    await agent.post('/register').send({ email, name: 'Called', password });
    await agent.post('/login').send({ email, password });

    const id = `spec-actor-${Date.now()}`;

    await agent.get('/profile').set('X-Request-Id', id);
    await henri.calls.flush();

    const [call] = await henri.calls.about(id);

    // The pattern rather than the path, which is what makes a listing of
    // the slow calls of one endpoint add up
    expect(call.route).toBe('/profile');
    // The public identifier, and nothing else: not the primary key, and
    // not the address the session was opened with
    expect(call.actor).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
    );
    expect(JSON.stringify(call)).not.toMatch(/called@demo\.test/u);
    // ... and the session cookie the request carried is not in it either
    expect(call.request.headers.cookie).toBe('[FILTERED]');
  });

  test('the health probes are not in it', async () => {
    await request.get('/livez');
    await henri.calls.flush();

    expect(await henri.calls.count({ service: null, status: 200 })).toEqual(
      expect.any(Number)
    );
    expect(
      (await henri.calls.list({ limit: 200 })).filter(
        (call) => call.url === '/livez'
      )
    ).toEqual([]);
  });

  test('the join is the feature: one request, its call in and its calls out', async () => {
    const id = `spec-join-${Date.now()}`;

    // An outbound call recorded by hand is the seam an application's own
    // client goes through: henri wraps nobody's client
    const finish = henri.calls.track({
      method: 'POST',
      request: {
        body: { amount: 100 },
        headers: { authorization: 'Bearer x' },
      },
      requestId: id,
      service: 'billing',
      url: 'https://key:secret@api.example.test/v1/charges',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    finish({ body: { id: 'ch_1' }, status: 201 });

    henri.calls.outbound({
      method: 'GET',
      requestId: id,
      service: 'search',
      status: 200,
      url: 'https://search.example.test/q',
    });

    await henri.calls.flush();

    const story = await henri.calls.about(id);

    expect(story.map((call) => call.service)).toEqual(['billing', 'search']);
    expect(story[0].direction).toBe('out');
    expect(story[0].url).toBe('https://api.example.test/v1/charges');
    expect(story[0].status).toBe(201);
    expect(story[0].duration).toBeGreaterThanOrEqual(1);
    expect(story[0].request.headers.authorization).toBe('[FILTERED]');
    expect(story[0].response.body).toEqual({ id: 'ch_1' });
  });

  test('a mail is one of the outbound calls henri makes itself', async () => {
    const before = await henri.calls.count({ service: 'mail' });

    await henri.mail.send({
      html: '<p>hello</p>',
      subject: 'Hello',
      to: 'someone@example.test',
    });

    await henri.calls.flush();

    const [sent] = await henri.calls.list({ service: 'mail' });

    expect(await henri.calls.count({ service: 'mail' })).toBe(before + 1);
    expect(sent.direction).toBe('out');
    expect(sent.method).toBe('SEND');
    expect(sent.status).toBe(250);
    expect(sent.meta.messageId).toEqual(expect.any(String));
    // The recipient is not in the table, and the guide says why
    expect(JSON.stringify(sent)).not.toMatch(/someone@example\.test/u);
  });

  test('the ceiling drops rather than queues, and says how many', () => {
    const ceiling = henri.calls.ceiling;
    const dropped = henri.calls.counters.rate;

    henri.calls.ceiling = new Ceiling(0);

    expect(
      henri.calls.outbound({ service: 'over', status: 200, url: '/x' })
    ).toBe(false);
    expect(henri.calls.counters.rate).toBe(dropped + 1);

    henri.calls.ceiling = ceiling;
  });

  test('a full buffer drops rather than growing, and says how many', () => {
    const buffer = henri.calls.buffer;
    const dropped = henri.calls.counters.buffer;

    henri.calls.buffer = new Array(henri.calls.settings.buffer).fill({});

    expect(
      henri.calls.outbound({ service: 'over', status: 200, url: '/x' })
    ).toBe(false);
    expect(henri.calls.counters.buffer).toBe(dropped + 1);

    henri.calls.buffer = buffer;
  });

  test('sampling drops a call, and calls.always keeps the failures', () => {
    const sample = henri.calls.settings.sample;

    henri.calls.settings.sample = 0;

    expect(
      henri.calls.outbound({ service: 'quiet', status: 200, url: '/x' })
    ).toBe(false);

    // ... unless it failed, and then without its bodies: the decision not
    // to capture them was made before the status was known
    expect(
      henri.calls.outbound({
        request: { body: { secretish: 1 }, headers: { accept: '*/*' } },
        service: 'loud',
        status: 503,
        url: '/x',
      })
    ).toBe(true);

    const row = henri.calls.buffer[henri.calls.buffer.length - 1];

    expect(row.service).toBe('loud');
    expect(row.request_body).toBeNull();
    expect(row.request_headers).toContain('accept');

    henri.calls.settings.sample = sample;
  });

  test('a flush that fails never fails the caller', async () => {
    const insert = henri.calls.store.insert;

    henri.calls.store.insert = async () => {
      throw new Error('the database went away');
    };

    henri.calls.outbound({ service: 'doomed', status: 200, url: '/x' });

    await expect(henri.calls.flush()).resolves.toBe(0);
    expect(henri.calls.counters.failed).toBeGreaterThan(0);

    henri.calls.store.insert = insert;
  });

  test('the sweep takes the old rows away', async () => {
    henri.calls.outbound({
      at: Date.now() - 40 * 86400000,
      service: 'ancient',
      status: 200,
      url: '/x',
    });

    await henri.calls.flush();

    expect(await henri.calls.count({ service: 'ancient' })).toBe(1);

    const result = await henri.calls.prune();

    expect(result.removed).toBeGreaterThan(0);
    expect(result.partitions).toEqual([]);
    expect(await henri.calls.count({ service: 'ancient' })).toBe(0);
  });

  test('the retention sweep is what runs it', async () => {
    henri.calls.outbound({
      at: Date.now() - 40 * 86400000,
      service: 'swept',
      status: 200,
      url: '/x',
    });

    await henri.calls.flush();
    await henri.retention.sweep({ dryRun: false });

    expect(await henri.calls.count({ service: 'swept' })).toBe(0);
  });

  test('stats say what was written and what was not', async () => {
    const stats = await henri.calls.stats();

    expect(stats.enabled).toBe(true);
    expect(stats.written).toBeGreaterThan(0);
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.dropped.rate).toBeGreaterThan(0);
    expect(stats.partitions).toEqual([]);
  });

  test('reading a log that is off says so rather than answering nothing', async () => {
    const enabled = henri.calls.enabled;

    henri.calls.enabled = false;

    await expect(henri.calls.list()).rejects.toMatchObject({
      code: 'HENRI_CALLS_DISABLED',
    });
    expect(await henri.calls.stats()).toMatchObject({ enabled: false });
    // Recording is a no-op, so nothing in core has to ask first
    expect(henri.calls.outbound({ service: 'x' })).toBe(false);
    expect(henri.calls.track({ service: 'x' })()).toBeNull();

    henri.calls.enabled = enabled;
  });
});
