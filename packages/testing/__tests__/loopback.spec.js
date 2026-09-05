const net = require('node:net');

const bindTestServersToLoopback = require('../loopback');

/**
 * Listens and answers where the server ended up
 *
 * @param {...*} args what to hand to `listen()`
 * @returns {Promise<object>} the address of the bound server
 */
const boundTo = (...args) =>
  new Promise((resolve, reject) => {
    const server = net.createServer();

    server.on('error', reject);
    server.listen(...args, () => {
      const address = server.address();

      server.close(() => resolve(address));
    });
  });

describe('binding test servers to the loopback address', () => {
  test('a listen without a host binds 127.0.0.1, not the wildcard', async () => {
    const address = await boundTo(0);

    // The wildcard would be '::' (dual stack), which another process can
    // shadow by binding the more specific 127.0.0.1 on the same port
    expect(address.address).toBe('127.0.0.1');
    expect(address.family).toBe('IPv4');
  });

  test('the options form is treated the same way', async () => {
    const address = await boundTo({ port: 0 });

    expect(address.address).toBe('127.0.0.1');
  });

  test('a host asked for on purpose is left alone', async () => {
    const address = await boundTo(0, '::1');

    expect(address.address).toBe('::1');
  });

  test('the port is readable as soon as listen() returns', () => {
    const server = net.createServer().listen(0);

    // The http client reads it right away, so the dns lookup of the address
    // literal must not defer the bind
    expect(server.address().port).toBeGreaterThan(0);
    server.close();
  });

  test('applying it twice is a no-op', () => {
    expect(bindTestServersToLoopback()).toBe(false);
  });
});
