const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const { DEFAULTS, drain, settings } = require('../base/shutdown');

/** The server the signal tests send a real SIGTERM to */
const FIXTURE = path.join(__dirname, 'fixtures', 'drain-server.js');

/**
 * A configuration object, as the config module answers it
 *
 * @param {object} [config={}] the keys it holds
 * @returns {object} something with get and has
 */
const configOf = (config = {}) => ({
  get: (key) => config[key],
  has: (key) => Object.prototype.hasOwnProperty.call(config, key),
});

/**
 * A pen that keeps what it was told
 *
 * @param {Array} lines where to keep it
 * @returns {object} a pen
 */
const penOf = (lines) => ({
  error: (...args) => lines.push(['error', ...args]),
  info: (...args) => lines.push(['info', ...args]),
  warn: (...args) => lines.push(['warn', ...args]),
});

/**
 * Listens on a free loopback port
 *
 * @param {http.Server} server the server
 * @returns {Promise<number>} the port
 */
const listen = (server) =>
  new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

/**
 * A GET request, answering what came back instead of throwing on a 503
 *
 * @param {number} port the port
 * @param {string} route the path
 * @param {object} [options={}] http.request options (agent, headers...)
 * @returns {Promise<{status: number, body: string}>} the answer
 */
const get = (port, route, options = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      Object.assign({ host: '127.0.0.1', path: route, port }, options),
      (res) => {
        let body = '';

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ body, status: res.statusCode }));
      }
    );

    req.on('error', reject);
    req.end();
  });

describe('the shutdown settings', () => {
  test('are the defaults without a shutdown key', () => {
    expect(settings(configOf())).toEqual(DEFAULTS);
    expect(settings(null)).toEqual(DEFAULTS);
    expect(DEFAULTS).toEqual({ delay: 0, drain: 10000, signals: true });
  });

  test('take what the configuration says', () => {
    expect(
      settings(configOf({ shutdown: { delay: 2000, drain: 30000 } }))
    ).toEqual({ delay: 2000, drain: 30000, signals: true });

    expect(settings(configOf({ shutdown: { signals: false } }))).toEqual({
      delay: 0,
      drain: 10000,
      signals: false,
    });
  });

  test('fall back on anything that is not a duration', () => {
    expect(
      settings(configOf({ shutdown: { delay: -1, drain: 'soon' } }))
    ).toEqual(DEFAULTS);
    expect(settings(configOf({ shutdown: 'yes' }))).toEqual(DEFAULTS);
    expect(settings(configOf({ shutdown: { drain: 0 } })).drain).toBe(0);
  });
});

describe('draining a server', () => {
  let server = null;

  afterEach(async () => {
    if (server && server.listening) {
      await new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      });
    }

    server = null;
  });

  test('lets the request in flight finish, then closes the listener', async () => {
    let received = null;
    const arrived = new Promise((resolve) => {
      received = resolve;
    });

    server = http.createServer((req, res) => {
      received();
      setTimeout(() => res.end('finished'), 300);
    });

    const port = await listen(server);
    const answer = get(port, '/slow');

    await arrived;

    const lines = [];
    const started = Date.now();
    const result = await drain(server, {
      deadline: 5000,
      delay: 0,
      pen: penOf(lines),
    });

    expect(result).toEqual({ drained: true, forced: false, open: 1 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect(server.listening).toBe(false);
    expect(await answer).toEqual({ body: 'finished', status: 200 });
    expect(lines[0]).toEqual([
      'info',
      'server',
      'no longer accepting connections',
      '1 open, 5000ms to finish',
    ]);

    await expect(get(port, '/slow')).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });

  test('hangs up the idle keep-alive sockets instead of waiting for them', async () => {
    server = http.createServer((req, res) => res.end('quick'));
    server.keepAliveTimeout = 30000;

    const port = await listen(server);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

    expect(await get(port, '/', { agent })).toEqual({
      body: 'quick',
      status: 200,
    });

    const started = Date.now();
    const result = await drain(server, { deadline: 5000, delay: 0 });

    // Without closeIdleConnections() this waits out keepAliveTimeout
    expect(Date.now() - started).toBeLessThan(2000);
    expect(result).toEqual({ drained: true, forced: false, open: 1 });
    agent.destroy();
  });

  test('destroys what is still open when the deadline passes', async () => {
    let received = null;
    const arrived = new Promise((resolve) => {
      received = resolve;
    });

    server = http.createServer(() => received());

    const port = await listen(server);
    const answer = get(port, '/forever');

    await arrived;

    const lines = [];
    const result = await drain(server, {
      deadline: 100,
      delay: 0,
      pen: penOf(lines),
    });

    expect(result).toMatchObject({ drained: true, forced: true });
    await expect(answer).rejects.toThrow();
    await vi.waitFor(() =>
      expect(lines.map((line) => line[2])).toContain(
        '1 connection(s) still open after 100ms, closing'
      )
    );
  });

  test('keeps serving during the delay, then closes', async () => {
    server = http.createServer((req, res) => res.end('still here'));

    const port = await listen(server);
    const draining = drain(server, { deadline: 1000, delay: 400 });

    expect(await get(port, '/')).toEqual({ body: 'still here', status: 200 });
    expect(server.listening).toBe(true);
    expect(await draining).toMatchObject({ drained: true, forced: false });
    expect(server.listening).toBe(false);
  });

  test('does nothing when the server is not listening', async () => {
    expect(await drain(null, {})).toEqual({
      drained: false,
      forced: false,
      open: 0,
    });
    expect(await drain(http.createServer(), {})).toEqual({
      drained: false,
      forced: false,
      open: 0,
    });
  });
});

