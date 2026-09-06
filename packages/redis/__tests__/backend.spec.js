const Backend = require('../index');
const { CONNECT_TIMEOUT, MAX_BACKOFF, backoff, redact } = require('../index');

describe('the redis backend, without a server', () => {
  test('exports the shared store contract core asks for', () => {
    const backend = new Backend({ adapter: 'redis' });

    expect(backend.name).toBe('redis');
    expect(typeof backend.start).toBe('function');
    expect(typeof backend.stop).toBe('function');
    expect(typeof backend.ping).toBe('function');
    expect(typeof backend.rateLimitStore).toBe('function');
    expect(typeof backend.keyValueStore).toBe('function');
  });

  test('prints the target without its password', () => {
    expect(redact('redis://henri:hunter2@db:6379')).toBe(
      'redis://henri:[FILTERED]@db:6379'
    );
    expect(redact('redis://db:6379')).toBe('redis://db:6379');
    expect(
      new Backend({ url: 'rediss://user:secret@cache:6380' }).describe()
    ).toBe('rediss://user:[FILTERED]@cache:6380');
  });

  test('defaults to a local server', () => {
    expect(new Backend().describe()).toBe('redis://127.0.0.1:6379');
  });

  test('keeps henri’s own keys out of the driver options', () => {
    const backend = new Backend({
      adapter: 'redis',
      database: 3,
      enabled: true,
      onError: 'open',
      password: 'hunter2',
      prefix: 'lineup:',
      url: 'redis://cache:6379',
    });

    expect(backend.options).toMatchObject({
      database: 3,
      disableOfflineQueue: true,
      password: 'hunter2',
      url: 'redis://cache:6379',
    });
    expect(backend.options).not.toHaveProperty('adapter');
    expect(backend.options).not.toHaveProperty('onError');
    expect(backend.options).not.toHaveProperty('prefix');
    expect(backend.prefix).toBe('lineup:');
  });

  test('a socket option of the application wins over the defaults', () => {
    const backend = new Backend({ socket: { keepAlive: 1000, tls: true } });

    expect(backend.options.socket).toMatchObject({
      connectTimeout: CONNECT_TIMEOUT,
      keepAlive: 1000,
      tls: true,
    });
    expect(typeof backend.options.socket.reconnectStrategy).toBe('function');
  });

  test('the reconnect backs off and never gives up', () => {
    expect(backoff(0)).toBe(100);
    expect(backoff(1)).toBe(200);
    expect(backoff(4)).toBe(1600);
    expect(backoff(20)).toBe(MAX_BACKOFF);
  });

  test('one key space per feature', () => {
    const backend = new Backend({ prefix: 'lineup:' });

    expect(backend.rateLimitStore('global').prefix).toBe('lineup:rl:global:');
    expect(backend.rateLimitStore('auth').prefix).toBe('lineup:rl:auth:');
    expect(backend.keyValueStore('idempotency').key('abc')).toBe(
      'lineup:kv:idempotency:abc'
    );
  });

  test('a server that is not there fails fast, and says so', async () => {
    const backend = new Backend({
      connectTimeout: 300,
      url: 'redis://127.0.0.1:6399',
    });

    await expect(backend.start()).rejects.toThrow(
      /redis did not answer within 300ms/u
    );

    // The client stays alive and keeps reconnecting; a command meanwhile
    // rejects rather than queueing, which is what lets a fail-closed guard
    // answer 503 instead of hanging
    await expect(backend.keyValueStore('idempotency').get('k')).rejects.toThrow(
      /redis is not connected/u
    );
    await expect(backend.ping()).rejects.toThrow(/not connected/u);

    await backend.stop();
  });

  test('stopping a backend that never started is fine', async () => {
    await expect(new Backend().stop()).resolves.toBe(true);
  });
});
