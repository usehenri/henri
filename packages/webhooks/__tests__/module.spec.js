const WebhooksModule = require('../src/module');
const { Jobs } = require('@usehenri/jobs');

const { adapterFor, close, fakeHenri } = require('./helpers');

/**
 * A henri stand-in with a store the module can find on its own
 *
 * @param {object} adapter A started adapter
 * @param {object} [options={}] What `fakeHenri` takes
 * @returns {object} The instance
 */
const withStore = (adapter, options = {}) => {
  const henri = fakeHenri(options);

  henri.model = { stores: { default: adapter } };

  return henri;
};

describe('the henri module', () => {
  const adapters = [];

  afterAll(() => close(adapters));

  test('says where it goes, and it is after the queue', () => {
    const module = new WebhooksModule(null);

    expect(module.name).toBe('webhooks');
    expect(module.runlevel).toBe(4);
    expect(module.needs).toEqual(['config', 'model']);
    expect(module.after).toEqual(['cache', 'jobs']);
    expect(module.reloadable).toBe(true);
    expect(module.enabled).toBe(false);
  });

  test('registers the delivery job on the queue it finds', async () => {
    const adapter = await adapterFor();

    adapters.push(adapter);

    const henri = withStore(adapter);
    const jobs = new Jobs(henri, { adapter });

    await jobs.start();
    jobs.enabled = true;
    henri.jobs = jobs;

    const module = new WebhooksModule(henri);

    expect(await module.init()).toBe('webhooks');
    expect(module.enabled).toBe(true);
    expect(jobs.names()).toContain('henri/webhook');
    expect(jobs.definitions['henri/webhook']).toMatchObject({
      maxAttempts: 8,
      queue: 'webhooks',
      timeout: 15000,
    });
    expect(module.agent()).toMatch(/^henri-webhooks\/\d/u);

    await module.stop();
    expect(module.enabled).toBe(false);
  }, 60000);

  test('boots without a queue, and says what cannot happen', async () => {
    const adapter = await adapterFor();

    adapters.push(adapter);

    const henri = withStore(adapter);
    const module = new WebhooksModule(henri);

    expect(await module.init()).toBe('webhooks');
    expect(module.enabled).toBe(true);
    expect(
      henri.calls.some(
        ([level, , said]) =>
          level === 'warn' && String(said).includes('no running job queue')
      )
    ).toBe(true);

    // The endpoints work; it is the first emit that says what is missing
    const endpoint = await module.register({
      events: ['*'],
      url: 'https://acme.example/hooks',
    });

    expect(endpoint.secret).toMatch(/^whsec_/u);
    await expect(module.emit('anything')).rejects.toMatchObject({
      code: 'HENRI_JOB_QUEUE_UNAVAILABLE',
    });

    await module.stop();
  }, 60000);

  test('a module that never started says so rather than answering null', async () => {
    const henri = fakeHenri();
    const module = new WebhooksModule(henri);

    expect(() => module.ready()).toThrow(/did not start/u);
    expect(await module.stop()).toBe(false);
  });

  test('the boot line says when a protection was turned off', async () => {
    const adapter = await adapterFor();

    adapters.push(adapter);

    const henri = withStore(adapter, {
      config: { webhooks: { allowHttp: true, allowPrivate: true } },
    });
    const module = new WebhooksModule(henri);

    await module.init();

    const [, ...said] =
      henri.calls.find(
        ([level, , first]) =>
          level === 'info' && String(first).includes('deliveries on')
      ) || [];

    expect(said.join(' ')).toContain('private addresses are ALLOWED');
    expect(said.join(' ')).toContain('plaintext http is ALLOWED');
    await module.stop();
  }, 60000);

  test('reloading reads the configuration again', async () => {
    const adapter = await adapterFor();

    adapters.push(adapter);

    const henri = withStore(adapter);
    const module = new WebhooksModule(henri);

    await module.init();
    expect(module.webhooks.config.queue).toBe('webhooks');
    expect(await module.reload()).toBe('webhooks');
    expect(module.enabled).toBe(true);
    await module.stop();
  }, 60000);
});
