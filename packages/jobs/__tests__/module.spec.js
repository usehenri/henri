const path = require('path');

const BaseModule = require('@usehenri/core/module');

const JobsModule = require('../src/module');
const { MAIL_JOB } = require('../src/jobs');
const {
  adapterFor,
  close,
  fakeHenri,
  sharedKey,
  target,
} = require('./helpers');

/** An application with jobs in app/jobs */
const APP = path.join(__dirname, 'fixtures', 'app');

/** An application with none: the fixtures directory holds no app/jobs */
const EMPTY = __dirname;

/**
 * The mailers module's half of the delivery seam (see core's 2.mailers.js)
 *
 * @returns {object} A stand-in exposing `onDeliverLater` and `deliverLater`
 */
const fakeMailers = () => {
  const state = { handler: null };

  return {
    /**
     * Hand a rendered message over, the way `deliverLater()` does
     *
     * @param {object} message A nodemailer payload
     * @param {object} [options={}] The options of the call
     * @returns {Promise<*>} What the handler answered
     */
    deliverLater: (message, options = {}) =>
      state.handler
        ? state.handler(message, options)
        : Promise.resolve({ deferred: true, handler: 'inline' }),

    /** The handler, so a suite can see it registered and let go */
    get handler() {
      return state.handler;
    },

    /**
     * Register the delivery handler
     *
     * @param {?function} handler The handler, or null
     * @returns {boolean} success
     */
    onDeliverLater: (handler) => {
      state.handler = handler;

      return true;
    },
  };
};

/**
 * A henri stand-in with what the module reads: the configuration, the stores
 * of the models and, when a suite asks for it, the mailers
 *
 * @param {object} [options={}] `adapter`, `config`, `cwd`, `mailers`
 * @returns {object} The instance
 */
const instance = (options = {}) => {
  const henri = fakeHenri({ cwd: options.cwd || APP });
  const settings = options.config;

  henri.config = {
    get: (key) => (key === 'jobs' ? settings : undefined),
    has: (key) => key === 'jobs' && typeof settings !== 'undefined',
  };
  henri.model = { stores: { default: options.adapter || null } };

  if (options.mailers) {
    henri.mailers = options.mailers;
  }

  return henri;
};

/**
 * A started module on the target database
 *
 * @param {object} [options={}] What `instance()` takes, plus `key`
 * @returns {Promise<object>} `{ adapter, henri, jobs }`
 */
const start = async (options = {}) => {
  const adapter = options.adapter || (await adapterFor(options.key));
  const henri = instance({ ...options, adapter });
  const jobs = new JobsModule(henri);

  await jobs.init();

  return { adapter, henri, jobs };
};

