const Mongoose = require('@usehenri/mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { Webhooks } = require('../src/webhooks');
const { fakeHenri, fakeQueue } = require('./helpers');

/**
 * The MongoDB backend, on the server `@usehenri/disk` runs for an
 * application that never configured a database. The two backends hand the
 * package the same rows, so this suite asks the same questions the SQL one
 * asks and expects the same answers.
 */
describe('the endpoints (mongodb)', () => {
  let server = null;
  let adapter = null;
  let webhooks = null;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();

    const henri = fakeHenri({ jobs: fakeQueue() });

    adapter = new Mongoose('default', { url: server.getUri('henri') }, henri);
    await adapter.start();

    webhooks = new Webhooks(henri, { adapter });
    await webhooks.start();
  }, 120000);

  afterAll(async () => {
    if (adapter) {
      await adapter.stop();
    }

    if (server) {
      await server.stop();
    }
  });

  test('picks the MongoDB backend for a mongoose store', () => {
    expect(webhooks.store.kind).toBe('mongo');
    expect(webhooks.store.dialect).toBe('mongodb');
  });

  test('registers, reads back, rotates and removes', async () => {
    const endpoint = await webhooks.register({
      description: 'the one on mongo',
      events: ['invoice.*'],
      owner: 'tenant-a',
      url: 'https://acme.example/hooks',
    });

    expect(endpoint.secret).toMatch(/^whsec_/u);
    expect(await webhooks.endpoint(endpoint.id)).toMatchObject({
      description: 'the one on mongo',
      disabled: false,
      events: ['invoice.*'],
      owner: 'tenant-a',
    });

    const rotated = await webhooks.rotate(endpoint.id, { grace: 3600000 });

    expect(await webhooks.secrets(endpoint.id)).toEqual([
      rotated.secret,
      endpoint.secret,
    ]);

    expect((await webhooks.disable(endpoint.id)).disabled).toBe(true);
    expect((await webhooks.enable(endpoint.id)).disabled).toBe(false);
    expect(await webhooks.remove(endpoint.id)).toBe(true);
    expect(await webhooks.endpoint(endpoint.id)).toBeNull();
  });

  test('an owner is what keeps one tenant out of another one', async () => {
    const mine = await webhooks.register({
      events: ['*'],
      owner: 'tenant-a',
      url: 'https://a.example/hooks',
    });

    await webhooks.register({
      events: ['*'],
      owner: 'tenant-b',
      url: 'https://b.example/hooks',
    });
    await webhooks.register({
      events: ['*'],
      url: 'https://loose.example/hooks',
    });

    const sent = await webhooks.emit('anything', {}, { owner: 'tenant-a' });

    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe(mine.id);

    const loose = await webhooks.emit('anything');

    expect(loose).toHaveLength(1);
    expect((await webhooks.endpoint(loose[0].endpoint)).owner).toBeNull();
  });

  test('the counts are the same question the SQL backend answers', async () => {
    const total = await webhooks.store.count();
    const endpoint = await webhooks.register({
      events: ['*'],
      url: 'https://counted.example/hooks',
    });

    expect(await webhooks.store.count()).toBe(total + 1);
    await webhooks.disable(endpoint.id);
    expect(await webhooks.store.count({ disabled: true })).toBe(1);
    expect(await webhooks.store.count({ disabled: false })).toBe(total);
  });

  test('the install is idempotent', async () => {
    await expect(webhooks.store.install()).resolves.toHaveLength(1);
    expect(await webhooks.store.installed()).toBe(true);
  });
});
