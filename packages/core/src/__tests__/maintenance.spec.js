const express = require('express');
const cookieParser = require('cookie-parser');
const supertest = require('supertest');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const health = require('../base/health');
const { mint } = require('../base/tokens');
const {
  BYPASSES,
  DEFAULTS,
  FileSwitch,
  Maintenance,
  PURPOSE,
  READYZ,
  SWITCHES,
  SharedSwitch,
  builtinPage,
  createMaintenance,
  isOn,
  settings,
} = require('../base/maintenance');
const {
  MAINTENANCE_BYPASSES,
  MAINTENANCE_READYZ,
  MAINTENANCE_SWITCHES,
  SCHEMA,
} = require('../base/config-schema');

const SECRET = 'a-secret-nobody-else-has';

/** Somewhere to keep a switch that no other test file shares */
const tmpdir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), `henri-maintenance-${process.pid}-`));

/**
 * A minimal henri, enough for the switch and its middleware
 *
 * @param {object} [config={}] the configuration
 * @param {object} [flags={}] overrides (cwd, isProduction, pen...)
 * @returns {object} a henri look-alike
 */
const fakeHenri = (config = {}, flags = {}) =>
  Object.assign(
    {
      config: {
        get: (key) => config[key],
        has: (key) => Object.prototype.hasOwnProperty.call(config, key),
      },
      cwd: () => flags.dir || process.cwd(),
      isProduction: false,
      pen: { error: () => {}, info: () => {}, warn: () => {} },
    },
    flags
  );

/**
 * A switch on a file of its own, with a henri around it
 *
 * @param {object} [options={}] what `config.maintenance` says
 * @param {object} [flags={}] overrides for the henri
 * @returns {{dir: string, henri: object, state: Maintenance}} the three
 */
const switchIn = (options = {}, flags = {}) => {
  const dir = tmpdir();
  const henri = fakeHenri(
    {
      maintenance: { file: 'switch.json', poll: 0, ...options },
      secret: SECRET,
    },
    { dir, ...flags }
  );

  const state = createMaintenance(henri);

  // The server module hangs it there, and `base/health.js` reads it back
  henri.maintenance = state;

  return { dir, henri, state };
};

/**
 * An express app with the switch mounted the way `2.server.js` mounts it
 *
 * @param {Maintenance} state the switch
 * @returns {object} the app
 */
const appWith = (state) => {
  const app = express();

  app.use(cookieParser());
  app.get(health.LIVE_PATH, health.live(state.henri));
  app.get(health.READY_PATH, health.ready(state.henri));
  app.use(state.middleware());
  app.get('/', (req, res) => res.json({ served: true }));
  app.get('/api/things', (req, res) => res.json({ things: [] }));

  return app;
};

describe('the maintenance settings', () => {
  test('are the defaults without a maintenance key', () => {
    expect(settings(fakeHenri().config)).toEqual(DEFAULTS);
    expect(settings(null)).toEqual(DEFAULTS);
    expect(DEFAULTS.readyz).toBe('ready');
    expect(DEFAULTS.bypass).toBe('token');
    expect(DEFAULTS.switch).toBe('auto');
  });

  test('false means the application has no switch at all', () => {
    expect(settings(fakeHenri({ maintenance: false }).config)).toBeNull();

    const state = createMaintenance(fakeHenri({ maintenance: false }));

    expect(state.enabled).toBe(false);
    expect(state.where).toBe('none');
    expect(state.describe()).toContain('config.maintenance is false');
  });

  test('take what the configuration says', () => {
    const asked = {
      bypass: 'loopback',
      file: 'tmp/closed.json',
      message: '  Back soon  ',
      page: 'app/views/closed.html',
      poll: 0,
      readyz: 'unavailable',
      retryAfter: 60,
      switch: 'file',
    };

    expect(settings(fakeHenri({ maintenance: asked }).config)).toEqual({
      ...asked,
      message: 'Back soon',
    });
  });

  test('refuse a value henri cannot act on', () => {
    for (const bad of [
      { bypass: 'header' },
      { readyz: 'maybe' },
      { switch: 'redis' },
    ]) {
      expect(() => settings(fakeHenri({ maintenance: bad }).config)).toThrow(
        TypeError
      );
    }

    expect(() => settings(fakeHenri({ maintenance: 'on' }).config)).toThrow(
      /must be an object/u
    );
  });

  test('a retryAfter is at least one second, and poll may be zero', () => {
    const of = (maintenance) => settings(fakeHenri({ maintenance }).config);

    expect(of({ retryAfter: 0 }).retryAfter).toBe(1);
    expect(of({ retryAfter: -5 }).retryAfter).toBe(DEFAULTS.retryAfter);
    expect(of({ poll: 0 }).poll).toBe(0);
    expect(of({ poll: 'soon' }).poll).toBe(DEFAULTS.poll);
  });

  test('the enumerations match the ones the schema documents', () => {
    // The schema mirrors these rather than requiring this file, the way it
    // mirrors base/logs.js: the lists have to stay equal
    expect(MAINTENANCE_BYPASSES).toEqual([...BYPASSES]);
    expect(MAINTENANCE_READYZ).toEqual([...READYZ]);
    expect(MAINTENANCE_SWITCHES).toEqual([...SWITCHES]);
    expect(Object.keys(SCHEMA.maintenance.oneOf[1].keys).sort()).toEqual(
      Object.keys(DEFAULTS).sort()
    );
  });
});