describe('a real SIGTERM', () => {
  const children = [];

  /**
   * Boots the fixture server in a process of its own
   *
   * @param {object} [config={}] what its `config` answers
   * @param {object} [env={}] more environment variables
   * @returns {Promise<object>} `{ child, events, port, exited }`
   */
  const boot = (config = {}, env = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [FIXTURE], {
        env: Object.assign({}, process.env, env, {
          DRAIN_CONFIG: JSON.stringify(Object.assign({ port: 0 }, config)),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const events = [];
      const errors = [];
      const exited = new Promise((done) => {
        child.on('exit', (code, signal) => done({ code, signal }));
      });
      let rest = '';

      children.push(child);
      child.stderr.on('data', (chunk) => errors.push(String(chunk)));
      child.stdout.on('data', (chunk) => {
        rest += chunk;

        const lines = rest.split('\n');

        rest = lines.pop();

        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);

          events.push(event);

          if (event.event === 'listening') {
            resolve({ child, errors, events, exited, port: event.port });
          }

          if (event.event === 'failed') {
            reject(new Error(event.message));
          }
        }
      });

      child.on('error', reject);
    });

  /** The names of what happened, in order */
  const names = (events) =>
    events.map((event) => event.event).filter((name) => name !== 'log');

  afterAll(() => {
    for (const child of children) {
      child.kill('SIGKILL');
    }
  });

  test('finishes the request in flight, refuses new ones, then stops', async () => {
    const app = await boot(
      { shutdown: { delay: 0, drain: 5000 } },
      {
        DRAIN_SLOW: '800',
      }
    );
    const answer = get(app.port, '/slow');

    await vi.waitFor(() => expect(names(app.events)).toContain('received'));

    app.child.kill('SIGTERM');

    // The port closes first, so a load balancer stops sending here...
    await vi.waitFor(
      async () =>
        await expect(get(app.port, '/slow')).rejects.toMatchObject({
          code: 'ECONNREFUSED',
        })
    );

    // ...while what was already being served is answered in full
    expect(await answer).toEqual({ body: '{"ok":true}', status: 200 });

    const { code } = await app.exited;

    expect(code).toBe(0);
    expect(names(app.events)).toEqual([
      'listening',
      'received',
      'served',
      'stopped',
    ]);
  }, 30000);

  test('answers 503 on readiness while it is still listening', async () => {
    const app = await boot({ shutdown: { delay: 1500, drain: 5000 } });

    expect((await get(app.port, '/readyz')).status).toBe(200);

    app.child.kill('SIGTERM');

    // The signal has arrived; `shutdown.delay` is what keeps the port open
    await vi.waitFor(() =>
      expect(
        app.events.some((event) =>
          String(event.args && event.args[1]).includes('SIGTERM received')
        )
      ).toBe(true)
    );

    const draining = await get(app.port, '/readyz');

    expect(draining.status).toBe(503);
    expect(JSON.parse(draining.body)).toMatchObject({
      reason: 'shutting down',
      status: 'unavailable',
    });

    // Liveness stays 200: restarting a process that is leaving on purpose
    // would cut the very requests the drain is finishing
    expect((await get(app.port, '/livez')).status).toBe(200);

    const { code } = await app.exited;

    expect(code).toBe(0);
  }, 30000);

  test('closes the sockets still open after the drain deadline', async () => {
    const app = await boot({ shutdown: { delay: 0, drain: 300 } });
    const answer = get(app.port, '/forever');

    await vi.waitFor(() => expect(names(app.events)).toContain('received'));

    const started = Date.now();

    app.child.kill('SIGTERM');

    await expect(answer).rejects.toThrow();

    const { code } = await app.exited;

    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(10000);
    expect(
      app.events.some(
        (event) =>
          event.level === 'error' &&
          String(event.args && event.args[1]).includes('still open after 300ms')
      )
    ).toBe(true);
  }, 30000);

  test('leaves the signals alone with shutdown.signals false', async () => {
    const app = await boot({ shutdown: { signals: false } });

    app.child.kill('SIGTERM');

    const { code, signal } = await app.exited;

    // No handler, so the default disposition of SIGTERM applies
    expect(code).toBe(null);
    expect(signal).toBe('SIGTERM');
    expect(names(app.events)).toEqual(['listening']);
  }, 30000);
});
