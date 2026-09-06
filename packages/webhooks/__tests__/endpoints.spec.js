const { build, close, fakeQueue } = require('./helpers');
const { subscribed } = require('../src/webhooks');

describe('the endpoints', () => {
  const adapters = [];
  let webhooks = null;

  beforeAll(async () => {
    const built = await build({ jobs: fakeQueue() });

    adapters.push(built.adapter);
    webhooks = built.webhooks;
  }, 60000);

  afterAll(() => close(adapters));

  test('registering one hands the secret over, once', async () => {
    const endpoint = await webhooks.register({
      description: 'Acme production',
      events: ['invoice.paid', 'invoice.*'],
      url: 'https://acme.example/hooks',
    });

    expect(endpoint).toMatchObject({
      description: 'Acme production',
      disabled: false,
      events: ['invoice.paid', 'invoice.*'],
      owner: null,
      url: 'https://acme.example/hooks',
    });
    expect(endpoint.secret).toMatch(/^whsec_/u);
    expect(endpoint.secrets).toHaveLength(1);
    expect(endpoint.secrets[0].scheme).toBe('v1');

    // And never again: reading it back carries the metadata, not the key
    const read = await webhooks.endpoint(endpoint.id);

    expect(read.secret).toBeUndefined();
    expect(JSON.stringify(read)).not.toContain(endpoint.secret);
  });

  test('the secret is stored sealed, not as it was handed over', async () => {
    const endpoint = await webhooks.register({
      events: ['*'],
      url: 'https://sealed.example/hooks',
    });
    const row = await webhooks.store.find(endpoint.id);

    expect(row.secrets).toContain('henri-webhooks-v1:');
    expect(row.secrets).not.toContain(endpoint.secret);
    // And it comes back out for the operator who has to re-give it
    expect(await webhooks.secrets(endpoint.id)).toEqual([endpoint.secret]);
  });

  test('a url is checked for its shape, not for where it resolves', async () => {
    await expect(
      webhooks.register({ events: ['*'], url: 'http://acme.example/hooks' })
    ).rejects.toThrow(/plaintext http/u);
    await expect(
      webhooks.register({ events: ['*'], url: 'file:///etc/passwd' })
    ).rejects.toThrow(/is not delivered to/u);
    // A public name that will later resolve somewhere else is accepted here
    // and refused at delivery, which is the whole point
    const endpoint = await webhooks.register({
      events: ['*'],
      url: 'https://rebinding.example/hooks',
    });

    expect(endpoint.url).toBe('https://rebinding.example/hooks');
  });

  test('an event pattern that is not one is refused', async () => {
    for (const events of [[], ['in valid'], ['invoice.**'], [''], 42]) {
      await expect(
        webhooks.register({ events, url: 'https://acme.example/hooks' })
      ).rejects.toMatchObject({ code: 'HENRI_WEBHOOK_INVALID_ENDPOINT' });
    }
  });

  test('an owner too long to store whole is refused, not truncated', async () => {
    // Two tenants sharing a long prefix would otherwise share endpoints
    await expect(
      webhooks.register({
        events: ['*'],
        owner: 'tenant-'.padEnd(200, 'x'),
        url: 'https://acme.example/hooks',
      })
    ).rejects.toMatchObject({ code: 'HENRI_WEBHOOK_INVALID_ENDPOINT' });

    // A description is prose, and prose is cut to fit
    const endpoint = await webhooks.register({
      description: 'a'.repeat(400),
      events: ['*'],
      url: 'https://long.example/hooks',
    });

    expect(endpoint.description).toHaveLength(190);
    await webhooks.remove(endpoint.id);
  });

  test('a header the signature owns is refused', async () => {
    for (const name of [
      'webhook-signature',
      'Webhook-Signature',
      'content-type',
      'host',
      'transfer-encoding',
    ]) {
      await expect(
        webhooks.register({
          events: ['*'],
          headers: { [name]: 'anything' },
          url: 'https://acme.example/hooks',
        })
      ).rejects.toThrow(/may not set/u);
    }

    const endpoint = await webhooks.register({
      events: ['*'],
      headers: { 'X-Acme-Env': 'production' },
      url: 'https://acme.example/headers',
    });

    expect(endpoint.headers).toEqual({ 'x-acme-env': 'production' });
  });

  test('rotating keeps the old secret signing for the grace it was given', async () => {
    const endpoint = await webhooks.register({
      events: ['*'],
      url: 'https://rotate.example/hooks',
    });
    const rotated = await webhooks.rotate(endpoint.id, { grace: 3600000 });

    expect(rotated.secret).not.toBe(endpoint.secret);
    expect(rotated.secrets).toHaveLength(2);
    expect(await webhooks.secrets(endpoint.id)).toEqual([
      rotated.secret,
      endpoint.secret,
    ]);

    // And a rotation without a grace retires it now, which is what a leak
    // calls for
    const again = await webhooks.rotate(endpoint.id);

    expect(again.secrets).toHaveLength(1);
    expect(await webhooks.secrets(endpoint.id)).toEqual([again.secret]);
  });

  test('an endpoint is disabled, enabled and removed', async () => {
    const endpoint = await webhooks.register({
      events: ['*'],
      url: 'https://short.example/hooks',
    });

    expect(
      (await webhooks.disable(endpoint.id, { reason: 'asked to' })).disabled
    ).toBe(true);
    expect((await webhooks.endpoint(endpoint.id)).disabledReason).toBe(
      'asked to'
    );
    expect((await webhooks.enable(endpoint.id)).disabled).toBe(false);
    expect(await webhooks.remove(endpoint.id)).toBe(true);
    expect(await webhooks.endpoint(endpoint.id)).toBeNull();
    expect(await webhooks.remove(endpoint.id)).toBe(false);
  });

  test('an unknown id says so, with the code the catalogue declares', async () => {
    await expect(webhooks.rotate('nope')).rejects.toMatchObject({
      code: 'HENRI_WEBHOOK_UNKNOWN',
    });
    await expect(webhooks.secrets('nope')).rejects.toThrow(/no webhook/u);
  });

  test('changing one drops what it had cached', async () => {
    const endpoint = await webhooks.register({
      events: ['order.created'],
      url: 'https://update.example/hooks',
    });

    const before = await webhooks.emit('order.shipped');

    expect(before.map((entry) => entry.endpoint)).not.toContain(endpoint.id);

    await webhooks.update(endpoint.id, { events: ['order.*'] });

    const after = await webhooks.emit('order.shipped');

    expect(after.map((entry) => entry.endpoint)).toContain(endpoint.id);
    await webhooks.remove(endpoint.id);
  });
});