describe('where the switch lives', () => {
  test('a file when there is no shared store, and the boot line says so', async () => {
    const { dir, henri, state } = switchIn();
    const said = [];

    henri.pen.info = (...args) => said.push(args);

    expect(state.where).toBe('file');
    expect(state.backend).toBeInstanceOf(FileSwitch);
    expect(state.backend.file).toBe(path.join(dir, 'switch.json'));

    await state.start();

    expect(said[0]).toEqual([
      'maintenance',
      'switch.json',
      'off, checked every 0ms',
    ]);

    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('the shared store when there is one', () => {
    const held = new Map();
    const shared = {
      name: 'redis',
      unguarded: () => ({
        delete: async (key) => held.delete(key),
        get: async (key) => held.get(key),
        set: async (key, value) => held.set(key, value),
      }),
    };
    const state = createMaintenance(
      fakeHenri({ maintenance: {}, secret: SECRET }, { shared })
    );

    expect(state.where).toBe('shared');
    expect(state.backend).toBeInstanceOf(SharedSwitch);
    expect(state.describe()).toBe('redis');
  });

  test('"shared" without a shared store is refused rather than guessed', () => {
    expect(() =>
      createMaintenance(fakeHenri({ maintenance: { switch: 'shared' } }))
    ).toThrow(/config.shared names no backend/u);
  });

  test('a shared switch round-trips through the store', async () => {
    const held = new Map();
    const shared = {
      name: 'redis',
      unguarded: () => ({
        delete: async (key) => held.delete(key),
        get: async (key) => held.get(key),
        set: async (key, value) => held.set(key, value),
      }),
    };
    const state = createMaintenance(
      fakeHenri({ maintenance: { poll: 0 }, secret: SECRET }, { shared })
    );

    expect(await state.status()).toMatchObject({ on: false, where: 'shared' });

    const record = await state.on({ message: 'Migrating' });

    expect(record.message).toBe('Migrating');
    expect(await state.status()).toMatchObject({
      message: 'Migrating',
      on: true,
    });
    expect(await state.off()).toBe(true);
    expect(await state.status()).toMatchObject({ on: false });
  });
});

describe('throwing the switch', () => {
  test('writes a record another process can read, and takes it back', async () => {
    const { dir, state } = switchIn();
    const file = path.join(dir, 'switch.json');

    expect(state.closed).toBe(false);
    expect(await state.off()).toBe(false);

    const record = await state.on({
      by: 'ada',
      message: 'Repairing the seating chart',
      retryAfter: 900,
    });

    expect(record).toMatchObject({
      by: 'ada',
      message: 'Repairing the seating chart',
      on: true,
      retryAfter: 900,
    });
    expect(record.id).toMatch(/^[0-9a-f]{32}$/u);
    expect(typeof record.token).toBe('string');

    // On disk, whole, and readable by anything that can read the directory
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));

    expect(written).toMatchObject({ id: record.id, on: true });
    expect(await new FileSwitch(file).read()).toMatchObject({ id: record.id });

    expect(await state.off()).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(state.closed).toBe(false);

    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('the defaults of the configuration are what a window gets', async () => {
    const { dir, state } = switchIn({
      message: 'We are closed',
      retryAfter: 42,
    });
    const record = await state.on();

    expect(record.message).toBe('We are closed');
    expect(record.retryAfter).toBe(42);

    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('an application without a switch refuses to be closed', async () => {
    const state = createMaintenance(fakeHenri({ maintenance: false }));

    await expect(state.on()).rejects.toThrow(/no maintenance switch/u);
    await expect(state.off()).rejects.toThrow(/no maintenance switch/u);
    await expect(state.status()).resolves.toMatchObject({
      enabled: false,
      on: false,
    });
  });

  test('a switch that cannot be written says so with its code', async () => {
    const state = new Maintenance(fakeHenri({ secret: SECRET }), DEFAULTS, {
      clear: async () => {
        throw new Error('read-only file system');
      },
      describe: () => 'nowhere',
      read: async () => null,
      where: 'file',
      write: async () => {
        throw new Error('read-only file system');
      },
    });

    await expect(state.on()).rejects.toMatchObject({
      code: 'HENRI_MAINTENANCE_UNAVAILABLE',
    });
    await expect(state.off()).rejects.toMatchObject({
      code: 'HENRI_MAINTENANCE_UNAVAILABLE',
    });
  });
});

describe('a switch that cannot be read', () => {
  test('leaves the last state standing, and says so once', async () => {
    const henri = fakeHenri({ secret: SECRET });
    const said = [];
    let answer = null;

    henri.pen.error = (...args) => said.push(args);

    const state = new Maintenance(
      henri,
      { ...DEFAULTS, poll: 0 },
      {
        describe: () => 'redis',
        read: async () => {
          if (answer instanceof Error) {
            throw answer;
          }

          return answer;
        },
        where: 'shared',
      }
    );

    answer = { id: 'x', message: 'closed', on: true, retryAfter: 1, since: 1 };
    await state.refresh(true);
    expect(state.closed).toBe(true);

    // A backend that stops answering must not reopen an application it
    // cannot read, and must not close one either
    answer = new Error('connection refused');
    await state.refresh(true);
    expect(state.closed).toBe(true);
    expect(said).toHaveLength(1);
    expect(said[0].join(' ')).toContain('leaving the application closed');

    // Reported at most once every ten seconds, however long the outage is
    await state.refresh(true);
    await state.refresh(true);
    expect(said).toHaveLength(1);
  });

  test('one read serves every caller waiting on it', async () => {
    let reads = 0;
    const state = new Maintenance(fakeHenri(), DEFAULTS, {
      describe: () => 'redis',
      read: async () => {
        reads++;
        await new Promise((resolve) => setTimeout(resolve, 5));

        return null;
      },
      where: 'shared',
    });

    await Promise.all(Array.from({ length: 50 }, () => state.refresh(true)));

    expect(reads).toBe(1);
  });
});

describe('what a visitor gets', () => {
  let dir;
  let state;
  let request;

  beforeEach(async () => {
    ({ dir, state } = switchIn());
    request = supertest(appWith(state));
    await state.on({ message: 'Back at 04:00 UTC', retryAfter: 900 });
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('a browser gets a page, and it is never cached', async () => {
    const res = await request.get('/').set('Accept', 'text/html');

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('900');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toMatch(/html/u);
    expect(res.text).toContain('Back at 04:00 UTC');
    expect(res.text).toContain('15 minute(s)');
  });

  test('an api client gets the envelope henri writes everywhere', async () => {
    const res = await request
      .get('/api/things')
      .set('Accept', 'application/json');

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('900');
    expect(res.body).toEqual({
      code: 'HENRI_MAINTENANCE_ON',
      data: { retryAfter: 900, since: expect.any(String) },
      error: 'Service Unavailable',
      message: 'Back at 04:00 UTC',
      statusCode: 503,
    });
  });

  test('anything else gets plain text carrying the code', async () => {
    const res = await request.get('/').set('Accept', 'text/plain');

    expect(res.status).toBe(503);
    expect(res.text).toContain('HENRI_MAINTENANCE_ON');
    expect(res.text).toContain('Back at 04:00 UTC');
  });

  test('the message is escaped, not interpolated', async () => {
    await state.off();
    await state.on({ message: '<script>alert(1)</script>' });

    const res = await request.get('/').set('Accept', 'text/html');

    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });

  test('an application supplies its own page', async () => {
    fs.mkdirSync(path.join(dir, 'app', 'views'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'app', 'views', 'maintenance.html'),
      '<h1>Lineup</h1><p>{{message}}</p><p>{{retryAfter}}s since {{since}}</p>'
    );

    const res = await request.get('/').set('Accept', 'text/html');

    expect(res.status).toBe(503);
    expect(res.text).toContain('<h1>Lineup</h1>');
    expect(res.text).toContain('<p>Back at 04:00 UTC</p>');
    expect(res.text).toMatch(/900s since \d{4}-/u);
    expect(res.text).not.toContain('We will be right back');
  });

  test('the built-in page never says less than a minute', () => {
    expect(builtinPage({ message: 'x', retryAfter: 5 })).toContain(
      '1 minute(s)'
    );
  });

  test('an open application is not touched at all', async () => {
    await state.off();

    const res = await request.get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ served: true });
    expect(res.headers['retry-after']).toBeUndefined();
  });
});

describe('the bypass', () => {
  let dir;
  let state;
  let request;
  let record;

  beforeEach(async () => {
    ({ dir, state } = switchIn());
    request = supertest(appWith(state));
    record = await state.on();
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('a signed token gets through and leaves a cookie behind', async () => {
    const res = await request.get(`/?maintenance=${record.token}`);

    expect(res.status).toBe(200);
    expect(res.headers['x-henri-maintenance']).toBe('bypass');

    const cookie = (res.headers['set-cookie'] || []).find((line) =>
      line.startsWith('henri.maintenance=')
    );

    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');

    const next = await request.get('/').set('Cookie', cookie.split(';')[0]);

    expect(next.status).toBe(200);
  });

  test('nothing anybody can send gets through', async () => {
    const tries = [
      '/?maintenance=',
      '/?maintenance=true',
      `/?maintenance=${record.token}x`,
      `/?maintenance=${record.id}`,
    ];

    for (const url of tries) {
      expect((await request.get(url)).status).toBe(503);
    }

    // Nor a header, of any name a proxy might forward
    for (const header of ['X-Maintenance', 'X-Henri-Maintenance', 'Bypass']) {
      const res = await request.get('/').set(header, record.token);

      expect(res.status).toBe(503);
    }
  });

  test('a token of another window, or another purpose, does not verify', async () => {
    const elsewhere = mint({
      expiresIn: 60000,
      purpose: PURPOSE,
      secret: SECRET,
      seed: 'another-window',
      subject: 'another-window',
    });
    const wrongPurpose = mint({
      expiresIn: 60000,
      purpose: 'password-reset',
      secret: SECRET,
      seed: record.id,
      subject: record.id,
    });
    const wrongSecret = mint({
      expiresIn: 60000,
      purpose: PURPOSE,
      secret: 'not-the-secret',
      seed: record.id,
      subject: record.id,
    });

    for (const token of [elsewhere, wrongPurpose, wrongSecret]) {
      expect((await request.get(`/?maintenance=${token}`)).status).toBe(503);
    }
  });

  test('ending the window invalidates the token it minted', async () => {
    expect((await request.get(`/?maintenance=${record.token}`)).status).toBe(
      200
    );

    await state.off();
    const reopened = await state.on();

    expect((await request.get(`/?maintenance=${record.token}`)).status).toBe(
      503
    );
    expect((await request.get(`/?maintenance=${reopened.token}`)).status).toBe(
      200
    );
  });

  test('an application with no secret mints nothing and lets nobody through', async () => {
    const other = switchIn({}, {});

    other.henri.config.get = (key) =>
      key === 'secret' ? undefined : { file: 'switch.json', poll: 0 };

    const closed = createMaintenance(other.henri);
    const written = await closed.on();

    expect(written.token).toBeNull();
    expect((await closed.status()).token).toBeNull();
    expect(
      (await supertest(appWith(closed)).get(`/?maintenance=anything`)).status
    ).toBe(503);

    fs.rmSync(other.dir, { force: true, recursive: true });
  });

  test('"loopback" lets this machine through, and is off by default', async () => {
    expect((await request.get('/')).status).toBe(503);

    const loose = switchIn({ bypass: 'loopback' });
    const app = appWith(loose.state);

    await loose.state.on();

    // Supertest binds the app to the loopback, which is the point
    expect((await supertest(app).get('/')).status).toBe(200);

    fs.rmSync(loose.dir, { force: true, recursive: true });
  });
});

describe('the health probes of a closed application', () => {
  let dir;
  let state;
  let request;

  beforeEach(async () => {
    ({ dir, state } = switchIn());
    state.henri.model = { stores: {} };
    state.henri.modules = { initialized: true };
    request = supertest(appWith(state));
    await state.on();
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  test('liveness answers 200: a restart does not end a maintenance', async () => {
    const res = await request.get('/livez');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('readiness stays ready, and says the application is closed', async () => {
    const res = await request.get('/readyz');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ maintenance: true, status: 'ok' });
  });

  test('an open application says nothing about maintenance', async () => {
    await state.off();

    const res = await request.get('/readyz');

    expect(res.status).toBe(200);
    expect(res.body.maintenance).toBeUndefined();
  });

  test('readyz: "unavailable" is the deployment that wants to be pulled out', async () => {
    const pulled = switchIn({ readyz: 'unavailable' });

    pulled.state.henri.model = { stores: {} };
    pulled.state.henri.modules = { initialized: true };
    await pulled.state.on();

    const app = appWith(pulled.state);
    const res = await supertest(app).get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      maintenance: true,
      reason: 'maintenance',
      status: 'unavailable',
    });

    // Liveness is the other question, and its answer does not change
    expect((await supertest(app).get('/livez')).status).toBe(200);

    fs.rmSync(pulled.dir, { force: true, recursive: true });
  });

  test('a shutdown wins over a maintenance: it is the more urgent no', async () => {
    state.henri.server = { draining: true };

    const res = await request.get('/readyz');

    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('shutting down');
  });
});

describe('a running server picks the switch up', () => {
  let dir;
  let state;
  let server;
  let port;

  beforeAll(async () => {
    ({ dir, state } = switchIn({ poll: 20 }));
    await state.start();

    server = http.createServer(appWith(state));
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { force: true, recursive: true });
  });

  /**
   * One GET against the server, answering the status it gave
   *
   * @param {string} route the path
   * @returns {Promise<number>} the status code
   */
  const status = (route) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', path: route, port },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        }
      );

      req.on('error', reject);
      req.end();
    });

  /**
   * Waits for the server to answer something, or gives up
   *
   * @param {string} route the path
   * @param {number} wanted the status expected
   * @returns {Promise<number>} the last status seen
   */
  const until = async (route, wanted) => {
    const deadline = Date.now() + 5000;
    let last = 0;

    while (Date.now() < deadline) {
      last = await status(route);

      if (last === wanted) {
        return last;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    return last;
  };

  test('thrown by another process, with no restart and no deploy', async () => {
    expect(await status('/')).toBe(200);

    // Another process entirely, which is what an operator with a shell is:
    // nothing in this one is told, and nothing in this one is reloaded
    const write = (record) =>
      execFileSync(
        process.execPath,
        [
          '-e',
          `require('fs').writeFileSync(process.argv[1], process.argv[2])`,
          path.join(dir, 'switch.json'),
          JSON.stringify(record),
        ],
        { stdio: 'ignore' }
      );

    write({
      id: 'ffffffffffffffffffffffffffffffff',
      message: 'Closed by somebody else',
      on: true,
      retryAfter: 30,
      since: Date.now(),
    });

    expect(await until('/', 503)).toBe(503);
    // ...and the probes still answer, which is what keeps the page reachable
    expect(await status('/livez')).toBe(200);
    expect(await status('/readyz')).toBe(200);

    execFileSync(
      process.execPath,
      [
        '-e',
        `require('fs').unlinkSync(process.argv[1])`,
        path.join(dir, 'switch.json'),
      ],
      { stdio: 'ignore' }
    );

    expect(await until('/', 200)).toBe(200);
  });
});

describe('a record that is not one', () => {
  test('is read as an open application rather than trusted', async () => {
    const dir = tmpdir();
    const file = path.join(dir, 'switch.json');
    const backend = new FileSwitch(file);

    expect(await backend.read()).toBeNull();

    for (const content of ['{}', '{"on":false}', 'null', '[]']) {
      fs.writeFileSync(file, content);
      expect(await backend.read()).toBeNull();
    }

    // Unparseable is not "open": it is a switch that could not be read, and
    // the caller decides what to do about that
    fs.writeFileSync(file, 'not json');
    await expect(backend.read()).rejects.toThrow();

    expect(isOn({ on: true })).toBe(true);
    expect(isOn({ on: 'yes' })).toBe(false);
    expect(isOn(null)).toBe(false);

    fs.rmSync(dir, { force: true, recursive: true });
  });
});
