const BaseModule = require('../base/module');
const Henri = require('../henri');
const Mailers = require('../2.mailers');

const { PACKAGE, queue } = require('../base/jobs');

let henri;

/**
 * The mailers module with a henri that has no queue: what an application
 * that never installed @usehenri/jobs runs
 *
 * @returns {object} the module instance
 */
const withoutJobs = () => {
  const mailers = new Mailers();

  mailers.henri = {
    jobs: undefined,
    mail: { send: async () => ({ sent: true }) },
    pen: henri.pen,
  };

  return mailers;
};

// Core carries no queue: it is the module @usehenri/jobs ships, and the demo
// application depends on it. What is covered here is the seam -- that the
// module arrives from the package in its slot, that app/jobs is reached
// through it, that the mails of deliverLater() become jobs, and that a
// message asking for a delay without the package says what to install. The
// queue itself is covered in packages/jobs.
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

  test('should arrive from the package the application depends on', () => {
    expect(henri.jobs).toBeDefined();
    expect(henri.jobs).toBeInstanceOf(BaseModule);
    expect(henri.jobs.name).toEqual('jobs');
    expect(henri.jobs.needs).toEqual(['config', 'model']);
    expect(henri.jobs.after).toEqual(['mailers']);
    expect(henri.modules.modules.has('jobs')).toBe(true);
  });

  // `henri jobs` boots to this level, which binds no port
  test('should be a module of runlevel 4, so a runner binds no port', () => {
    expect(henri.jobs.runlevel).toBe(4);
    expect(henri.modules.plan.nodes.get('jobs').runlevel).toBe(4);
    expect(henri.router).toBeUndefined();
  });

  test('should load app/jobs of the application', () => {
    expect(henri.jobs.enabled).toBe(true);
    expect(henri.jobs.names()).toContain('echo');
  });

  test('should enqueue and read back a job', async () => {
    const job = await henri.jobs.perform('echo', { hello: 'demo' });

    expect(job.state).toBe('pending');
    expect((await henri.jobs.get(job.id)).args).toEqual({ hello: 'demo' });
  });

  // The seam core owns: the queue registers itself as the delivery handler
  // of the mailers (see JobsModule#deliverMail in @usehenri/jobs)
  test('should take the deliveries of henri.mailers', async () => {
    const message = { subject: 'Hello', to: 'ada@example.com' };
    const job = await henri.mailers.enqueue(message, { wait: '5m' });

    expect(job.name).toBe('henri/mail');
    expect(job.args).toEqual(message);
    expect(new Date(job.runAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('should be reached through base/jobs.js', () => {
    expect(queue(henri, 'a job')).toBe(henri.jobs);
    expect(() => queue({ jobs: undefined, pen: henri.pen }, 'a job')).toThrow(
      PACKAGE
    );
  });

  // What an application that never installs @usehenri/jobs sees: nothing is
  // loaded, and only a call that cannot be honoured says something
  describe(`without ${PACKAGE}`, () => {
    test('should fail a message that asked to be delivered later', async () => {
      await expect(
        withoutJobs().enqueue({ to: 'ada@example.com' }, { wait: '5m' })
      ).rejects.toThrow(PACKAGE);
    });

    // Out of band is the documented fallback of deliverLater(): an
    // application with no queue has always worked this way, and silently
    test('should deliver out of band when nothing asked for a delay', async () => {
      const mailers = withoutJobs();

      await expect(mailers.enqueue({ to: 'ada@example.com' })).resolves.toEqual(
        {
          deferred: true,
          handler: 'inline',
        }
      );

      await mailers.drain();
    });
  });
});
