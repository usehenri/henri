const express = require('express');
const http = require('http');
const supertest = require('supertest');

const Henri = require('../henri');
const Server = require('../2.server');
const { loopbackOnly } = require('../base/http');

/**
 * A minimal henri for the server module
 *
 * @param {object} [config={}] the configuration
 * @param {object} [flags={}] { isProduction }
 * @returns {object} a henri look-alike
 */
const fakeHenri = (config = {}, { isProduction = false } = {}) => ({
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
  isProduction,
  isTest: true,
  pen: { error: () => {}, info: () => {}, line: () => {}, warn: () => {} },
  utils: { clearConsole: () => true },
});

describe('server', () => {
  describe('module (stubbed henri)', () => {
    test('binds to loopback by default outside production', async () => {
      const server = new Server();

      server.henri = fakeHenri();
      await server.init();

      expect(server.host).toBe('127.0.0.1');
    });

    test('binds to all interfaces in production', async () => {
      const server = new Server();

      server.henri = fakeHenri({}, { isProduction: true });
      await server.init();

      expect(server.host).toBe('0.0.0.0');
    });

    test('config.host and HENRI_HOST (the --host flag) override the default', async () => {
      const fromConfig = new Server();

      fromConfig.henri = fakeHenri({ host: '192.168.1.10' });
      await fromConfig.init();
      expect(fromConfig.host).toBe('192.168.1.10');

      process.env.HENRI_HOST = '0.0.0.0';
      try {
        const fromFlag = new Server();

        fromFlag.henri = fakeHenri({ host: '192.168.1.10' });
        await fromFlag.init();
        expect(fromFlag.host).toBe('0.0.0.0');
      } finally {
        delete process.env.HENRI_HOST;
      }
    });

    test('cors is off unless configured', async () => {
      const off = new Server();

      off.henri = fakeHenri();
      await off.init();
      off.app.get('/ping', (req, res) => res.send('pong'));

      const none = await supertest(off.app)
        .get('/ping')
        .set('Origin', 'http://evil.test');

      expect(none.headers['access-control-allow-origin']).toBeUndefined();
      expect(none.headers['x-powered-by']).toBeUndefined();

      const on = new Server();

      on.henri = fakeHenri({ cors: true });
      await on.init();
      on.app.get('/ping', (req, res) => res.send('pong'));

      const any = await supertest(on.app)
        .get('/ping')
        .set('Origin', 'http://app.test');

      expect(any.headers['access-control-allow-origin']).toBe('*');

      const scoped = new Server();

      scoped.henri = fakeHenri({ cors: { origin: 'http://app.test' } });
      await scoped.init();
      scoped.app.get('/ping', (req, res) => res.send('pong'));

      const only = await supertest(scoped.app)
        .get('/ping')
        .set('Origin', 'http://app.test');

      expect(only.headers['access-control-allow-origin']).toBe(
        'http://app.test'
      );
    });

    test('shutdown stops henri once, exits with the stop result, and a second signal exits at once', async () => {
      const server = new Server();
      const exits = [];
      let stops = 0;
      let release;
      const stopping = new Promise((resolve) => {
        release = resolve;
      });

      server.henri = Object.assign(fakeHenri(), {
        stop: async () => {
          stops++;
          await stopping;

          return [new Error('a store failed to stop')];
        },
      });
      server.exit = (code) => exits.push(code);

      const first = server.shutdown('SIGTERM');

      // Readiness answers 503 from the first moment, before anything closes
      expect(server.draining).toBe(true);
      await vi.waitFor(() => expect(stops).toBe(1));
      expect(exits).toEqual([]);

      await server.shutdown('SIGTERM');
      expect(exits).toEqual([1]);
      expect(stops).toBe(1);

      release();
      await first;

      expect(exits).toEqual([1, 1]);
    });

    test('shutdown drains the requests in flight before the modules stop', async () => {
      const server = new Server();
      const order = [];
      let received = null;
      const arrived = new Promise((resolve) => {
        received = resolve;
      });

      server.henri = Object.assign(
        fakeHenri({ port: 0, shutdown: { delay: 0, drain: 5000 } }),
        {
          stop: async () => {
            order.push('modules stopped');

            return [];
          },
        }
      );
      server.exit = () => order.push('exited');

      await server.init();
      server.app.get('/slow', (req, res) => {
        received();
        setTimeout(() => {
          order.push('answered');
          res.json({ ok: true });
        }, 200);
      });
      await server.listen(0, '127.0.0.1');

      const { port } = server.httpServer.address();
      const answer = new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', path: '/slow', port });

        req.on('response', (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end();
      });

      await arrived;
      await server.shutdown('SIGTERM');

      expect(server.draining).toBe(true);
      expect(await answer).toBe(200);
      expect(order).toEqual(['answered', 'modules stopped', 'exited']);
      expect(server.httpServer.listening).toBe(false);
    });

    test('shutdown exits 0 on a clean stop', async () => {
      const server = new Server();
      const exits = [];

      server.henri = Object.assign(fakeHenri(), { stop: async () => [] });
      server.exit = (code) => exits.push(code);

      await server.shutdown('SIGINT');

      expect(exits).toEqual([0]);
    });

    test('signal handlers are installed once and removed by stop', async () => {
      const server = new Server();
      const before = {
        SIGINT: process.listenerCount('SIGINT'),
        SIGTERM: process.listenerCount('SIGTERM'),
      };

      server.henri = fakeHenri();
      await server.init();
      server.installSignalHandlers();
      server.installSignalHandlers();

      expect(process.listenerCount('SIGINT')).toBe(before.SIGINT + 1);
      expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM + 1);

      await server.stop();

      expect(process.listenerCount('SIGINT')).toBe(before.SIGINT);
      expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM);
    });

    test('lanIp returns an ipv4 address or null', () => {
      const ip = Server.lanIp();

      expect(ip === null || /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)).toBe(true);
    });
  });

  describe('choosing a port', () => {
    test('a busy port rejects, keeping the reason the retry reads', async () => {
      const net = require('net');
      const taken = net.createServer();

      await new Promise((resolve) => taken.listen(0, '127.0.0.1', resolve));

      const busy = taken.address().port;
      const server = new Server();

      server.henri = fakeHenri({ port: busy });
      await server.init();

      // In development, start() walks up from a busy port by binding and
      // catching this, rather than asking whether the port is free and
      // binding after, which leaves a window for anything else to take it
      const failure = await server
        .listen(busy, '127.0.0.1')
        .then(() => null)
        .catch((error) => error);

      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toContain(`port ${busy} already in use`);
      expect(failure.cause && failure.cause.code).toBe('EADDRINUSE');

      await new Promise((resolve) => taken.close(resolve));
    }, 30000);
  });

  describe('loopbackOnly', () => {
    const appWithAddress = (address) => {
      const app = express();

      app.use((req, res, next) => {
        Object.defineProperty(req.socket, 'remoteAddress', { value: address });
        next();
      });
      app.get('/_routes', loopbackOnly(), (req, res) => res.json({ ok: true }));

      return supertest(app);
    };

    test.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.42.0.1'])(
      'lets %s through',
      async (address) => {
        const res = await appWithAddress(address).get('/_routes');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
      }
    );

    test.each(['10.0.0.5', '192.168.1.20', '::ffff:10.0.0.5', '', undefined])(
      'answers 404 to %s',
      async (address) => {
        const res = await appWithAddress(address)
          .get('/_routes')
          .set('Accept', 'application/json');

        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ statusCode: 404 });
      }
    );
  });

  describe('running application (demo, runlevel 5)', () => {
    let henri;
    let request;

    beforeAll(async () => {
      process.env.SKIP_WORKERS = 'true';
      henri = new Henri({ runlevel: 5 });
      await henri.init();
      request = supertest(henri.server.app);
    }, 60000);

    afterAll(async () => {
      delete process.env.SKIP_WORKERS;
      await henri.stop();
    });

    test('listens on loopback', () => {
      const address = henri.server.httpServer.address();

      expect(henri.server.host).toBe('127.0.0.1');
      expect(address.address).toBe('127.0.0.1');
      expect(henri.server.url).toBe(`http://localhost:${address.port}/`);
    });

    test('serves the home page without x-powered-by', async () => {
      const res = await request.get('/');

      expect(res.status).toBe(200);
      expect(res.text).toMatch(/<title>Hello!<\/title>/);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    test('/_routes and /_controllers are only served in development', async () => {
      expect(henri.isDev).toBe(false);

      const hidden = await request
        .get('/_routes')
        .set('Accept', 'application/json');

      expect(hidden.status).toBe(404);

      henri.isDev = true;
      try {
        await henri.router.reload();

        const routes = await request.get('/_routes');

        expect(routes.status).toBe(200);
        expect(Object.keys(routes.body)).toEqual(
          expect.arrayContaining(['get /artwork', 'post /register'])
        );

        const controllers = await request.get('/_controllers');

        expect(controllers.status).toBe(200);
        expect(controllers.body.map(([name]) => name)).toEqual(
          expect.arrayContaining(['artwork#index', 'main#list'])
        );
      } finally {
        henri.isDev = false;
        await henri.router.reload();
      }

      const again = await request
        .get('/_controllers')
        .set('Accept', 'application/json');

      expect(again.status).toBe(404);
    });

    test('unmatched routes get a negotiated 404', async () => {
      const json = await request.get('/nope').set('Accept', 'application/json');

      expect(json.status).toBe(404);
      expect(json.body).toEqual({
        error: 'Not Found',
        message: expect.stringContaining('Cannot GET /nope'),
        statusCode: 404,
      });
      expect(json.body.message).toContain('henri routes');

      const html = await request.get('/nope').set('Accept', 'text/html');

      expect(html.status).toBe(404);
      expect(html.type).toBe('text/html');
      expect(html.text).toMatch(/<h1>404 Not Found<\/h1>/);

      const text = await request.put('/nope').set('Accept', 'text/plain');

      expect(text.status).toBe(404);
      expect(text.text).toMatch(/^404 Not Found\nCannot PUT \/nope/);
    });

    test('controller errors reach the error handler, negotiated', async () => {
      henri.router.handler.get('/boom', () => {
        throw new Error('kaboom');
      });
      henri.router.handler.get('/async-boom', async () => {
        await Promise.resolve();
        throw new Error('async kaboom');
      });

      const json = await request.get('/boom').set('Accept', 'application/json');

      expect(json.status).toBe(500);
      expect(json.body).toMatchObject({
        error: 'Internal Server Error',
        message: 'kaboom',
        statusCode: 500,
      });
      expect(json.body.data.stack).toMatch(/kaboom/);

      const html = await request.get('/async-boom').set('Accept', 'text/html');

      expect(html.status).toBe(500);
      expect(html.text).toMatch(/<h1>500 Internal Server Error<\/h1>/);
      expect(html.text).toMatch(/async kaboom/);
    });

    test('a malformed json body is a 400 with the parser message', async () => {
      const res = await request
        .post('/artwork')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .send('{"title": ');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'Bad Request', statusCode: 400 });
      expect(res.body.message).toMatch(/JSON/);
    });

    test('stop closes the listener and the server can be asked again', async () => {
      await henri.server.stop();

      expect(henri.server.httpServer.listening).toBe(false);
      await expect(henri.server.stop()).resolves.toBe(false);
    });
  });
});
