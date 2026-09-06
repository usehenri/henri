const { Jobs } = require('@usehenri/jobs');
const { Runner } = require('@usehenri/jobs/src/runner');

const { Webhooks } = require('../src/webhooks');
const { adapterFor, close, fakeHenri, receiver } = require('./helpers');
const { definition } = require('../src/job');
const { verify } = require('../src/signature');

/**
 * A delivery goes through the queue and nowhere else, so this suite builds
 * the real thing: one sqlite database holding both `henri_jobs` and
 * `henri_webhooks`, one queue with the delivery job registered on it the way
 * the module registers it, and one runner performing what `emit()` wrote.
 *
 * The receivers are on the loopback, which is exactly what the address rules
 * refuse: `allowHttp` and `allowPrivate` are what a development
 * configuration sets, and the suite that proves the refusals is
 * `address.spec.js`.
 */
const CONFIG = {
  allowHttp: true,
  allowPrivate: true,
  // A quarter of a second between attempts: long enough that one pass of
  // the runner performs one attempt, short enough for a test to wait
  backoff: { base: 250, factor: 1, jitter: 0, max: 250 },
  maxAttempts: 3,
  timeout: 2000,
};

describe('a delivery, end to end', () => {
  const adapters = [];
  const servers = [];
  let webhooks = null;
  let jobs = null;
  let henri = null;
  let registered = null;

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

  /**
   * Performs everything the queue holds, once
   *
   * @returns {Promise<object>} `{ performed, failed }`
   */
  const work = () =>
    new Runner(jobs, { concurrency: 1, recurring: false }).once();

  /**
   * Waits for the backoff to come round
   *
   * @param {number} [ms=300] How long
   * @returns {Promise<void>} Resolves then
   */
  const wait = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    const adapter = await adapterFor();

    adapters.push(adapter);
    henri = fakeHenri();
    jobs = new Jobs(henri, { adapter, config: { backoff: { jitter: 0 } } });
    await jobs.start();
    jobs.enabled = true;
    henri.jobs = jobs;

    webhooks = new Webhooks(henri, { adapter, config: CONFIG });
    await webhooks.start();

    const { definition: job, name } = definition(webhooks);

    registered = [jobs.define(name, job), jobs.define(name, job)];
  }, 60000);

  test('the delivery job is registered on the queue, once', () => {
    // And an application that wrote its own would win, as it does for mail
    expect(registered).toEqual([true, false]);
    expect(jobs.names()).toContain('henri/webhook');
  });

  afterAll(async () => {
    for (const server of servers) {
      await server.close();
    }

    await close(adapters);
  });

  test('the receiver gets a signed delivery, and verifies it', async () => {
    const server = await serve();
    const endpoint = await webhooks.register({
      events: ['invoice.*'],
      url: server.url,
    });
    const [delivery] = await webhooks.emit('invoice.paid', { total: 4200 });

    expect(await work()).toMatchObject({ failed: 0, performed: 1 });

    const [got] = server.received;

    expect(got.headers['webhook-id']).toBe(delivery.id);
    expect(got.headers['user-agent']).toBe('henri-webhooks');
    expect(
      verify({ body: got.body, headers: got.headers, secret: endpoint.secret })
    ).toMatchObject({ id: delivery.id, ok: true });
    expect(JSON.parse(got.body)).toMatchObject({
      data: { total: 4200 },
      id: delivery.id,
      type: 'invoice.paid',
    });

    const job = await jobs.get(delivery.job);

    expect(job.state).toBe('done');
    await webhooks.remove(endpoint.id);
  });

  test('a receiver that keeps failing lands in the dead letter queue', async () => {
    const server = await serve(() => ({ body: 'boom', status: 500 }));
    const endpoint = await webhooks.register({
      events: ['order.created'],
      url: server.url,
    });
    const [delivery] = await webhooks.emit('order.created', { id: 7 });

    // Attempt one: failed, put back
    await work();

    let job = await jobs.get(delivery.job);

    expect(job).toMatchObject({ attempts: 1, state: 'pending' });
    expect(job.error.message).toContain('answered 500');

    // Attempts two and three: dead
    await wait();
    await work();
    await wait();
    await work();

    job = await jobs.get(delivery.job);

    expect(job).toMatchObject({ attempts: 3, state: 'dead' });
    expect(job.history).toHaveLength(3);
    expect(await jobs.dead.count()).toBeGreaterThan(0);

    // The endpoint carried the delivery, and every attempt reached it
    expect(server.received).toHaveLength(3);
    expect(
      new Set(server.received.map((entry) => entry.headers['webhook-id'])).size
    ).toBe(1);
    // Every attempt was signed afresh: the id holds, the moment moves
    expect(
      new Set(
        server.received.map((entry) => entry.headers['webhook-signature'])
      ).size
    ).toBeGreaterThan(0);

    // And an operator sends it again from the dead letter queue
    server.received.length = 0;
    await jobs.dead.retry(delivery.job);
    await work();
    expect(server.received).toHaveLength(1);

    await jobs.dead.discardAll();
    await webhooks.remove(endpoint.id);
  });

  test('a 410 Gone kills the delivery now, and disables the endpoint', async () => {
    const server = await serve(() => ({ status: 410 }));
    const endpoint = await webhooks.register({
      events: ['gone.event'],
      url: server.url,
    });
    const [delivery] = await webhooks.emit('gone.event');

    await work();

    const job = await jobs.get(delivery.job);

    expect(job).toMatchObject({ attempts: 1, state: 'dead' });
    expect(job.error.message).toContain('410 Gone');
    expect(await webhooks.endpoint(endpoint.id)).toMatchObject({
      disabled: true,
      disabledReason: 'the receiver answered 410 Gone',
    });

    // Nothing else is queued for it, and a delivery already waiting stops
    expect(await webhooks.emit('gone.event')).toHaveLength(0);
    await jobs.dead.discardAll();
    await webhooks.remove(endpoint.id);
  });

  test('a redirect kills the delivery now too, and is not followed', async () => {
    const server = await serve(() => ({
      headers: { location: 'http://169.254.169.254/latest/' },
      status: 301,
    }));
    const endpoint = await webhooks.register({
      events: ['moved.event'],
      url: server.url,
    });
    const [delivery] = await webhooks.emit('moved.event');

    await work();

    const job = await jobs.get(delivery.job);

    expect(job).toMatchObject({ attempts: 1, state: 'dead' });
    expect(job.error.message).toMatch(/does not follow a redirect/u);
    expect(server.received).toHaveLength(1);

    await jobs.dead.discardAll();
    await webhooks.remove(endpoint.id);
  });

  test('a url that resolves somewhere it must not is dead on arrival', async () => {
    // Registered while it is a plain name, delivered when it is the
    // metadata service: the check that matters is the one at request time
    const endpoint = await webhooks.register({
      events: ['ssrf.event'],
      url: 'http://169.254.169.254/latest/meta-data/',
    });
    const [delivery] = await webhooks.emit('ssrf.event');

    webhooks.config.allowPrivate = false;

    try {
      await work();
    } finally {
      webhooks.config.allowPrivate = true;
    }

    const job = await jobs.get(delivery.job);

    expect(job).toMatchObject({ attempts: 1, state: 'dead' });
    expect(job.error.message).toMatch(/link-local range/u);

    await jobs.dead.discardAll();
    await webhooks.remove(endpoint.id);
  });

  test('a delivery to an endpoint that is gone is not an error', async () => {
    const server = await serve();
    const endpoint = await webhooks.register({
      events: ['short.lived'],
      url: server.url,
    });
    const [delivery] = await webhooks.emit('short.lived');

    await webhooks.remove(endpoint.id);
    expect(await work()).toMatchObject({ failed: 0, performed: 1 });
    expect((await jobs.get(delivery.job)).state).toBe('done');
    expect(server.received).toHaveLength(0);
  });

  test('a delivery to an endpoint that was disabled meanwhile stops', async () => {
    const server = await serve();
    const endpoint = await webhooks.register({
      events: ['paused.event'],
      url: server.url,
    });
    const [delivery] = await webhooks.emit('paused.event');

    await webhooks.disable(endpoint.id, { reason: 'the operator did' });
    await work();

    expect((await jobs.get(delivery.job)).state).toBe('done');
    expect(server.received).toHaveLength(0);
    await webhooks.remove(endpoint.id);
  });

  test('the headers an endpoint carries are sent, under the signed ones', async () => {
    const server = await serve();
    const endpoint = await webhooks.register({
      events: ['tagged.event'],
      headers: { 'X-Acme-Env': 'production' },
      url: server.url,
    });

    await webhooks.emit('tagged.event');
    await work();

    const [got] = server.received;

    expect(got.headers['x-acme-env']).toBe('production');
    expect(
      verify({ body: got.body, headers: got.headers, secret: endpoint.secret })
        .ok
    ).toBe(true);
    await webhooks.remove(endpoint.id);
  });

  test('a rotation is invisible to a receiver that has either secret', async () => {
    const server = await serve();
    const endpoint = await webhooks.register({
      events: ['rotating.event'],
      url: server.url,
    });
    const rotated = await webhooks.rotate(endpoint.id, { grace: 3600000 });

    await webhooks.emit('rotating.event');
    await work();

    const [got] = server.received;

    for (const secret of [endpoint.secret, rotated.secret]) {
      expect(verify({ body: got.body, headers: got.headers, secret }).ok).toBe(
        true
      );
    }

    await webhooks.remove(endpoint.id);
  });

  test('the operator sees the endpoints and what the queue holds', async () => {
    const server = await serve();
    const endpoint = await webhooks.register({
      events: ['counted.event'],
      url: server.url,
    });

    await webhooks.emit('counted.event');

    const stats = await webhooks.stats();

    expect(stats.queue).toBe('webhooks');
    expect(stats.endpoints.total).toBeGreaterThan(0);
    expect(stats.deliveries).toMatchObject({ queue: 'webhooks' });

    await work();
    await webhooks.remove(endpoint.id);
  });
});