// The module @usehenri/jobs ships: what core registers as `henri.jobs`
// because the application depends on this package. The queue it drives is
// covered by the suites next to this one; what is covered here is the module
// -- its slot, when it stays out of the way, what it hands to the mailers
// and what it says when there is nothing to hand anything to.
describe(`module (${target.name})`, () => {
  const adapters = [];

  afterAll(() => close(adapters));

  describe('registration', () => {
    test('extends the base class core publishes', () => {
      expect(new JobsModule()).toBeInstanceOf(BaseModule);
    });

    test('is what package.json points at', () => {
      expect(require('../module.js')).toBe(JobsModule);
      expect(require('../package.json').henri).toEqual({
        module: './module.js',
      });
    });

    // `henri jobs` boots to runlevel 4, which binds no HTTP port; the queue
    // reaches its tables through the store adapter of the models, and the
    // mailers go first so `deliverLater()` finds a queue
    test('keeps its slot and its dependencies', () => {
      const jobs = new JobsModule();

      expect(jobs.name).toBe('jobs');
      expect(jobs.runlevel).toBe(4);
      expect(jobs.needs).toEqual(['config', 'model']);
      expect(jobs.after).toEqual(['mailers']);
      expect(jobs.reloadable).toBe(true);
      expect(jobs.enabled).toBe(false);
    });

    test('takes the henri instance the loader hands it', () => {
      const henri = instance();

      expect(new JobsModule(henri).henri).toBe(henri);
    });
  });

  describe('wanted()', () => {
    test('is app/jobs holding a file', () => {
      expect(new JobsModule(instance()).wanted()).toBe(true);
    });

    test('or a jobs block in the configuration', () => {
      const henri = instance({ config: { concurrency: 2 }, cwd: EMPTY });

      expect(new JobsModule(henri).wanted()).toBe(true);
    });

    test('and neither is an application that never asked for a queue', () => {
      expect(new JobsModule(instance({ cwd: EMPTY })).wanted()).toBe(false);
    });
  });

  describe('init()', () => {
    test('loads app/jobs and says how many there are', async () => {
      const { adapter, henri, jobs } = await start();

      adapters.push(adapter);

      expect(jobs.enabled).toBe(true);
      expect(jobs.names()).toContain('ok');
      expect(jobs.names()).toContain('nested/deep');
      expect(henri.calls).toContainEqual([
        'info',
        'jobs',
        `${jobs.names().length} job(s)`,
        jobs.names().join(', '),
      ]);
    });

    // Depending on the package is not the same as using it: an application
    // that has neither app/jobs nor a jobs block gets no queue and no table
    test('stays out of the way of an application that has no jobs', async () => {
      const jobs = new JobsModule(instance({ cwd: EMPTY }));

      expect(await jobs.init()).toBe('jobs');
      expect(jobs.enabled).toBe(false);
      expect(jobs.queue).toBe(null);
      expect(jobs.names()).toEqual([]);
      expect(jobs.henri.calls).toEqual([]);
    });

    test('takes the jobs block of the configuration', async () => {
      const { adapter, jobs } = await start({
        config: { concurrency: 9, table: 'other_jobs' },
      });

      adapters.push(adapter);

      expect(jobs.queue.config.concurrency).toBe(9);
      expect(jobs.queue.config.tables.jobs).toBe('other_jobs');
    });

    test('says what went wrong when the queue cannot start', async () => {
      const jobs = new JobsModule(instance({ adapter: null }));

      await expect(jobs.init()).rejects.toThrow();
      expect(jobs.henri.calls[0][0]).toBe('error');
      expect(jobs.enabled).toBe(false);
    });
  });

  describe('the queue', () => {
    const key = sharedKey('module');
    let jobs = null;

    beforeAll(async () => {
      const started = await start({ key });

      jobs = started.jobs;
      adapters.push(started.adapter);
    });

    beforeEach(async () => {
      for (const state of ['pending', 'running', 'done', 'dead']) {
        await jobs.queue.store.remove({ state });
      }
    });

    test('enqueues and reads back', async () => {
      const job = await jobs.perform('ok', { hello: 'module' });

      expect(job.state).toBe('pending');
      expect((await jobs.get(job.id)).args).toEqual({ hello: 'module' });
      expect(await jobs.list({ state: 'pending' })).toHaveLength(1);
      expect((await jobs.stats()).totals.pending).toBe(1);
    });

    test('enqueues later, at a moment, and under the other name', async () => {
      const later = await jobs.performIn('1h', 'ok', null);
      const when = new Date(Date.now() + 7200000);
      const dated = await jobs.performAt(when, 'ok', null);
      const named = await jobs.enqueue('ok', null);

      expect(new Date(later.runAt).getTime()).toBeGreaterThan(Date.now());
      expect(dated.runAt).toBe(when.toISOString());
      expect(named.name).toBe('ok');
    });

    test('performs one here and now', async () => {
      expect(await jobs.performNow('ok', { hello: 'now' })).toEqual({
        args: { hello: 'now' },
        attempt: 1,
      });
    });

    test('hands out the dead letter queue', async () => {
      const buried = await jobs.perform('ok', null, { maxAttempts: 1 });

      await jobs.queue.store.update(buried.id, { state: 'dead' });

      expect(await jobs.dead.count()).toBe(1);
      expect(await jobs.dead.list()).toHaveLength(1);
      expect((await jobs.dead.get(buried.id)).id).toBe(buried.id);
      expect((await jobs.dead.retry(buried.id)).state).toBe('pending');
      expect(await jobs.dead.discardAll({ state: 'pending' })).toBe(1);
    });

    test('reads app/jobs again on a reload', async () => {
      expect(await jobs.reload()).toBe('jobs');
      expect(jobs.enabled).toBe(true);
      expect(jobs.names()).toContain('ok');
    });
  });

  describe('the mailers', () => {
    test('take their deliveries from the queue', async () => {
      const mailers = fakeMailers();
      const { adapter, jobs } = await start({ mailers });

      adapters.push(adapter);

      expect(typeof mailers.handler).toBe('function');

      const message = { subject: 'Hello', to: 'ada@example.com' };
      const job = await mailers.deliverLater(message, { wait: '5m' });

      expect(job.name).toBe(MAIL_JOB);
      expect(job.args).toEqual(message);
      expect(new Date(job.runAt).getTime()).toBeGreaterThan(Date.now());

      // Stopping lets go of the seam: nothing enqueues into a closed queue
      expect(await jobs.stop()).toBe(true);
      expect(mailers.handler).toBe(null);
      expect(jobs.enabled).toBe(false);
    });

    test('are left alone when the application has none', async () => {
      const { adapter, jobs } = await start();

      adapters.push(adapter);

      expect(jobs.deliverMail()).toBe(false);
    });
  });

  describe('without a queue', () => {
    test('says what an application with no jobs has to do', () => {
      const jobs = new JobsModule(instance({ cwd: EMPTY }));

      expect(() => jobs.ready()).toThrow('no job queue');
      expect(() => jobs.perform('ok')).toThrow('henri generate job');
      expect(() => jobs.dead.count()).toThrow('henri generate job');
    });

    test('stops without anything to stop', async () => {
      expect(await new JobsModule(instance()).stop()).toBe(false);
    });
  });
});
