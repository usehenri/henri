const { RANGES, check, parse, refusal, unwrap } = require('../src/address');
const { thrown } = require('./thrown');

/**
 * A resolver that answers whatever a test wants, so the address rules are
 * exercised without a network and without a name that could change
 *
 * @param {object} answers `{ hostname: ['1.2.3.4', ...] }`
 * @returns {Function} A `dns.promises.lookup` stand-in
 */
const resolver = (answers) => async (hostname) => {
  const found = answers[hostname];

  if (!found) {
    throw Object.assign(new Error(`ENOTFOUND ${hostname}`), {
      code: 'ENOTFOUND',
    });
  }

  return found.map((address) => ({
    address,
    family: address.includes(':') ? 6 : 4,
  }));
};

describe('what a delivery is allowed to open', () => {
  test('only http and https, and https unless the application says otherwise', async () => {
    expect(() => parse('file:///etc/passwd')).toThrow(/is not delivered to/u);
    expect(() => parse('gopher://example.com/')).toThrow(/is not delivered/u);
    expect(() => parse('ftp://example.com/')).toThrow(/is not delivered/u);
    expect(() => parse('not a url')).toThrow(/is not a url/u);
    expect(() => parse('http://example.com/hooks')).toThrow(/plaintext http/u);
    expect(parse('http://example.com/hooks', { allowHttp: true }).href).toBe(
      'http://example.com/hooks'
    );
    expect(parse('https://example.com/hooks').href).toBe(
      'https://example.com/hooks'
    );
  });

  test('a url carrying credentials is refused, and they are not echoed back', async () => {
    const error = await thrown(() =>
      parse('https://user:hunter2@example.com/hooks')
    );

    expect(error.message).toMatch(/carries credentials/u);
    expect(JSON.stringify(error.url || '')).not.toContain('hunter2');
  });

  test('every refusal carries the code the catalogue declares', async () => {
    expect(await thrown(() => parse('file:///etc/passwd'))).toMatchObject({
      code: 'HENRI_WEBHOOK_ADDRESS_REFUSED',
      retryable: false,
    });
  });

  test.each([
    ['the metadata service', '169.254.169.254'],
    ['the loopback', '127.0.0.1'],
    ['another loopback', '127.1.2.3'],
    ['a private network', '10.0.0.5'],
    ['another private network', '172.16.9.9'],
    ['a home network', '192.168.1.1'],
    ['carrier-grade NAT', '100.100.1.1'],
    ['this network', '0.0.0.0'],
    ['a multicast address', '224.0.0.1'],
    ['the broadcast address', '255.255.255.255'],
    ['a reserved range', '240.0.0.1'],
    ['the IPv6 loopback', '::1'],
    ['an IPv6 unique local address', 'fd00::1'],
    ['an IPv6 link-local address', 'fe80::1'],
    ['the unspecified IPv6 address', '::'],
    ['an IPv4 loopback dressed as IPv6', '::ffff:127.0.0.1'],
    ['the same, in hexadecimal', '::ffff:7f00:1'],
    ['a 6to4 address carrying an IPv4 one', '2002:a00:1::1'],
    ['a NAT64 address carrying an IPv4 one', '64:ff9b::a00:1'],
  ])('refuses %s (%s)', async (what, address) => {
    expect(refusal(address)).toBeTruthy();

    await expect(
      check('https://receiver.example/hooks', {
        lookup: resolver({ 'receiver.example': [address] }),
      })
    ).rejects.toThrow(/which is/u);
  });

  test.each([
    ['a public address', '93.184.216.34'],
    ['a public IPv6 address', '2606:2800:220:1:248:1893:25c8:1946'],
    ['the edge of the private range', '11.0.0.1'],
    ['the edge of the link-local range', '169.253.255.255'],
  ])('allows %s (%s)', async (what, address) => {
    expect(refusal(address)).toBeNull();

    const answer = await check('https://receiver.example/hooks', {
      lookup: resolver({ 'receiver.example': [address] }),
    });

    expect(answer.address).toBe(address);
  });

  test('one bad answer refuses the name, however many good ones there are', async () => {
    await expect(
      check('https://sneaky.example/hooks', {
        lookup: resolver({ 'sneaky.example': ['93.184.216.34', '::1'] }),
      })
    ).rejects.toThrow(/resolves to ::1/u);
  });

  test('the answer is pinned, so nothing resolves the name twice', async () => {
    const answer = await check('https://receiver.example/hooks', {
      lookup: resolver({ 'receiver.example': ['93.184.216.34'] }),
    });

    expect(answer).toMatchObject({
      address: '93.184.216.34',
      addresses: ['93.184.216.34'],
      family: 4,
    });
    expect(answer.url.href).toBe('https://receiver.example/hooks');
  });

  test('a literal address is checked the same way a name is', async () => {
    await expect(check('https://169.254.169.254/latest/')).rejects.toThrow(
      /link-local/u
    );
    await expect(check('https://[::1]:8080/hooks')).rejects.toThrow(
      /loopback/u
    );
  });

  test('allowPrivate lifts it, which is what a development configuration does', async () => {
    const answer = await check('https://receiver.example/hooks', {
      allowPrivate: true,
      lookup: resolver({ 'receiver.example': ['127.0.0.1'] }),
    });

    expect(answer.address).toBe('127.0.0.1');
  });

  test('a name that does not resolve is retried, not buried', async () => {
    const error = await thrown(
      check('https://gone.example/hooks', { lookup: resolver({}) })
    );

    expect(error.message).toMatch(/does not resolve/u);
    expect(error.retryable).toBe(true);
  });

  test('unwrap only unwraps what is an IPv4 address in disguise', () => {
    expect(unwrap('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(unwrap('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(unwrap('2606:2800::1')).toBe('2606:2800::1');
    expect(unwrap('93.184.216.34')).toBe('93.184.216.34');
    expect(refusal('not-an-address')).toBe('not an IP address');
  });

  test('the ranges are declared once and every one of them is a subnet', () => {
    for (const [cidr, what, family] of RANGES) {
      expect(cidr).toMatch(/^[0-9a-f.:]+\/\d+$/u);
      expect(what.length).toBeGreaterThan(4);
      expect([4, 6]).toContain(family);
    }
  });
});