describe('who an event reaches', () => {
  const adapters = [];
  let webhooks = null;
  let queue = null;

  beforeAll(async () => {
    queue = fakeQueue();

    const built = await build({ jobs: queue });

    adapters.push(built.adapter);
    webhooks = built.webhooks;

    await webhooks.register({
      events: ['invoice.*'],
      url: 'https://one.example/hooks',
    });
    await webhooks.register({
      events: ['invoice.paid'],
      owner: 'tenant-a',
      url: 'https://a.example/hooks',
    });
    await webhooks.register({
      events: ['*'],
      owner: 'tenant-b',
      url: 'https://b.example/hooks',
    });
  }, 60000);

  afterAll(() => close(adapters));

  test('an emit without an owner never reaches a tenant', async () => {
    const sent = await webhooks.emit('invoice.paid', { total: 1 });

    expect(sent).toHaveLength(1);

    const endpoint = await webhooks.endpoint(sent[0].endpoint);

    expect(endpoint.owner).toBeNull();
  });

  test("an emit with an owner reaches that owner's endpoints and no other", async () => {
    const sent = await webhooks.emit('invoice.paid', {}, { owner: 'tenant-a' });

    expect(sent).toHaveLength(1);
    expect((await webhooks.endpoint(sent[0].endpoint)).owner).toBe('tenant-a');

    const other = await webhooks.emit(
      'anything.at.all',
      {},
      {
        owner: 'tenant-b',
      }
    );

    expect(other).toHaveLength(1);
    expect(
      await webhooks.emit('anything.at.all', {}, { owner: 'tenant-a' })
    ).toHaveLength(0);
  });

  test('a delivery is a job on the webhooks queue, carrying the signed bytes', async () => {
    queue.enqueued.length = 0;

    const [delivery] = await webhooks.emit('invoice.paid', { total: 4200 });
    const [job] = queue.enqueued;

    expect(job.name).toBe('henri/webhook');
    expect(job.options.queue).toBe('webhooks');
    expect(job.args.id).toBe(delivery.id);
    expect(JSON.parse(job.args.body)).toEqual({
      data: { total: 4200 },
      id: delivery.id,
      timestamp: expect.any(String),
      type: 'invoice.paid',
    });
  });

  test('an event name that is not one is refused', async () => {
    await expect(webhooks.emit('not an event')).rejects.toMatchObject({
      code: 'HENRI_WEBHOOK_INVALID_EVENT',
    });
    await expect(webhooks.emit(42)).rejects.toThrow(/is not an event name/u);
  });

  test('a fan-out over the ceiling refuses instead of writing the rows', async () => {
    webhooks.config.maxFanout = 1;

    await expect(
      webhooks.emit('anything', {}, { owner: 'tenant-b' })
    ).resolves.toHaveLength(1);

    await webhooks.register({
      events: ['*'],
      owner: 'tenant-b',
      url: 'https://b2.example/hooks',
    });

    await expect(
      webhooks.emit('anything', {}, { owner: 'tenant-b' })
    ).rejects.toMatchObject({ code: 'HENRI_WEBHOOK_FANOUT_TOO_LARGE' });

    webhooks.config.maxFanout = 1000;
  });

  test('a delivery to a disabled endpoint is not enqueued', async () => {
    const endpoint = await webhooks.register({
      events: ['sale.made'],
      url: 'https://off.example/hooks',
    });

    await webhooks.disable(endpoint.id);
    expect(await webhooks.emit('sale.made')).toHaveLength(0);
  });
});

describe('the subscription patterns', () => {
  test.each([
    [['*'], 'anything.at.all', true],
    [['invoice.paid'], 'invoice.paid', true],
    [['invoice.paid'], 'invoice.void', false],
    [['invoice.*'], 'invoice.paid', true],
    [['invoice.*'], 'invoice.payment.failed', true],
    [['invoice.*'], 'invoices.paid', false],
    [['invoice.*'], 'invoice', false],
    [[], 'invoice.paid', false],
    [null, 'invoice.paid', false],
  ])('%s takes %s: %s', (patterns, event, answer) => {
    expect(subscribed(patterns, event)).toBe(answer);
  });
});
