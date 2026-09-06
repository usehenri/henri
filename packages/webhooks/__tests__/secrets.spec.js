const {
  SEALED,
  active,
  fresh,
  isSealed,
  keyring,
  open,
  rotate,
  seal,
} = require('../src/secrets');
const { DEFAULTS, normalize, table } = require('../src/config');
const { build, close } = require('./helpers');
const { thrown } = require('./thrown');

describe('the secrets at rest', () => {
  const keys = keyring('a-test-secret-that-is-long-enough');

  test('a sealed secret is not the secret', () => {
    const secret = 'whsec_JNW1cLGgqhJ8ktIsK+Y0Iw==';
    const sealed = seal(secret, keys);

    expect(sealed).not.toContain(secret);
    expect(sealed.startsWith(`${SEALED}:${keys.id}:`)).toBe(true);
    expect(isSealed(sealed)).toBe(true);
    expect(open(sealed, keys)).toBe(secret);
  });

  test('two sealings of one secret differ, and both open', () => {
    const secret = 'whsec_JNW1cLGgqhJ8ktIsK+Y0Iw==';

    expect(seal(secret, keys)).not.toBe(seal(secret, keys));
    expect(open(seal(secret, keys), keys)).toBe(secret);
  });

  test('without an application secret nothing is sealed, and it still reads', () => {
    expect(seal('whsec_x', null)).toBe('whsec_x');
    expect(isSealed('whsec_x')).toBe(false);
    expect(open('whsec_x', null)).toBe('whsec_x');
    expect(open('whsec_x', keys)).toBe('whsec_x');
  });

  test('a key that changed is reported as exactly that', async () => {
    const sealed = seal('whsec_x', keys);
    const other = keyring('another-secret-entirely');

    expect(() => open(sealed, other)).toThrow(/sealed with another key/u);
    expect(() => open(sealed, null)).toThrow(/no "secret" to open it with/u);
    expect(await thrown(() => open(sealed, other))).toMatchObject({
      code: 'HENRI_WEBHOOK_SECRET_UNREADABLE',
      hint: expect.stringMatching(/webhooks:rotate/u),
      retryable: false,
    });
  });

  test('a row that was tampered with does not open', () => {
    const [marker, id, iv, tag, sealed] = seal('whsec_x', keys).split(':');
    const flipped = Buffer.from(sealed, 'base64');

    flipped[0] ^= 0xff;

    expect(() =>
      open([marker, id, iv, tag, flipped.toString('base64')].join(':'), keys)
    ).toThrow(/does not decrypt/u);
  });

  test('a rotation keeps what has not expired, and only that', () => {
    const now = 1000000;
    const first = fresh({ now });
    const second = rotate([first], { grace: 3600000, now });

    expect(second).toHaveLength(2);
    expect(second[1].expiresAt).toBe(now + 3600000);
    expect(active(second, now)).toHaveLength(2);
    expect(active(second, now + 3600001)).toHaveLength(1);
    expect(rotate([first], { grace: 0, now })).toHaveLength(1);
    // A grace never extends an expiry that is already closer
    const third = rotate(second, { grace: 7200000, now: now + 10 });

    expect(third[2].expiresAt).toBe(now + 3600000);
  });
});

describe('the configuration', () => {
  test('the defaults are the ones the documentation lists', () => {
    expect(normalize()).toEqual({
      allowHttp: false,
      allowPrivate: false,
      backoff: { base: 10000, factor: 3, jitter: 0.2, max: 21600000 },
      install: true,
      maxAttempts: 8,
      maxFanout: 1000,
      queue: 'webhooks',
      store: 'default',
      tables: { endpoints: 'henri_webhooks' },
      timeout: 10000,
    });
    expect(DEFAULTS.table).toBe('henri_webhooks');
  });

  test('durations are read the way the queue reads them', () => {
    expect(normalize({ timeout: '30s' }).timeout).toBe(30000);
    expect(normalize({ backoff: { max: '2h' } }).backoff.max).toBe(7200000);
    expect(() => normalize({ timeout: 'soon' })).toThrow(/Invalid duration/u);
  });

  test('a table name that is not an identifier never reaches a statement', () => {
    expect(() => table('henri_webhooks; DROP TABLE users')).toThrow(
      /letters, digits and underscores/u
    );
    expect(() => normalize({ table: '1nope' })).toThrow(/invalid table name/u);
    expect(table('henri_webhooks')).toBe('henri_webhooks');
  });

  test('the escape hatches are off unless they are asked for by name', () => {
    expect(normalize({ allowHttp: 'yes', allowPrivate: 1 })).toMatchObject({
      allowHttp: false,
      allowPrivate: false,
    });
    expect(normalize({ allowHttp: true }).allowHttp).toBe(true);
  });
});

describe('an application with no secret of its own', () => {
  const adapters = [];

  afterAll(() => close(adapters));

  test('stores the signing secrets as they are, and says so once', async () => {
    const built = await build({ config: { secret: undefined } });

    adapters.push(built.adapter);

    const endpoint = await built.webhooks.register({
      events: ['*'],
      url: 'https://plain.example/hooks',
    });
    const row = await built.webhooks.store.find(endpoint.id);

    expect(row.secrets).toContain(endpoint.secret);
    expect(
      built.henri.calls.filter(
        ([level, , said]) =>
          level === 'warn' && String(said).includes('not encrypted')
      )
    ).toHaveLength(1);
  }, 60000);
});
