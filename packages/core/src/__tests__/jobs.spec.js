const BaseModule = require('../base/module');
const Henri = require('../henri');
const Jobs = require('../4.jobs');

let henri;

describe('jobs', () => {
  beforeAll(async () => {
    henri = new Henri({ runlevel: 4 });
    await henri.init();
  }, 60000);

  afterAll(async () => {
    await henri.stop();
  });

  beforeEach(async () => {
    for (const state of ['pending', 'running', 'done', 'dead']) {
      await henri.jobs.queue.store.remove({ state });
    }
  });

  test('should be defined and extend BaseModule', () => {
    expect(henri.jobs).toBeDefined();
    expect(henri.jobs).toBeInstanceOf(BaseModule);
  });

  test('should be a module of runlevel 4, so a runner binds no port', () => {
    const jobs = new Jobs();

    expect(jobs.runlevel).toBe(4);
    expect(jobs.name).toBe('jobs');
    expect(jobs.enabled).toBe(false);
  });

  test('should load app/jobs of the application', () => {
    expect(henri.jobs.enabled).toBe(true);
    expect(henri.jobs.names()).toContain('echo');
  });

  test('should enqueue and read back a job', async () => {
    const job = await henri.jobs.perform('echo', { hello: 'demo' });

    expect(job.state).toBe('pending');
    expect(job.queue).toBe('default');
    expect((await henri.jobs.get(job.id)).args).toEqual({ hello: 'demo' });
  });

  test('should enqueue later and at a moment', async () => {
    const later = await henri.jobs.performIn('1h', 'echo', null);
    const when = new Date(Date.now() + 7200000);
    const dated = await henri.jobs.performAt(when, 'echo', null);

    expect(new Date(later.runAt).getTime()).toBeGreaterThan(Date.now());
    expect(dated.runAt).toBe(when.toISOString());
  });

  test('should perform a job inline with performNow', async () => {
    expect(await henri.jobs.performNow('echo', { hello: 'now' })).toEqual({
      attempt: 1,
      echo: { hello: 'now' },
    });
  });

  test('should answer with the counts of the queue', async () => {
    await henri.jobs.perform('echo', null);

    const stats = await henri.jobs.stats();

    expect(stats.totals.pending).toBe(1);
    expect(stats.jobs).toContain('echo');
  });

  test('should expose the dead letter queue', async () => {
    const { Runner } = require(
      require.resolve('@usehenri/jobs/src/runner', {
        paths: [process.cwd()],
      })
    );
    const enqueued = await henri.jobs.perform(
      'echo',
      { explode: 'on purpose' },
      { maxAttempts: 1 }
    );

    await new Runner(henri.jobs.queue).once();

    expect(await henri.jobs.dead.count()).toBe(1);

    const [dead] = await henri.jobs.dead.list();

    expect(dead.id).toBe(enqueued.id);
    expect(dead.error.message).toBe('boom: on purpose');
    expect((await henri.jobs.dead.retry(dead.id)).state).toBe('pending');
    expect(await henri.jobs.dead.discardAll({ state: 'pending' })).toBe(1);
  });

  test('should reload app/jobs', async () => {
    await henri.jobs.reload();

    expect(henri.jobs.enabled).toBe(true);
    expect(henri.jobs.names()).toContain('echo');
  });

  test('should refuse a job that does not exist', async () => {
    await expect(henri.jobs.perform('nope')).rejects.toThrow(
      'No job named "nope"'
    );
  });

  test('should say what to install when the application has no queue', () => {
    const jobs = new Jobs();

    jobs.henri = henri;

    expect(() => jobs.ready()).toThrow();
  });

  // `henri.mailers` renders a message and hands the rendered payload to the
  // handler this module registers (see Jobs#deliverMail)
  test('should take the deliveries of henri.mailers', async () => {
    const message = { subject: 'Hello', to: 'ada@example.com' };
    const job = await henri.mailers.enqueue(message, { wait: '5m' });

    expect(job.name).toBe('henri/mail');
    expect(job.args).toEqual(message);
    expect(new Date(job.runAt).getTime()).toBeGreaterThan(Date.now());
  });
});
