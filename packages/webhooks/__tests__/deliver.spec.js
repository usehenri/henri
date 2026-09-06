const { MAX_BYTES, deliver, excerpt } = require('../src/deliver');
const { receiver } = require('./helpers');
const { thrown } = require('./thrown');

/** What a delivery to the loopback needs said, and only a test says it */
const LOCAL = { allowHttp: true, allowPrivate: true, timeout: 2000 };

describe('one delivery', () => {
  const servers = [];

  /**
   * A receiving server this suite closes afterwards
   *
   * @param {Function} [handler] What it answers
   * @returns {Promise<object>} The receiver
   */
  const serve = async (handler) => {
    const server = await receiver(handler);

    servers.push(server);

    return server;
  };

  afterAll(async () => {
    for (const server of servers) {
      await server.close();
    }
  });

  test('a 2xx is a delivery, and it carries what was signed', async () => {
    const server = await serve();
    const answer = await deliver({
      ...LOCAL,
      body: '{"hello":"world"}',
      headers: { 'webhook-id': 'delivery-1' },
      url: server.url,
    });

    expect(answer).toMatchObject({ address: '127.0.0.1', status: 200 });
    expect(server.received[0].body).toBe('{"hello":"world"}');
    expect(server.received[0].headers['webhook-id']).toBe('delivery-1');
    expect(server.received[0].headers['content-length']).toBe('17');
    expect(server.received[0].url).toBe('/hooks');
  });

  test('the socket connects to the address that was checked, not to the name', async () => {
    const server = await serve();
    // `.invalid` never resolves (RFC 2606): the only way this request can
    // arrive is on the address the check answered with, which is the whole
    // point of pinning -- a name resolved a second time is a rebinding
    const answer = await deliver({
      allowHttp: true,
      allowPrivate: true,
      body: '{}',
      headers: {},
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      timeout: 2000,
      url: `http://receiver.invalid:${server.port}/hooks`,
    });

    expect(answer).toMatchObject({ address: '127.0.0.1', status: 200 });
    // And the request still carries the name, so TLS would still validate
    // against it rather than against the address
    expect(server.received[0].headers.host).toBe(
      `receiver.invalid:${server.port}`
    );
  });

  test('a 500 fails, and the queue is left to retry it', async () => {
    const server = await serve(() => ({ body: 'nope', status: 500 }));
    const error = await thrown(
      deliver({ ...LOCAL, body: '{}', headers: {}, url: server.url })
    );

    expect(error).toMatchObject({
      code: 'HENRI_WEBHOOK_DELIVERY_FAILED',
      status: 500,
    });
    expect(error.retryable).toBeUndefined();
    expect(error.message).toContain('nope');
  });

  test.each([400, 401, 403, 404, 422, 429])(
    'a %d is retried too, because a deploy and a rotated token both end',
    async (status) => {
      const server = await serve(() => ({ status }));
      const error = await thrown(
        deliver({ ...LOCAL, body: '{}', headers: {}, url: server.url })
      );

      expect(error.status).toBe(status);
      expect(error.retryable).toBeUndefined();
    }
  );

  test('a redirect is not followed, and it is not retried either', async () => {
    const server = await serve(() => ({
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      status: 302,
    }));

    const error = await thrown(
      deliver({ ...LOCAL, body: '{}', headers: {}, url: server.url })
    );

    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/does not follow a redirect/u);
    expect(error.message).toContain('169.254.169.254');
    expect(error.hint).toMatch(/webhooks:update/u);

    // The delivery went to the receiver, and nowhere else
    expect(server.received).toHaveLength(1);
  });

  test('a 410 Gone says stop, and says so permanently', async () => {
    const server = await serve(() => ({ status: 410 }));

    expect(
      await thrown(
        deliver({ ...LOCAL, body: '{}', headers: {}, url: server.url })
      )
    ).toMatchObject({ gone: true, retryable: false });
  });

  test('a receiver that never answers hits the deadline', async () => {
    const server = await serve();

    // Answer nothing at all, ever
    const hung = await new Promise((resolve) => {
      const http = require('http');
      const held = http.createServer(() => null);

      held.listen(0, '127.0.0.1', () => resolve(held));
    });

    servers.push({ close: () => new Promise((done) => hung.close(done)) });

    const error = await thrown(
      deliver({
        ...LOCAL,
        body: '{}',
        headers: {},
        timeout: 250,
        url: `http://127.0.0.1:${hung.address().port}/hooks`,
      })
    );

    expect(error.code).toBe('HENRI_WEBHOOK_TIMEOUT');
    expect(error.message).toContain('250ms');
    expect(server.received).toHaveLength(0);
  });

  test('a receiver with nothing listening fails, and is retried', async () => {
    // Take a port and let it go, so nothing answers on it
    const server = await serve();
    const { port } = server;

    await server.close();
    servers.splice(servers.indexOf(server), 1);

    await expect(
      deliver({
        ...LOCAL,
        body: '{}',
        headers: {},
        url: `http://127.0.0.1:${port}/hooks`,
      })
    ).rejects.toThrow(/ECONNREFUSED/u);
  });

  test('the answer is read up to a bound and then the socket is dropped', async () => {
    const server = await serve(() => ({
      body: 'x'.repeat(MAX_BYTES * 2),
      status: 500,
    }));

    const error = await thrown(
      deliver({ ...LOCAL, body: '{}', headers: {}, url: server.url })
    );

    // What is kept for the operator is an excerpt, not the answer
    expect(error.body.length).toBeLessThanOrEqual(500);
  });

  test('an address that must not be reached is refused before the socket', async () => {
    await expect(
      deliver({
        body: '{}',
        headers: {},
        timeout: 2000,
        url: 'http://169.254.169.254/latest/meta-data/',
      })
    ).rejects.toMatchObject({
      code: 'HENRI_WEBHOOK_ADDRESS_REFUSED',
      retryable: false,
    });

    await expect(
      deliver({
        allowHttp: true,
        body: '{}',
        headers: {},
        timeout: 2000,
        url: 'http://localhost:6379/',
      })
    ).rejects.toMatchObject({ code: 'HENRI_WEBHOOK_ADDRESS_REFUSED' });
  });

  test('an excerpt is one line and short', () => {
    expect(excerpt('  a\n  b  ')).toBe('a b');
    expect(excerpt('x'.repeat(9000))).toHaveLength(500);
    expect(excerpt(null)).toBe('');
  });
});
